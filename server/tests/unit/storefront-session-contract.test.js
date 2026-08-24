import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const coreUrl = new URL('../../../js/core.js', import.meta.url);
const settingsUrl = new URL('../../../js/settings.js', import.meta.url);
const productUrl = new URL('../../../js/product.js', import.meta.url);

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    has: (key) => values.has(key)
  };
}

function broadcastHub({ constructFails = false, postFails = false } = {}) {
  const channels = new Set();
  let postCount = 0;
  class FakeBroadcastChannel {
    constructor(name) {
      if (constructFails) throw new Error('blocked BroadcastChannel construction');
      this.name = name;
      this.listeners = new Set();
      channels.add(this);
    }
    addEventListener(type, listener) {
      if (type === 'message') this.listeners.add(listener);
    }
    postMessage(data) {
      postCount += 1;
      if (postFails) throw new Error('blocked BroadcastChannel post');
      channels.forEach(channel => {
        if (channel === this || channel.name !== this.name) return;
        channel.listeners.forEach(listener => listener({ data }));
      });
    }
    close() {
      channels.delete(this);
    }
  }
  return { BroadcastChannel: FakeBroadcastChannel, posts: () => postCount };
}

async function loadCoreSessionHarness({
  storageRemovalFails = false,
  frontend = false,
  authBroadcast = null,
  locks = null,
  bootstrap = null,
  fetchImpl = fetch
} = {}) {
  const events = new EventTarget();
  const localSeed = {
    am_user: 'legacy',
    am_profile: 'legacy',
    am_orders: 'legacy'
  };
  if (frontend) {
    localSeed.am_cart = JSON.stringify([{ id: 'guest-product', qty: 3 }]);
    localSeed.am_wish = JSON.stringify(['guest-product']);
  }
  const local = storage(localSeed);
  const session = storage({ am_user: 'legacy', am_profile: 'legacy' });
  if (storageRemovalFails) {
    local.removeItem = () => { throw Object.assign(new Error('blocked local storage'), { name: 'SecurityError' }); };
    session.removeItem = () => { throw Object.assign(new Error('blocked session storage'), { name: 'SecurityError' }); };
  }
  const document = {
    activeElement: null,
    baseURI: 'https://localhost:3443/',
    body: {
      dataset: frontend ? { page: 'test' } : { admin: 'true', page: 'test' },
      insertAdjacentHTML() {},
      prepend() {}
    },
    documentElement: { setAttribute() {} },
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { throw new Error('The session clear path must not create UI when no recovery banner exists.'); }
  };
  const storeApi = frontend ? { bootstrap: bootstrap || (() => new Promise(() => {})) } : null;
  const window = {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    StoreAPI: storeApi,
    scrollTo() {}
  };
  if (authBroadcast) window.BroadcastChannel = authBroadcast.BroadcastChannel;
  const context = {
    AbortController,
    AbortSignal,
    CustomEvent,
    Event,
    URL,
    URLSearchParams,
    clearInterval,
    clearTimeout,
    console,
    document,
    fetch: fetchImpl,
    getLang: () => 'en',
    localStorage: local,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame: (callback) => callback(),
    sessionStorage: session,
    setInterval,
    setTimeout,
    StoreAPI: storeApi,
    t: (key) => key,
    window
  };
  if (locks) context.navigator = { locks };
  context.globalThis = context;

  const source = await readFile(coreUrl, 'utf8');
  const hooks = `
    globalThis.__sessionTest = {
      seedAuthenticated() {
        sessionExpiryHandled = false;
        currentUser = { id: 'user-1', email: 'customer@example.test' };
        currentPreferences = { theme: 'dark' };
        savedAddresses = [{ id: 'address-1' }];
        cart = [{ id: 'product-1', qty: 2 }];
        wishlist = ['product-1'];
        orders = [{ id: 'order-1' }];
        accountNotifications = [{ id: 'notification-1' }];
        accountUnreadCount = 1;
        authenticatedRecent = [{ id: 'product-1' }];
        authenticatedSearches = [{ query: 'milk' }];
        accountRecoveryPending = true;
        Object.keys(authenticatedResourceState).forEach(key => { authenticatedResourceState[key] = 'error'; });
      },
      handle: handleStoreUnauthorized,
      transition: transitionStoreToSignedOut,
      broadcastSignedOut: broadcastStoreSignedOut,
      broadcastInvalidated: broadcastStoreSessionInvalidated,
      broadcastAccountChanged: broadcastStoreAccountChanged,
      broadcastGuestCommerceChanged: broadcastStoreGuestCommerceChanged,
      authLock: withStoreAuthSessionLock,
      authChannelName: STORE_AUTH_CHANNEL_NAME,
      authLockName: STORE_AUTH_SESSION_LOCK_NAME,
      ready: () => storeReady,
      capture: captureAuthenticatedRequest,
      isCurrent: isAuthenticatedRequestCurrent,
      seedAuthoritativeUnavailableCart() {
        currentUser = { id: 'user-1', email: 'customer@example.test' };
        cart = cartFromApi({ cart: { items: [{
          productId: 'product-1', quantity: 2, name: 'Stored milk', unitPrice: '12.00',
          imageUrl: '/stored.jpg', brand: 'AM', isAvailable: false, stockQuantity: 0,
          quantityAvailable: false, verified: false
        }] } });
        productCache['product-1'] = {
          id: 'product-1', name: 'Stale milk', price: '12.00', image_url: '/cached.jpg',
          brand_name: 'AM', is_available: true, stock_quantity: 50, quantity_available: true,
          load_failed: false
        };
      },
      cartItems: getCartItems,
      fetchProducts,
      snapshot() {
        return {
          epoch: authStateEpoch,
          user: currentUser,
          preferences: currentPreferences,
          addresses: savedAddresses,
          cart,
          wishlist,
          orders,
          notifications: accountNotifications,
          unread: accountUnreadCount,
          recent: authenticatedRecent,
          searches: authenticatedSearches,
          recoveryPending: accountRecoveryPending,
          resources: { ...authenticatedResourceState }
        };
      }
    };
  `;
  vm.runInNewContext(`${source}\n${hooks}`, context, { filename: 'js/core.js' });
  return { hooks: context.__sessionTest, events, local, session };
}

describe('storefront session-expiry transition', () => {
  it('ignores guest/non-401 failures, then clears account state and emits exactly one event for concurrent 401s', async () => {
    const { hooks, events, local, session } = await loadCoreSessionHarness();
    const received = [];
    events.addEventListener('am:session-expired', event => received.push(event.detail));

    expect(hooks.handle({ status: 401 })).toBe(false); // failed login or true guest
    expect(hooks.handle({ status: 503 })).toBe(false);
    expect(received).toHaveLength(0);

    hooks.seedAuthenticated();
    const requestContext = hooks.capture();
    expect(hooks.isCurrent(requestContext)).toBe(true);
    const before = hooks.snapshot();
    expect(hooks.handle({ status: 401 })).toBe(true);
    const after = hooks.snapshot();

    expect(after.epoch).toBe(before.epoch + 1);
    expect(hooks.isCurrent(requestContext)).toBe(false);
    expect(after).toMatchObject({
      user: null,
      preferences: null,
      addresses: [],
      cart: [],
      wishlist: [],
      orders: [],
      notifications: [],
      unread: 0,
      recent: [],
      searches: [],
      recoveryPending: false,
      resources: {
        cart: 'ready', wishlist: 'ready', notifications: 'ready', recent: 'ready', search: 'ready'
      }
    });
    expect(received).toEqual([{ reason: 'unauthorized' }]);
    expect(local.has('am_user')).toBe(false);
    expect(local.has('am_profile')).toBe(false);
    expect(local.has('am_orders')).toBe(false);
    expect(session.has('am_user')).toBe(false);
    expect(session.has('am_profile')).toBe(false);

    expect(hooks.handle({ status: 401 })).toBe(true);
    expect(received).toHaveLength(1);
  });

  it('keeps server cart availability authoritative over a stale product cache', async () => {
    const { hooks } = await loadCoreSessionHarness();
    hooks.seedAuthoritativeUnavailableCart();
    const items = await hooks.cartItems();
    expect(items[0].product).toMatchObject({
      name: 'Stored milk', image_url: '/stored.jpg', is_available: false,
      stock_quantity: 0, quantity_available: false, load_failed: true
    });
  });

  it('does not turn an inactive maximum-price filter into max_price=0', async () => {
    const requested = [];
    const fetchImpl = async url => {
      requested.push(String(url));
      return new Response(JSON.stringify({ count: 0, next: null, previous: null, results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };
    const { hooks } = await loadCoreSessionHarness({ fetchImpl });

    await hooks.fetchProducts(1, null, '', '', 20, { maxPrice: null });
    await hooks.fetchProducts(1, null, '', '', 20, { maxPrice: 0 });

    expect(new URL(requested[0]).searchParams.has('max_price')).toBe(false);
    expect(new URL(requested[1]).searchParams.get('max_price')).toBe('0');
  });

  it('still clears private UI state and emits expiry when browser storage cleanup is blocked', async () => {
    const { hooks, events } = await loadCoreSessionHarness({ storageRemovalFails: true });
    const received = [];
    events.addEventListener('am:session-expired', event => received.push(event.detail));
    hooks.seedAuthenticated();

    expect(hooks.handle({ status: 401 })).toBe(true);
    expect(hooks.snapshot()).toMatchObject({ user: null, cart: [], wishlist: [], orders: [] });
    expect(received).toEqual([{ reason: 'unauthorized' }]);
  });

  it('propagates matching sign-out across tabs exactly once without clearing a guest snapshot', async () => {
    const authBroadcast = broadcastHub();
    const first = await loadCoreSessionHarness({ frontend: true, authBroadcast });
    const second = await loadCoreSessionHarness({ frontend: true, authBroadcast });
    const guest = await loadCoreSessionHarness({ frontend: true, authBroadcast });
    const secondEvents = [];
    second.events.addEventListener('am:session-expired', event => secondEvents.push(event.detail));
    first.hooks.seedAuthenticated();
    second.hooks.seedAuthenticated();

    expect(first.hooks.transition({ reason: 'logout', notify: false })).toBe(true);
    expect(first.hooks.broadcastSignedOut('logout', 'user-1')).toBe(true);

    expect(first.hooks.snapshot().user).toBe(null);
    expect(second.hooks.snapshot()).toMatchObject({
      user: null,
      cart: [{ id: 'guest-product', qty: 3 }],
      wishlist: ['guest-product'],
      orders: []
    });
    expect(secondEvents).toEqual([{ reason: 'logout' }]);
    expect(guest.hooks.snapshot()).toMatchObject({
      user: null,
      cart: [{ id: 'guest-product', qty: 3 }],
      wishlist: ['guest-product']
    });
    expect(authBroadcast.posts()).toBe(1);
  });

  it('does not let a pre-bootstrap signed-out tab rehydrate private state or lose guest commerce', async () => {
    const authBroadcast = broadcastHub();
    let resolveBootstrap;
    const bootstrap = () => new Promise(resolve => { resolveBootstrap = resolve; });
    const sender = await loadCoreSessionHarness({ frontend: true, authBroadcast });
    const pending = await loadCoreSessionHarness({ frontend: true, authBroadcast, bootstrap });

    expect(sender.hooks.broadcastSignedOut('logout', 'user-1')).toBe(true);
    resolveBootstrap({
      authenticated: true,
      user: { id: 'user-1', email: 'customer@example.test', displayName: 'Customer' }
    });
    await pending.hooks.ready();

    expect(pending.hooks.snapshot()).toMatchObject({
      user: null,
      cart: [{ id: 'guest-product', qty: 3 }],
      wishlist: ['guest-product']
    });
  });

  it('ignores another user sign-out, clears stale accounts on account changes, and preserves guests', async () => {
    const authBroadcast = broadcastHub();
    const sender = await loadCoreSessionHarness({ frontend: true, authBroadcast });
    const authenticated = await loadCoreSessionHarness({ frontend: true, authBroadcast });
    const guest = await loadCoreSessionHarness({ frontend: true, authBroadcast });
    authenticated.hooks.seedAuthenticated();

    expect(sender.hooks.broadcastSignedOut('logout', 'user-2')).toBe(true);
    expect(authenticated.hooks.snapshot().user?.id).toBe('user-1');
    expect(sender.hooks.broadcastAccountChanged('user-2')).toBe(true);
    expect(authenticated.hooks.snapshot().user).toBe(null);
    expect(guest.hooks.snapshot()).toMatchObject({
      cart: [{ id: 'guest-product', qty: 3 }],
      wishlist: ['guest-product']
    });
  });

  it('refreshes guest commerce from channel and storage changes without touching authenticated state', async () => {
    const authBroadcast = broadcastHub();
    const sender = await loadCoreSessionHarness({ frontend: true, authBroadcast });
    const guest = await loadCoreSessionHarness({ frontend: true, authBroadcast });
    const authenticated = await loadCoreSessionHarness({ frontend: true, authBroadcast });
    authenticated.hooks.seedAuthenticated();
    guest.local.setItem('am_cart', JSON.stringify([{ id: 'new-guest-product', qty: 2 }]));
    guest.local.setItem('am_wish', JSON.stringify(['new-guest-product']));
    authenticated.local.setItem('am_cart', JSON.stringify([{ id: 'wrong-guest-product', qty: 8 }]));

    expect(sender.hooks.broadcastGuestCommerceChanged()).toBe(true);
    expect(guest.hooks.snapshot()).toMatchObject({
      cart: [{ id: 'new-guest-product', qty: 2 }],
      wishlist: ['new-guest-product']
    });
    expect(authenticated.hooks.snapshot()).toMatchObject({
      user: { id: 'user-1' },
      cart: [{ id: 'product-1', qty: 2 }]
    });

    guest.local.setItem('am_cart', JSON.stringify([{ id: 'storage-product', qty: 4 }]));
    const storageEvent = new Event('storage');
    Object.defineProperty(storageEvent, 'key', { value: 'am_cart' });
    guest.events.dispatchEvent(storageEvent);
    expect(guest.hooks.snapshot().cart).toEqual([{ id: 'storage-product', qty: 4 }]);
  });

  it('clears only other tabs after a password session change and uses the shared exclusive auth lock', async () => {
    const authBroadcast = broadcastHub();
    const sender = await loadCoreSessionHarness({ frontend: true, authBroadcast });
    const receiver = await loadCoreSessionHarness({ frontend: true, authBroadcast });
    sender.hooks.seedAuthenticated();
    receiver.hooks.seedAuthenticated();

    expect(sender.hooks.broadcastInvalidated('password-changed', 'user-1')).toBe(true);
    expect(sender.hooks.snapshot().user?.id).toBe('user-1');
    expect(receiver.hooks.snapshot().user).toBe(null);

    const resetReceiver = await loadCoreSessionHarness({ frontend: true, authBroadcast });
    resetReceiver.hooks.seedAuthenticated();
    expect(sender.hooks.broadcastInvalidated('password-reset', null)).toBe(true);
    expect(resetReceiver.hooks.snapshot().user).toBe(null);

    const requests = [];
    const lockHarness = await loadCoreSessionHarness({
      locks: {
        request(name, options, work) {
          requests.push({ name, options });
          return work();
        }
      }
    });
    await expect(lockHarness.hooks.authLock(async () => 'done')).resolves.toBe('done');
    expect(requests).toEqual([{
      name: 'am-market-auth-session-v1',
      options: { mode: 'exclusive' }
    }]);
    expect(lockHarness.hooks.authLockName).toBe('am-market-auth-session-v1');
    expect(lockHarness.hooks.authChannelName).toBe('am-market-auth-state-v1');
    const unavailable = await loadCoreSessionHarness();
    await expect(unavailable.hooks.authLock(async () => 'unsafe')).rejects.toMatchObject({
      code: 'AUTH_LOCK_UNAVAILABLE'
    });
  });

  it('clears authenticated state on local session identity changes without rebroadcasting', async () => {
    const authBroadcast = broadcastHub();
    const authenticated = await loadCoreSessionHarness({ frontend: true, authBroadcast });
    const guest = await loadCoreSessionHarness({ frontend: true, authBroadcast });
    authenticated.hooks.seedAuthenticated();

    authenticated.events.dispatchEvent(new CustomEvent('am:session-changed', {
      detail: { reason: 'session-changed' }
    }));
    guest.events.dispatchEvent(new CustomEvent('am:session-changed', {
      detail: { reason: 'session-changed' }
    }));

    expect(authenticated.hooks.snapshot().user).toBe(null);
    expect(authenticated.hooks.snapshot()).toMatchObject({
      cart: [{ id: 'guest-product', qty: 3 }],
      wishlist: ['guest-product']
    });
    expect(guest.hooks.snapshot()).toMatchObject({
      cart: [{ id: 'guest-product', qty: 3 }],
      wishlist: ['guest-product']
    });
    expect(authBroadcast.posts()).toBe(0);
  });

  it('keeps local teardown successful when BroadcastChannel posting is blocked', async () => {
    const authBroadcast = broadcastHub({ postFails: true });
    const { hooks } = await loadCoreSessionHarness({ frontend: true, authBroadcast });
    hooks.seedAuthenticated();
    expect(hooks.transition({ reason: 'logout', notify: false })).toBe(true);
    expect(hooks.broadcastSignedOut('logout', 'user-1')).toBe(false);
    expect(hooks.snapshot()).toMatchObject({
      user: null,
      cart: [{ id: 'guest-product', qty: 3 }],
      wishlist: ['guest-product'],
      orders: []
    });

    const constructionBlocked = broadcastHub({ constructFails: true });
    const withoutChannel = await loadCoreSessionHarness({ frontend: true, authBroadcast: constructionBlocked });
    withoutChannel.hooks.seedAuthenticated();
    expect(withoutChannel.hooks.transition({ reason: 'logout', notify: false })).toBe(true);
    expect(withoutChannel.hooks.broadcastSignedOut('logout', 'user-1')).toBe(false);
  });

  it('serializes every settings operation that changes the authenticated session', async () => {
    const source = await readFile(settingsUrl, 'utf8');
    expect(source).toContain("const authSessionLockName = 'am-market-auth-session-v1'");
    expect(source).toMatch(/runAuthSessionMutation\(logout\)/);
    expect(source).toMatch(/runAuthSessionMutation\(changePassword\)/);
    expect(source).toMatch(/runAuthSessionMutation\(closeSession\)/);
    expect(source).toContain("broadcastStoreSessionInvalidated('password-changed'");
    expect(source).toContain("completeClientSignOut('logout')");
    expect(source).toContain("completeClientSignOut('account-closed')");
  });

  it('keeps the product wishlist control aligned with restored guest state', async () => {
    const source = await readFile(productUrl, 'utf8');
    expect(source).toContain("window.addEventListener('am:guest-commerce-changed', syncDetailWishlistButton)");
    expect(source).toMatch(/const saved = wishlist\.includes\(String\(productId\)\)/);
  });
});
