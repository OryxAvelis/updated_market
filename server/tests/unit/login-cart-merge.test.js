import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const loginUrl = new URL('../../../js/login.js', import.meta.url);

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  const failingWrites = new Set();
  const failingRemovals = new Set();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => {
      if (failingWrites.has(key)) throw new Error('storage write failed');
      values.set(key, String(value));
    },
    removeItem: key => {
      if (failingRemovals.has(key)) throw new Error('storage removal failed');
      return values.delete(key);
    },
    has: key => values.has(key),
    value: key => values.get(key),
    failWrite: key => failingWrites.add(key),
    failRemove: key => failingRemovals.add(key)
  };
}

function testElement(overrides = {}) {
  const attributes = new Map();
  const element = {
    hidden: false,
    disabled: false,
    textContent: '',
    className: '',
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    toggleAttribute(name, force) {
      if (force) attributes.set(name, '');
      else attributes.delete(name);
    },
    getAttribute: name => attributes.get(name) ?? null,
    querySelectorAll() { return []; },
    querySelector() { return null; },
    focus: vi.fn(),
    addEventListener: vi.fn(),
    ...overrides
  };
  return element;
}

function loginDocument() {
  const spinner = testElement({ hidden: true });
  const mergeLabel = testElement({ dataset: { authCopy: 'mergeAction' } });
  const elements = {
    authAlert: testElement({ hidden: true }),
    checkoutAuthContext: testElement({ hidden: true }),
    continueGuestLink: testElement({ href: '' }),
    authBackLink: testElement({ href: '' }),
    authBackLabel: testElement(),
    guestMergePanel: testElement({ hidden: true }),
    guestMergeSummary: testElement(),
    mergeGuestBtn: testElement({
      querySelector(selector) {
        if (selector === '.auth-spinner') return spinner;
        if (selector === '[data-auth-copy]') return mergeLabel;
        return null;
      }
    }),
    keepGuestBtn: testElement(),
    continueAfterAuthBtn: testElement({ hidden: true })
  };
  const authPanels = [testElement(), testElement(), testElement()];
  return {
    elements,
    document: {
      addEventListener() {},
      getElementById(id) { return elements[id] || null; },
      querySelectorAll(selector) { return selector === '[data-auth-panel]' ? authPanels : []; }
    }
  };
}

async function loginMergeHarness(mergeGuest, options = {}) {
  const local = storage(options.seed || { am_cart: JSON.stringify([{ id: 'product-2', qty: 1 }, { id: 'product-1', qty: 2 }]) });
  const dom = loginDocument();
  let lockTail = Promise.resolve();
  const lockRequest = vi.fn((_name, _options, callback) => {
    const result = lockTail.then(callback);
    lockTail = result.catch(() => {});
    return result;
  });
  const broadcastMessages = [];
  class TestBroadcastChannel {
    postMessage(message) { broadcastMessages.push(message); }
    close() {}
  }
  const context = {
    BroadcastChannel: TestBroadcastChannel,
    URLSearchParams,
    console,
    document: dom.document,
    getLang: () => 'en',
    location: { search: options.search || '', replace: vi.fn() },
    localStorage: local,
    navigator: { locks: { request: lockRequest } },
    setTimeout,
    requestAnimationFrame: callback => callback(),
    StoreAPI: {
      bootstrap: vi.fn(),
      auth: { logout: options.logout || vi.fn().mockResolvedValue({}) },
      createIdempotencyKey: vi.fn(() => 'am1.mez4dhs0.2f093729-84af-4cad-9f27-6617eb80c67d'),
      cart: { mergeGuest },
      wishlist: { mergeGuest: options.mergeWishlist || vi.fn() }
    },
    t: key => key,
    window: { addEventListener() {} }
  };
  context.globalThis = context;
  const source = await readFile(loginUrl, 'utf8');
  const instrumented = source.replace(/\}\)\(\);\s*$/, `
    globalThis.__loginMergeTest = {
      merge: mergeGuestShopping,
      complete: completeAuthentication,
      accept: acceptGuestMerge,
      keepSeparate: keepGuestShoppingSeparate,
      continueAfterAuth: continueAfterAuthentication,
      guestState: guestShoppingState,
      applyCheckoutIntent,
      safeNextPage,
      isCheckoutIntent
    };
  })();`);
  vm.runInNewContext(instrumented, context, {
    filename: 'js/login.js'
  });
  return {
    ...context.__loginMergeTest,
    local,
    lockRequest,
    broadcastMessages,
    storeApi: context.StoreAPI,
    elements: dom.elements,
    location: context.location
  };
}

describe('post-authentication guest cart merge', () => {
  it('preserves only a safe checkout return target', async () => {
    const checkout = await loginMergeHarness(vi.fn(), { search: '?next=checkout.html' });
    expect(checkout.safeNextPage()).toBe('checkout.html');
    expect(checkout.isCheckoutIntent()).toBe(true);
    checkout.applyCheckoutIntent();
    expect(checkout.elements.checkoutAuthContext.hidden).toBe(false);
    expect(checkout.elements.continueGuestLink.href).toBe('checkout.html');

    const external = await loginMergeHarness(vi.fn(), {
      search: '?next=https%3A%2F%2Fevil.example%2Fcheckout.html'
    });
    expect(external.safeNextPage()).toBe('index.html');
    expect(external.isCheckoutIntent()).toBe(false);
    external.applyCheckoutIntent();
    expect(external.elements.checkoutAuthContext.hidden).toBe(true);
  });

  it('persists and reuses the exact caller-owned key after an ambiguous failure', async () => {
    const mergeGuest = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('response lost'), { code: 'TIMEOUT' }))
      .mockResolvedValueOnce({ replayed: true, cart: { items: [] } });
    const harness = await loginMergeHarness(mergeGuest);

    await expect(harness.merge()).resolves.toBe(1);
    expect(harness.local.has('am_cart')).toBe(true);
    expect(harness.local.has('am_cart_merge_attempt_v1')).toBe(true);
    harness.local.removeItem('am_cart');

    await expect(harness.merge()).resolves.toBe(0);
    expect(mergeGuest).toHaveBeenCalledTimes(2);
    expect(mergeGuest.mock.calls[0][1]).toEqual({ idempotencyKey: 'am1.mez4dhs0.2f093729-84af-4cad-9f27-6617eb80c67d' });
    expect(mergeGuest.mock.calls[1][1]).toEqual({ idempotencyKey: 'am1.mez4dhs0.2f093729-84af-4cad-9f27-6617eb80c67d' });
    expect(mergeGuest.mock.calls[1][0]).toEqual(mergeGuest.mock.calls[0][0]);
    expect(harness.storeApi.createIdempotencyKey).toHaveBeenCalledOnce();
    expect(harness.local.has('am_cart')).toBe(false);
    expect(harness.local.has('am_cart_merge_attempt_v1')).toBe(false);
  });

  it('serializes concurrent login tabs so one guest snapshot is merged only once', async () => {
    const mergeGuest = vi.fn().mockResolvedValue({ replayed: false, cart: { items: [] } });
    const harness = await loginMergeHarness(mergeGuest);

    await expect(Promise.all([harness.merge(), harness.merge()])).resolves.toEqual([0, 0]);
    expect(mergeGuest).toHaveBeenCalledOnce();
    expect(harness.lockRequest).toHaveBeenCalledTimes(2);
    expect(harness.local.has('am_cart')).toBe(false);
    expect(harness.local.has('am_cart_merge_attempt_v1')).toBe(false);
  });

  it('keeps the guest cart when the caller-owned attempt cannot be persisted', async () => {
    const mergeGuest = vi.fn();
    const harness = await loginMergeHarness(mergeGuest);
    harness.local.failWrite('am_cart_merge_attempt_v1');

    await expect(harness.merge()).resolves.toBe(1);
    expect(mergeGuest).not.toHaveBeenCalled();
    expect(harness.local.has('am_cart')).toBe(true);
  });

  it('fails closed without truncating a guest cart over the 100-item API limit', async () => {
    const items = Array.from({ length: 101 }, (_, index) => ({ id: `product-${index + 1}`, qty: 1 }));
    const mergeGuest = vi.fn();
    const harness = await loginMergeHarness(mergeGuest, {
      seed: { am_cart: JSON.stringify(items) }
    });

    await expect(harness.merge()).resolves.toBe(1);
    expect(mergeGuest).not.toHaveBeenCalled();
    expect(JSON.parse(harness.local.value('am_cart'))).toEqual(items);
  });

  it('fails closed without truncating a guest wishlist over the 100-item API limit', async () => {
    const items = Array.from({ length: 101 }, (_, index) => `product-${index + 1}`);
    const mergeWishlist = vi.fn();
    const harness = await loginMergeHarness(vi.fn(), {
      seed: { am_wish: JSON.stringify(items) },
      mergeWishlist
    });

    await expect(harness.merge()).resolves.toBe(1);
    expect(mergeWishlist).not.toHaveBeenCalled();
    expect(JSON.parse(harness.local.value('am_wish'))).toEqual(items);
  });

  it('preserves wishlist items added in another tab while an earlier snapshot is merging', async () => {
    let finishWishlist;
    const pendingWishlist = new Promise(resolve => { finishWishlist = resolve; });
    const mergeWishlist = vi.fn(() => pendingWishlist);
    const harness = await loginMergeHarness(vi.fn(), {
      seed: { am_wish: JSON.stringify(['product-1']) },
      mergeWishlist
    });

    const merging = harness.merge();
    while (!mergeWishlist.mock.calls.length) await Promise.resolve();
    harness.local.setItem('am_wish', JSON.stringify(['product-1', 'product-2']));
    finishWishlist({ items: [{ productId: 'product-1' }] });
    await expect(merging).resolves.toBe(0);
    expect(JSON.parse(harness.local.value('am_wish'))).toEqual(['product-2']);
  });

  it('offers a post-authentication choice without merging or redirecting automatically', async () => {
    const mergeGuest = vi.fn();
    const mergeWishlist = vi.fn();
    const cartValue = JSON.stringify([{ id: 'product-1', qty: 2 }]);
    const wishValue = JSON.stringify(['product-2']);
    const harness = await loginMergeHarness(mergeGuest, {
      seed: { am_cart: cartValue, am_wish: wishValue },
      mergeWishlist
    });

    await expect(harness.complete('login')).resolves.toBe('choice');

    expect(mergeGuest).not.toHaveBeenCalled();
    expect(mergeWishlist).not.toHaveBeenCalled();
    expect(harness.local.value('am_cart')).toBe(cartValue);
    expect(harness.local.value('am_wish')).toBe(wishValue);
    expect(harness.elements.guestMergePanel.hidden).toBe(false);
    expect(harness.elements.guestMergeSummary.textContent).toContain('1 cart product(s)');
    expect(harness.elements.guestMergeSummary.textContent).toContain('1 saved item(s)');
    expect(harness.location.replace).not.toHaveBeenCalled();
  });

  it('keeps guest shopping byte-for-byte when the customer chooses to keep it separate', async () => {
    const cartValue = JSON.stringify([{ id: 'product-1', qty: 2 }]);
    const wishValue = JSON.stringify(['product-2']);
    const mergeGuest = vi.fn();
    const mergeWishlist = vi.fn();
    const harness = await loginMergeHarness(mergeGuest, {
      search: '?next=checkout.html',
      seed: { am_cart: cartValue, am_wish: wishValue },
      mergeWishlist
    });

    await harness.complete('login', 'user-1');
    expect(harness.keepSeparate()).toBe(true);

    expect(mergeGuest).not.toHaveBeenCalled();
    expect(mergeWishlist).not.toHaveBeenCalled();
    expect(harness.local.value('am_cart')).toBe(cartValue);
    expect(harness.local.value('am_wish')).toBe(wishValue);
    expect(harness.elements.continueAfterAuthBtn.hidden).toBe(false);
    expect(harness.location.replace).not.toHaveBeenCalled();

    await expect(harness.continueAfterAuth()).resolves.toBe(true);
    expect(harness.storeApi.auth.logout).toHaveBeenCalledOnce();
    expect(harness.lockRequest).toHaveBeenCalledWith(
      'am-market-auth-session-v1',
      { mode: 'exclusive' },
      expect.any(Function)
    );
    expect(harness.broadcastMessages).toContainEqual({
      version: 1,
      type: 'signed-out',
      reason: 'logout',
      userId: 'user-1'
    });
    expect(harness.location.replace).toHaveBeenCalledWith('checkout.html');
    expect(harness.elements.continueAfterAuthBtn.dataset.authCopy).toBe('continueGuestCheckout');
  });

  it('keeps normal post-auth continuation signed in when separate shopping is not a checkout intent', async () => {
    const logout = vi.fn();
    const harness = await loginMergeHarness(vi.fn(), {
      search: '?next=wishlist.html',
      logout,
      seed: { am_cart: JSON.stringify([{ id: 'product-1', qty: 1 }]) }
    });

    await harness.complete('login');
    harness.keepSeparate();
    await expect(harness.continueAfterAuth()).resolves.toBe(true);

    expect(logout).not.toHaveBeenCalled();
    expect(harness.location.replace).toHaveBeenCalledWith('wishlist.html');
    expect(harness.elements.continueAfterAuthBtn.dataset.authCopy).toBe('continueAfterAuth');
  });

  it('merges only after consent, confirms wishlist membership, and waits for explicit continuation', async () => {
    const mergeGuest = vi.fn().mockResolvedValue({ replayed: false, cart: { items: [] } });
    const mergeWishlist = vi.fn().mockResolvedValue({
      items: [{ productId: 'product-2' }]
    });
    const harness = await loginMergeHarness(mergeGuest, {
      seed: {
        am_cart: JSON.stringify([{ id: 'product-1', qty: 2 }]),
        am_wish: JSON.stringify(['product-2'])
      },
      mergeWishlist
    });

    await harness.complete('login');
    await expect(harness.accept()).resolves.toBe(true);

    expect(mergeGuest).toHaveBeenCalledOnce();
    expect(mergeWishlist).toHaveBeenCalledWith({ items: ['product-2'] });
    expect(harness.local.has('am_cart')).toBe(false);
    expect(harness.local.has('am_wish')).toBe(false);
    expect(harness.elements.continueAfterAuthBtn.hidden).toBe(false);
    expect(harness.location.replace).not.toHaveBeenCalled();
  });

  it('removes only wishlist IDs confirmed by the merge response and leaves retry available', async () => {
    const mergeWishlist = vi.fn().mockResolvedValue({
      items: [{ productId: 'product-1' }]
    });
    const harness = await loginMergeHarness(vi.fn(), {
      seed: { am_wish: JSON.stringify(['product-1', 'product-2']) },
      mergeWishlist
    });

    await harness.complete('login');
    await expect(harness.accept()).resolves.toBe(false);

    expect(JSON.parse(harness.local.value('am_wish'))).toEqual(['product-2']);
    expect(harness.elements.mergeGuestBtn.hidden).toBe(false);
    expect(harness.elements.mergeGuestBtn.querySelector('[data-auth-copy]').dataset.authCopy).toBe('retryMerge');
    expect(harness.elements.continueAfterAuthBtn.hidden).toBe(true);
    expect(harness.location.replace).not.toHaveBeenCalled();
  });

  it('preserves an ambiguous cart attempt, retries with the same key, and does not redirect early', async () => {
    const mergeGuest = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('response lost'), { code: 'REQUEST_TIMEOUT' }))
      .mockResolvedValueOnce({ replayed: true, cart: { items: [] } });
    const harness = await loginMergeHarness(mergeGuest);

    await harness.complete('login');
    await expect(harness.accept()).resolves.toBe(false);
    expect(harness.local.has('am_cart')).toBe(true);
    expect(harness.local.has('am_cart_merge_attempt_v1')).toBe(true);
    expect(harness.location.replace).not.toHaveBeenCalled();

    await expect(harness.accept()).resolves.toBe(true);
    expect(mergeGuest).toHaveBeenCalledTimes(2);
    expect(mergeGuest.mock.calls[1][1]).toEqual(mergeGuest.mock.calls[0][1]);
    expect(harness.storeApi.createIdempotencyKey).toHaveBeenCalledOnce();
    expect(harness.local.has('am_cart')).toBe(false);
    expect(harness.local.has('am_cart_merge_attempt_v1')).toBe(false);
    expect(harness.location.replace).not.toHaveBeenCalled();
  });

  it('keeps cart data and the durable attempt when browser cleanup fails after server success', async () => {
    const mergeGuest = vi.fn().mockResolvedValue({ replayed: false, cart: { items: [] } });
    const harness = await loginMergeHarness(mergeGuest);
    harness.local.failRemove('am_cart');

    await harness.complete('login');
    await expect(harness.accept()).resolves.toBe(false);

    expect(harness.local.has('am_cart')).toBe(true);
    expect(harness.local.has('am_cart_merge_attempt_v1')).toBe(true);
    expect(harness.elements.mergeGuestBtn.hidden).toBe(false);
    expect(harness.location.replace).not.toHaveBeenCalled();
  });
});
