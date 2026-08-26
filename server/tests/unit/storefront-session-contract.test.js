import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const coreUrl = new URL('../../../js/core.js', import.meta.url);
const settingsUrl = new URL('../../../js/settings.js', import.meta.url);
const settingsMarkupUrl = new URL('../../../settings.html', import.meta.url);
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
  baseUrl = 'https://localhost:3443/',
  authBroadcast = null,
  locks = null,
  bootstrap = null,
  storeApiOverrides = {},
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
    baseURI: baseUrl,
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
  const storeApi = frontend ? {
    bootstrap: bootstrap || (() => new Promise(() => {})),
    ...storeApiOverrides
  } : null;
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
      seedAuthenticatedCommerce({ cartItems = [], wishlistItems = [], pricing = null, checkoutReady = false } = {}) {
        sessionExpiryHandled = false;
        currentUser = { id: 'user-1', email: 'customer@example.test' };
        authenticatedResourceState.cart = 'ready';
        authenticatedResourceState.wishlist = 'ready';
        cart = adoptAuthenticatedCart({ cart: { items: cartItems, pricing, checkoutReady } });
        wishlist = adoptAuthenticatedWishlist({
          items: wishlistItems.map(productId => ({ productId }))
        });
      },
      replaceCart(items) {
        cart = normalizeCart(items);
        return saveCart();
      },
      replaceWishlist(items) {
        wishlist = [...new Set(items.map(String))];
        return saveWish();
      },
      cartItems: getCartItems,
      fetchCategories,
      fetchProducts,
      normalizeNotifications: notificationsFromApi,
      notificationMessage,
      deliverySettings: getStoreDeliverySettings,
      authenticatedCartPricing: getAuthenticatedCartPricing,
      deliveryConfigReady: isStoreDeliveryConfigReady,
      refreshDeliveryConfig: refreshStorefrontConfig,
      calculateDeliveryFee: deliveryFee,
      calculateSubtotal: itemsSubtotal,
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

function commerceApi({ cartEntries = [], wishlistIds = [] } = {}) {
  const remoteCart = new Map(cartEntries.map(([id, quantity]) => [String(id), Number(quantity)]));
  const remoteWishlist = new Set(wishlistIds.map(String));
  const api = {
    cart: {
      get: vi.fn(async () => ({
        cart: {
          items: [...remoteCart].map(([productId, quantity]) => ({ productId, quantity }))
        }
      })),
      addItem: vi.fn(async ({ productId, quantity }) => {
        const id = String(productId);
        remoteCart.set(id, (remoteCart.get(id) || 0) + Number(quantity));
      }),
      updateItem: vi.fn(async (productId, { quantity }) => {
        remoteCart.set(String(productId), Number(quantity));
      }),
      removeItem: vi.fn(async productId => {
        remoteCart.delete(String(productId));
      })
    },
    wishlist: {
      get: vi.fn(async () => ({
        items: [...remoteWishlist].map(productId => ({ productId }))
      })),
      addItem: vi.fn(async ({ productId }) => {
        remoteWishlist.add(String(productId));
      }),
      removeItem: vi.fn(async productId => {
        remoteWishlist.delete(String(productId));
      })
    }
  };
  return { api, remoteCart, remoteWishlist };
}

describe('storefront session-expiry transition', () => {
  it('preserves bounded notification context and translates every backend lifecycle type', async () => {
    const { hooks } = await loadCoreSessionHarness();
    const normalized = hooks.normalizeNotifications({
      unreadCount: 1,
      notifications: [{
        id: 'notification-1',
        type: 'return_approved',
        payload: {
          message: `  ${'x'.repeat(400)}  `,
          orderNumber: 'AM-100',
          returnId: 'return-1',
          status: 'approved'
        }
      }]
    });

    expect(normalized.notifications[0].payload).toMatchObject({
      orderNumber: 'AM-100',
      returnId: 'return-1',
      status: 'approved'
    });
    expect(normalized.notifications[0].payload.message).toHaveLength(300);
    expect(hooks.notificationMessage(normalized.notifications[0])).toBe('notif_return_approved');
    expect(hooks.notificationMessage({ type: 'payment_paid', payload: {} })).toBe('notif_payment_paid');
    expect(hooks.notificationMessage({ type: 'restocked', payload: {} })).toBe('notif_back_in_stock');
    expect(hooks.notificationMessage({ type: 'future_event', payload: { message: 'Account updated.' } }))
      .toBe('Account updated.');
  });

  it('uses the public database-backed delivery configuration for guest totals', async () => {
    const { hooks } = await loadCoreSessionHarness({
      frontend: true,
      bootstrap: async () => ({ authenticated: false }),
      storeApiOverrides: {
        storefront: {
          config: async () => ({ delivery: { revision: '3', defaultFee: '17.50', freeThreshold: '150.00' } })
        }
      }
    });

    await hooks.ready();
    expect(hooks.deliverySettings()).toEqual({
      defaultFee: 17.5,
      defaultFeeCents: 1750,
      freeThreshold: 150,
      freeThresholdCents: 15000,
      revision: '3'
    });
    expect(hooks.calculateDeliveryFee(0)).toBe(17.5);
    expect(hooks.calculateDeliveryFee(149.99)).toBe(17.5);
    expect(hooks.calculateDeliveryFee(150)).toBe(0);
  });

  it('keeps delivery threshold calculations identical to integer-cent backend totals', async () => {
    const { hooks } = await loadCoreSessionHarness({
      frontend: true,
      bootstrap: async () => ({ authenticated: false }),
      storeApiOverrides: {
        storefront: {
          config: async () => ({
            delivery: {
              defaultFee: '20.00',
              defaultFeeCents: 2000,
              freeThreshold: '200.00',
              freeThresholdCents: 20000,
              revision: '8'
            }
          })
        }
      }
    });

    await hooks.ready();
    const subtotal = hooks.calculateSubtotal([
      { qty: 1, product: { price: '0.01' } },
      { qty: 1, product: { price: '129.92' } },
      { qty: 1, product: { price: '70.07' } }
    ]);
    expect(subtotal).toBe(200);
    expect(hooks.calculateDeliveryFee(subtotal)).toBe(0);
  });

  it('preserves the signed-in server cart quote when public configuration is unavailable', async () => {
    const { hooks } = await loadCoreSessionHarness({
      frontend: true,
      bootstrap: async () => ({ authenticated: false }),
      storeApiOverrides: {
        storefront: { config: async () => { throw new Error('cold start'); } }
      }
    });

    await hooks.ready();
    hooks.seedAuthenticatedCommerce({
      cartItems: [{
        productId: 'free-product', quantity: 1, name: 'Sample', unitPrice: '0.00',
        imageUrl: null, brand: 'AM', isAvailable: true, stockQuantity: null,
        quantityAvailable: true, verified: true
      }],
      pricing: {
        deliveryRevision: '4', subtotalCents: 0, deliveryFeeCents: 2000, totalCents: 2000
      },
      checkoutReady: true
    });
    expect(hooks.deliveryConfigReady()).toBe(false);
    expect(hooks.authenticatedCartPricing()).toEqual({
      deliveryRevision: '4',
      subtotalCents: 0,
      deliveryFeeCents: 2000,
      totalCents: 2000,
      checkoutReady: true
    });
  });

  it('waits for storefront configuration even when authentication bootstrap fails', async () => {
    const { hooks } = await loadCoreSessionHarness({
      frontend: true,
      bootstrap: async () => { throw new Error('auth unavailable'); },
      storeApiOverrides: {
        storefront: {
          config: async () => {
            await new Promise(resolve => setTimeout(resolve, 5));
            return {
              delivery: {
                defaultFeeCents: 900,
                freeThresholdCents: 9900,
                revision: '9'
              }
            };
          }
        }
      }
    });

    await hooks.ready();
    expect(hooks.deliverySettings()).toMatchObject({
      defaultFee: 9,
      defaultFeeCents: 900,
      freeThreshold: 99,
      freeThresholdCents: 9900,
      revision: '9'
    });
    expect(hooks.deliveryConfigReady()).toBe(true);
  });

  it('fails checkout pricing closed when the public delivery configuration is unavailable', async () => {
    const config = vi.fn(async () => { throw new Error('config unavailable'); });
    const { hooks } = await loadCoreSessionHarness({
      frontend: true,
      bootstrap: async () => ({ authenticated: false }),
      storeApiOverrides: { storefront: { config } }
    });

    await hooks.ready();
    expect(hooks.deliveryConfigReady()).toBe(false);
    await expect(hooks.refreshDeliveryConfig()).rejects.toThrow('config unavailable');
    expect(hooks.deliveryConfigReady()).toBe(false);
    expect(config).toHaveBeenCalledTimes(2);
  });

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

  it('syncs only cart intents so a concurrent remote addition survives an update and explicit removal', async () => {
    const commerce = commerceApi({
      cartEntries: [['remove-me', 1], ['update-me', 1]]
    });
    const { hooks } = await loadCoreSessionHarness({
      frontend: true,
      storeApiOverrides: commerce.api
    });
    hooks.seedAuthenticatedCommerce({
      cartItems: [
        { productId: 'remove-me', quantity: 1 },
        { productId: 'update-me', quantity: 1 }
      ]
    });

    commerce.remoteCart.set('remote-added', 4);
    await hooks.replaceCart([{ id: 'update-me', qty: 2 }]);

    expect([...commerce.remoteCart]).toEqual([
      ['update-me', 2],
      ['remote-added', 4]
    ]);
    expect(commerce.api.cart.removeItem).toHaveBeenCalledTimes(1);
    expect(commerce.api.cart.removeItem).toHaveBeenCalledWith('remove-me');
    expect(commerce.api.cart.removeItem).not.toHaveBeenCalledWith('remote-added');
  });

  it('matches the additive cart API when another device adds the same product between read and write', async () => {
    const commerce = commerceApi();
    commerce.api.cart.get.mockImplementationOnce(async () => {
      // The response is the stale empty snapshot that this device read. Before
      // its POST reaches MySQL, another device has added one unit.
      commerce.remoteCart.set('shared-product', 1);
      return { cart: { items: [] } };
    });
    const { hooks } = await loadCoreSessionHarness({
      frontend: true,
      storeApiOverrides: commerce.api
    });
    hooks.seedAuthenticatedCommerce();

    await expect(hooks.replaceCart([{ id: 'shared-product', qty: 2 }])).resolves.toBe(true);

    expect(commerce.api.cart.addItem).toHaveBeenCalledWith({
      productId: 'shared-product',
      quantity: 2
    });
    expect(commerce.remoteCart.get('shared-product')).toBe(3);
    expect(hooks.snapshot().cart).toContainEqual(expect.objectContaining({
      id: 'shared-product',
      qty: 3
    }));
  });

  it('syncs only wishlist intents so a concurrent remote addition survives an add and explicit removal', async () => {
    const commerce = commerceApi({
      wishlistIds: ['remove-me', 'keep-me']
    });
    const { hooks } = await loadCoreSessionHarness({
      frontend: true,
      storeApiOverrides: commerce.api
    });
    hooks.seedAuthenticatedCommerce({
      wishlistItems: ['remove-me', 'keep-me']
    });

    commerce.remoteWishlist.add('remote-added');
    await hooks.replaceWishlist(['keep-me', 'local-added']);

    expect([...commerce.remoteWishlist]).toEqual(['keep-me', 'remote-added', 'local-added']);
    expect(commerce.api.wishlist.removeItem).toHaveBeenCalledTimes(1);
    expect(commerce.api.wishlist.removeItem).toHaveBeenCalledWith('remove-me');
    expect(commerce.api.wishlist.removeItem).not.toHaveBeenCalledWith('remote-added');
  });

  it('replays every pending cart intent when an earlier queued add fails', async () => {
    const commerce = commerceApi({ cartEntries: [['seed', 1]] });
    commerce.api.cart.addItem.mockRejectedValueOnce(new Error('first cart add failed'));
    const { hooks } = await loadCoreSessionHarness({
      frontend: true,
      storeApiOverrides: commerce.api
    });
    hooks.seedAuthenticatedCommerce({
      cartItems: [{ productId: 'seed', quantity: 1 }]
    });
    commerce.remoteCart.set('remote-added', 3);

    const first = hooks.replaceCart([
      { id: 'seed', qty: 1 },
      { id: 'first-local', qty: 2 }
    ]);
    const second = hooks.replaceCart([
      { id: 'seed', qty: 1 },
      { id: 'first-local', qty: 2 },
      { id: 'second-local', qty: 4 }
    ]);

    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect([...commerce.remoteCart]).toEqual([
      ['seed', 1],
      ['remote-added', 3],
      ['first-local', 2],
      ['second-local', 4]
    ]);
    expect(commerce.api.cart.addItem).toHaveBeenCalledTimes(3);
  });

  it('removes a cart item added by an earlier queued sync whose refresh failed', async () => {
    const commerce = commerceApi({ cartEntries: [['seed', 1]] });
    let getCount = 0;
    commerce.api.cart.get.mockImplementation(async () => {
      getCount += 1;
      if (getCount === 2) throw new Error('cart refresh failed after add');
      return {
        cart: {
          items: [...commerce.remoteCart].map(([productId, quantity]) => ({ productId, quantity }))
        }
      };
    });
    const { hooks } = await loadCoreSessionHarness({
      frontend: true,
      storeApiOverrides: commerce.api
    });
    hooks.seedAuthenticatedCommerce({
      cartItems: [{ productId: 'seed', quantity: 1 }]
    });

    const add = hooks.replaceCart([
      { id: 'seed', qty: 1 },
      { id: 'transient', qty: 2 }
    ]);
    const remove = hooks.replaceCart([{ id: 'seed', qty: 1 }]);

    await expect(add).resolves.toBe(false);
    await expect(remove).resolves.toBe(true);
    expect([...commerce.remoteCart]).toEqual([['seed', 1]]);
    expect(commerce.api.cart.addItem).toHaveBeenCalledWith({ productId: 'transient', quantity: 2 });
    expect(commerce.api.cart.removeItem).toHaveBeenCalledWith('transient');
  });

  it('replays every pending wishlist intent when an earlier queued add fails', async () => {
    const commerce = commerceApi({ wishlistIds: ['seed'] });
    commerce.api.wishlist.addItem.mockRejectedValueOnce(new Error('first wishlist add failed'));
    const { hooks } = await loadCoreSessionHarness({
      frontend: true,
      storeApiOverrides: commerce.api
    });
    hooks.seedAuthenticatedCommerce({ wishlistItems: ['seed'] });
    commerce.remoteWishlist.add('remote-added');

    const first = hooks.replaceWishlist(['seed', 'first-local']);
    const second = hooks.replaceWishlist(['seed', 'first-local', 'second-local']);

    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeUndefined();
    expect([...commerce.remoteWishlist]).toEqual([
      'seed',
      'remote-added',
      'first-local',
      'second-local'
    ]);
    expect(commerce.api.wishlist.addItem).toHaveBeenCalledTimes(3);
  });

  it('removes a wishlist item added by an earlier queued sync whose refresh failed', async () => {
    const commerce = commerceApi({ wishlistIds: ['seed'] });
    let getCount = 0;
    commerce.api.wishlist.get.mockImplementation(async () => {
      getCount += 1;
      if (getCount === 2) throw new Error('wishlist refresh failed after add');
      return {
        items: [...commerce.remoteWishlist].map(productId => ({ productId }))
      };
    });
    const { hooks } = await loadCoreSessionHarness({
      frontend: true,
      storeApiOverrides: commerce.api
    });
    hooks.seedAuthenticatedCommerce({ wishlistItems: ['seed'] });

    const add = hooks.replaceWishlist(['seed', 'transient']);
    const remove = hooks.replaceWishlist(['seed']);

    await expect(add).resolves.toBeNull();
    await expect(remove).resolves.toBeUndefined();
    expect([...commerce.remoteWishlist]).toEqual(['seed']);
    expect(commerce.api.wishlist.addItem).toHaveBeenCalledWith({ productId: 'transient' });
    expect(commerce.api.wishlist.removeItem).toHaveBeenCalledWith('transient');
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

  it('falls back to the allowlisted MMarket catalog when a static server has no backend route', async () => {
    const requested = [];
    const fetchImpl = async url => {
      requested.push(String(url));
      if (String(url).startsWith('/api/v1/catalog/')) {
        return new Response('<!doctype html><title>Static preview</title>', {
          status: 200,
          headers: { 'content-type': 'text/html' }
        });
      }
      return new Response(JSON.stringify([
        { id: 1, name: 'Beverages', parent_id: null },
        { id: 1811, name: 'Fumoir', parent_id: null },
        { id: 2, name: 'Child category', parent_id: 1 }
      ]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };
    const { hooks } = await loadCoreSessionHarness({
      frontend: true,
      baseUrl: 'http://127.0.0.1:8785/',
      fetchImpl
    });

    await expect(hooks.fetchCategories()).resolves.toEqual([
      { id: 1, name: 'Beverages', parent_id: null },
      { id: 1811, name: 'Fumoir', parent_id: null }
    ]);
    expect(requested).toEqual([
      '/api/v1/catalog/categories/',
      'https://api.mmarket.ma/api/categories/'
    ]);
  });

  it('keeps the same-origin catalog preferred and does not bypass access denials', async () => {
    const successfulRequests = [];
    const successfulFetch = async url => {
      successfulRequests.push(String(url));
      return new Response(JSON.stringify([{ id: 1, name: 'Beverages', parent_id: null }]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };
    const preferred = await loadCoreSessionHarness({ frontend: true, fetchImpl: successfulFetch });
    await expect(preferred.hooks.fetchCategories()).resolves.toHaveLength(1);
    expect(successfulRequests).toEqual(['/api/v1/catalog/categories/']);

    const deniedRequests = [];
    const deniedFetch = async url => {
      deniedRequests.push(String(url));
      return new Response(JSON.stringify({ error: 'denied' }), {
        status: 403,
        headers: { 'content-type': 'application/json' }
      });
    };
    const denied = await loadCoreSessionHarness({ frontend: true, fetchImpl: deniedFetch });
    await expect(denied.hooks.fetchCategories()).rejects.toMatchObject({ status: 403 });
    expect(deniedRequests).toEqual(['/api/v1/catalog/categories/']);
  });

  it.each([
    [422, 'VALIDATION_FAILED'],
    [429, 'RATE_LIMITED'],
    [503, 'CATALOG_RESPONSE_INVALID']
  ])('does not bypass a validated backend error (%s %s)', async (status, code) => {
    const requested = [];
    const fetchImpl = async url => {
      requested.push(String(url));
      return new Response(JSON.stringify({ error: { code, message: 'Rejected' } }), {
        status,
        headers: { 'content-type': 'application/json' }
      });
    };
    const { hooks } = await loadCoreSessionHarness({ frontend: true, fetchImpl });

    await expect(hooks.fetchCategories()).rejects.toMatchObject({ status, code });
    expect(requested).toEqual(['/api/v1/catalog/categories/']);
  });

  it('does not bypass an unavailable backend outside explicit static-preview mode', async () => {
    const requested = [];
    const fetchImpl = async url => {
      requested.push(String(url));
      return new Response(JSON.stringify({
        error: { code: 'CATALOG_UNAVAILABLE', message: 'Unavailable' }
      }), {
        status: 503,
        headers: { 'content-type': 'application/json' }
      });
    };
    const { hooks } = await loadCoreSessionHarness({ frontend: true, fetchImpl });

    await expect(hooks.fetchCategories()).rejects.toMatchObject({
      status: 503,
      code: 'CATALOG_UNAVAILABLE'
    });
    expect(requested).toEqual(['/api/v1/catalog/categories/']);
  });

  it('does not bypass malformed JSON from the same-origin backend', async () => {
    const requested = [];
    const fetchImpl = async url => {
      requested.push(String(url));
      return new Response('{"results":', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };
    const { hooks } = await loadCoreSessionHarness({ frontend: true, fetchImpl });

    await expect(hooks.fetchCategories()).rejects.toMatchObject({
      status: 200,
      catalogFailure: 'invalid-json'
    });
    expect(requested).toEqual(['/api/v1/catalog/categories/']);
  });

  it('preserves product query parameters in the explicit static-preview fallback', async () => {
    const requested = [];
    const fetchImpl = async url => {
      requested.push(String(url));
      if (String(url).startsWith('/api/v1/catalog/')) {
        return new Response(JSON.stringify({
          error: { code: 'CATALOG_UNAVAILABLE', message: 'Unavailable' }
        }), {
          status: 503,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ count: 0, next: null, previous: null, results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };
    const { hooks } = await loadCoreSessionHarness({
      frontend: true,
      baseUrl: 'http://127.0.0.1:8785/',
      fetchImpl
    });

    await expect(hooks.fetchProducts(3, 7, 'green tea', '-price', 24, {
      brand: 11,
      maxPrice: 99.5
    })).resolves.toMatchObject({ count: 0, results: [] });
    expect(requested).toHaveLength(2);
    expect(requested[1]).toBe(requested[0].replace(
      '/api/v1/catalog/',
      'https://api.mmarket.ma/api/'
    ));
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

  it('autosaves every editable customer preference and reverts failed optimistic changes', async () => {
    const [source, markup] = await Promise.all([
      readFile(settingsUrl, 'utf8'),
      readFile(settingsMarkupUrl, 'utf8')
    ]);
    expect(markup).not.toContain('id="savePreferencesBtn"');
    expect(markup.match(/data-preference-key=/g)).toHaveLength(10);
    expect(source).toContain('StoreAPI.preferences.update({ [key]: nextValue })');
    expect(source).toContain('applyPreferenceEffects(optimistic)');
    expect(source).toContain('applyPreferenceEffects(previous)');
    expect(source).toContain('if (activeLanguage !== preferences.language) setLang');
    expect(source).toContain("setPreferenceSaveStatus('settings_preferences_saved_inline', 'saved')");
  });

  it('keeps the product wishlist control aligned with restored guest state', async () => {
    const source = await readFile(productUrl, 'utf8');
    expect(source).toContain("window.addEventListener('am:guest-commerce-changed', syncDetailWishlistButton)");
    expect(source).toMatch(/const saved = wishlist\.includes\(String\(productId\)\)/);
  });
});
