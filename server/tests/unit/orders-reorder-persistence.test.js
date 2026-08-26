import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const ordersUrl = new URL('../../../js/orders.js', import.meta.url);

function sharedStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    entries: () => [...values.entries()]
  };
}

function button() {
  return {
    disabled: false,
    innerHTML: '<span>Reorder</span>',
    isConnected: true,
    textContent: '',
    removeAttribute() {},
    setAttribute() {}
  };
}

function immediateLocks() {
  return { request: (_name, _options, callback) => callback({ name: 'test-lock' }) };
}

async function loadOrdersHarness({ storage, mergeGuest, fetchProduct, cartGet, idempotencyKey, locks = immediateLocks() }) {
  const context = {
    URLSearchParams,
    cart: [],
    cartFromApi: payload => payload.cart.items.map(item => ({ id: item.productId, qty: item.quantity })),
    adoptAuthenticatedCart: payload => payload.cart.items.map(item => ({ id: item.productId, qty: item.quantity })),
    console: { error() {}, log() {}, warn() {} },
    document: { activeElement: null, addEventListener() {} },
    escapeHtml: value => String(value ?? ''),
    fetchProduct,
    formatPrice: value => String(value),
    getLang: () => 'en',
    getUser: () => ({ id: 'user-1' }),
    handleStoreUnauthorized: () => false,
    localStorage: storage,
    location: { href: '', search: '' },
    motionBehavior: () => 'auto',
    navigator: { locks },
    requestAnimationFrame: callback => callback(),
    setTimeout: callback => callback(),
    StoreAPI: {
      createIdempotencyKey: vi.fn(() => idempotencyKey),
      cart: { get: cartGet, mergeGuest }
    },
    t: key => key,
    toast: vi.fn(),
    updateBadges() {},
    whenStoreReady: callback => callback(),
    window: { addEventListener() {}, confirm: () => true },
    $: () => null
  };
  context.globalThis = context;

  const source = await readFile(ordersUrl, 'utf8');
  const hooks = `
    globalThis.__reorderPersistenceTest = {
      reorder,
      discard: discardBlockedReorderRecovery,
      hydrate: hydrateReorderAttempts,
      recoveryBlock: reorderRecoveryBlock,
      card: orderCard,
      setOrders(value) { loadedOrders = value; },
      attempts() { return [...reorderAttempts.values()].map(value => ({ ...value })); }
    };
  `;
  vm.runInNewContext(`${source}\n${hooks}`, context, { filename: 'js/orders.js' });
  return { context, hooks: context.__reorderPersistenceTest };
}

describe('durable reorder recovery', () => {
  it('reuses the exact payload and key after a lost response followed by a full page reload', async () => {
    const storage = sharedStorage();
    const createdAt = Date.now();
    const idempotencyKey = `am1.${createdAt.toString(36)}.2f093729-84af-4cad-9f27-6617eb80c67d`;
    const order = {
      id: 'order-1',
      items: [{ productId: 'product-1', quantity: 2 }]
    };
    const firstMerge = vi.fn().mockRejectedValue(Object.assign(new Error('response lost'), { code: 'NETWORK_ERROR' }));
    const firstProducts = vi.fn().mockResolvedValue({ id: 'product-1', is_available: true, stock_quantity: 10 });
    const firstCartGet = vi.fn().mockResolvedValue({ cart: { items: [] } });
    const firstPage = await loadOrdersHarness({
      storage,
      mergeGuest: firstMerge,
      fetchProduct: firstProducts,
      cartGet: firstCartGet,
      idempotencyKey
    });
    firstPage.hooks.setOrders([order]);

    await firstPage.hooks.reorder(order.id, button());

    expect(firstMerge).toHaveBeenCalledWith(
      { items: [{ productId: 'product-1', quantity: 2 }] },
      { idempotencyKey }
    );
    expect(storage.entries()).toHaveLength(1);

    const replayMerge = vi.fn().mockResolvedValue({
      replayed: true,
      cart: { items: [{ productId: 'product-1', quantity: 2 }] }
    });
    const reloadedProducts = vi.fn();
    const reloadedCartGet = vi.fn();
    const secondPage = await loadOrdersHarness({
      storage,
      mergeGuest: replayMerge,
      fetchProduct: reloadedProducts,
      cartGet: reloadedCartGet,
      idempotencyKey: `am1.${createdAt.toString(36)}.8acb765d-74ad-4c2a-9652-a6e10f1a82e2`
    });
    secondPage.hooks.setOrders([order]);

    await secondPage.hooks.reorder(order.id, button());

    expect(reloadedProducts).not.toHaveBeenCalled();
    expect(reloadedCartGet).not.toHaveBeenCalled();
    expect(replayMerge).toHaveBeenCalledWith(
      { items: [{ productId: 'product-1', quantity: 2 }] },
      { idempotencyKey }
    );
    expect(secondPage.context.StoreAPI.createIdempotencyKey).not.toHaveBeenCalled();
    expect(storage.entries()).toEqual([]);
  });

  it.each([
    ['expired', () => {
      const createdAt = Date.now() - (24 * 60 * 60 * 1000) - 1;
      const idempotencyKey = `am1.${createdAt.toString(36)}.2f093729-84af-4cad-9f27-6617eb80c67d`;
      return JSON.stringify({
        version: 1,
        userId: 'user-1',
        attempts: [{
          orderId: 'order-1',
          idempotencyKey,
          signature: JSON.stringify({ items: [{ productId: 'product-1', quantity: 2 }] }),
          payload: { items: [{ productId: 'product-1', quantity: 2 }] },
          added: 1,
          skipped: 0,
          createdAt,
          expiresAt: createdAt + 24 * 60 * 60 * 1000
        }]
      });
    }],
    ['corrupt', () => '{not-json']
  ])('fails closed for %s persisted recovery state', async (_label, storedValue) => {
    const storage = sharedStorage();
    storage.setItem('am_orders_reorder_attempts_v1:user-1', storedValue());
    const mergeGuest = vi.fn();
    const fetchProduct = vi.fn();
    const cartGet = vi.fn();
    const page = await loadOrdersHarness({
      storage,
      mergeGuest,
      fetchProduct,
      cartGet,
      idempotencyKey: `am1.${Date.now().toString(36)}.8acb765d-74ad-4c2a-9652-a6e10f1a82e2`
    });
    page.hooks.setOrders([{ id: 'order-1', items: [{ productId: 'product-1', quantity: 2 }] }]);

    await page.hooks.reorder('order-1', button());

    expect(fetchProduct).not.toHaveBeenCalled();
    expect(cartGet).not.toHaveBeenCalled();
    expect(mergeGuest).not.toHaveBeenCalled();
    expect(storage.entries()).toHaveLength(1);
  });

  it('holds the cross-tab lock through preflight, merge, and durable cleanup', async () => {
    let held = false;
    const locks = {
      request: async (name, options, callback) => {
        if (held && options.ifAvailable) return callback(null);
        held = true;
        try {
          return await callback({ name });
        } finally {
          held = false;
        }
      }
    };
    let finishMerge;
    const mergePending = new Promise(resolve => { finishMerge = resolve; });
    const storage = sharedStorage();
    const createdAt = Date.now();
    const idempotencyKey = `am1.${createdAt.toString(36)}.2f093729-84af-4cad-9f27-6617eb80c67d`;
    const order = { id: 'order-1', items: [{ productId: 'product-1', quantity: 1 }] };
    const product = { id: 'product-1', is_available: true, stock_quantity: 10 };
    const firstMerge = vi.fn(() => mergePending);
    const secondMerge = vi.fn();
    const firstPage = await loadOrdersHarness({
      storage,
      locks,
      mergeGuest: firstMerge,
      fetchProduct: vi.fn().mockResolvedValue(product),
      cartGet: vi.fn().mockResolvedValue({ cart: { items: [] } }),
      idempotencyKey
    });
    const secondProducts = vi.fn().mockResolvedValue(product);
    const secondCartGet = vi.fn().mockResolvedValue({ cart: { items: [] } });
    const secondPage = await loadOrdersHarness({
      storage,
      locks,
      mergeGuest: secondMerge,
      fetchProduct: secondProducts,
      cartGet: secondCartGet,
      idempotencyKey
    });
    firstPage.hooks.setOrders([order]);
    secondPage.hooks.setOrders([order]);

    const first = firstPage.hooks.reorder(order.id, button());
    while (!firstMerge.mock.calls.length) await Promise.resolve();
    await secondPage.hooks.reorder(order.id, button());

    expect(secondProducts).not.toHaveBeenCalled();
    expect(secondCartGet).not.toHaveBeenCalled();
    expect(secondMerge).not.toHaveBeenCalled();

    finishMerge({ replayed: false, cart: { items: [{ productId: 'product-1', quantity: 1 }] } });
    await first;
    expect(firstMerge).toHaveBeenCalledOnce();
    expect(storage.entries()).toEqual([]);
  });

  it('fails closed before preflight when cross-tab locking is unavailable', async () => {
    const storage = sharedStorage();
    const fetchProduct = vi.fn();
    const cartGet = vi.fn();
    const mergeGuest = vi.fn();
    const page = await loadOrdersHarness({
      storage,
      locks: null,
      mergeGuest,
      fetchProduct,
      cartGet,
      idempotencyKey: `am1.${Date.now().toString(36)}.2f093729-84af-4cad-9f27-6617eb80c67d`
    });
    page.hooks.setOrders([{ id: 'order-1', items: [{ productId: 'product-1', quantity: 1 }] }]);

    await page.hooks.reorder('order-1', button());

    expect(fetchProduct).not.toHaveBeenCalled();
    expect(cartGet).not.toHaveBeenCalled();
    expect(mergeGuest).not.toHaveBeenCalled();
    expect(storage.entries()).toEqual([]);
  });

  it('offers a confirmed discard path for expired recovery and then permits a fresh reorder', async () => {
    const storage = sharedStorage();
    const expiredAt = Date.now() - (24 * 60 * 60 * 1000) - 1;
    const oldKey = `am1.${expiredAt.toString(36)}.2f093729-84af-4cad-9f27-6617eb80c67d`;
    storage.setItem('am_orders_reorder_attempts_v1:user-1', JSON.stringify({
      version: 1,
      userId: 'user-1',
      attempts: [{
        orderId: 'order-1',
        idempotencyKey: oldKey,
        signature: JSON.stringify({ items: [{ productId: 'product-1', quantity: 1 }] }),
        payload: { items: [{ productId: 'product-1', quantity: 1 }] },
        added: 1,
        skipped: 0,
        createdAt: expiredAt,
        expiresAt: expiredAt + 24 * 60 * 60 * 1000
      }]
    }));
    const freshKey = `am1.${Date.now().toString(36)}.8acb765d-74ad-4c2a-9652-a6e10f1a82e2`;
    const mergeGuest = vi.fn().mockResolvedValue({
      replayed: false,
      cart: { items: [{ productId: 'product-1', quantity: 1 }] }
    });
    const page = await loadOrdersHarness({
      storage,
      mergeGuest,
      fetchProduct: vi.fn().mockResolvedValue({ id: 'product-1', is_available: true, stock_quantity: 10 }),
      cartGet: vi.fn().mockResolvedValue({ cart: { items: [] } }),
      idempotencyKey: freshKey
    });
    const order = {
      id: 'order-1', orderNumber: 'AM-1', placedAt: new Date().toISOString(), status: 'delivered',
      items: [{ id: 'item-1', productId: 'product-1', name: 'Milk', quantity: 1 }],
      subtotal: 10, deliveryFee: 0, total: 10, address: {}, tracking: [], returnEligible: false
    };
    page.hooks.setOrders([order]);
    page.hooks.hydrate();

    expect(page.hooks.recoveryBlock(order.id)).toBe('REORDER_ATTEMPT_EXPIRED');
    expect(page.hooks.card(order)).toContain('data-reorder-recovery-clear="order-1"');
    await page.hooks.discard(order.id, button());
    expect(storage.entries()).toEqual([]);

    await page.hooks.reorder(order.id, button());
    expect(mergeGuest).toHaveBeenCalledWith(
      { items: [{ productId: 'product-1', quantity: 1 }] },
      { idempotencyKey: freshKey }
    );
  });
});
