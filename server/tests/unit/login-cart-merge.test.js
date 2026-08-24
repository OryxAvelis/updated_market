import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const loginUrl = new URL('../../../js/login.js', import.meta.url);

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  const failingWrites = new Set();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => {
      if (failingWrites.has(key)) throw new Error('storage write failed');
      values.set(key, String(value));
    },
    removeItem: key => values.delete(key),
    has: key => values.has(key),
    value: key => values.get(key),
    failWrite: key => failingWrites.add(key)
  };
}

async function loginMergeHarness(mergeGuest, options = {}) {
  const local = storage(options.seed || { am_cart: JSON.stringify([{ id: 'product-2', qty: 1 }, { id: 'product-1', qty: 2 }]) });
  let lockTail = Promise.resolve();
  const lockRequest = vi.fn((_name, _options, callback) => {
    const result = lockTail.then(callback);
    lockTail = result.catch(() => {});
    return result;
  });
  const context = {
    URLSearchParams,
    console,
    document: { addEventListener() {}, querySelectorAll() { return []; }, getElementById() { return null; } },
    getLang: () => 'en',
    location: { search: '', replace() {} },
    localStorage: local,
    navigator: { locks: { request: lockRequest } },
    setTimeout,
    StoreAPI: {
      bootstrap: vi.fn(),
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
    globalThis.__loginMergeTest = { merge: mergeGuestShopping };
  })();`);
  vm.runInNewContext(instrumented, context, {
    filename: 'js/login.js'
  });
  return { merge: context.__loginMergeTest.merge, local, lockRequest, storeApi: context.StoreAPI };
}

describe('post-authentication guest cart merge', () => {
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
    finishWishlist({ wishlist: { items: ['product-1'] } });
    await expect(merging).resolves.toBe(0);
    expect(JSON.parse(harness.local.value('am_wish'))).toEqual(['product-2']);
  });
});
