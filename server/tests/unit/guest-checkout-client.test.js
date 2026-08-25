import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const storeApiUrl = new URL('../../../js/store-api.js', import.meta.url);
const checkoutUrl = new URL('../../../js/checkout.js', import.meta.url);
const cartUrl = new URL('../../../js/cart.js', import.meta.url);

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', date: new Date().toUTCString() }
  });
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: vi.fn(key => values.has(key) ? values.get(key) : null),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
    removeItem: vi.fn(key => values.delete(key))
  };
}

async function storeApiHarness(responses) {
  const fetch = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('Unexpected request');
    return typeof next === 'function' ? next() : next;
  });
  const browserCrypto = {
    randomUUID: () => '12345678-1234-4123-8123-123456789abc',
    getRandomValues(bytes) {
      bytes.forEach((_, index) => { bytes[index] = index; });
      return bytes;
    }
  };
  const window = {
    AbortController,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    clearTimeout,
    crypto: browserCrypto,
    dispatchEvent() {},
    fetch,
    setTimeout
  };
  const context = {
    AbortController,
    CustomEvent,
    DOMException,
    Headers,
    Response,
    URLSearchParams,
    clearTimeout,
    console,
    setTimeout,
    window
  };
  context.globalThis = context;
  vm.runInNewContext(await readFile(storeApiUrl, 'utf8'), context, { filename: 'js/store-api.js' });
  return { api: window.StoreAPI, fetch };
}

const guestInput = {
  items: [{ productId: 'product-1', quantity: 2 }],
  delivery: {
    recipientName: 'Guest Customer',
    phone: '+212612345678',
    email: 'guest@example.test',
    addressLine1: '10 Market Street',
    addressLine2: null,
    district: 'Centre',
    city: 'Casablanca',
    postalCode: null,
    country: 'MA',
    deliveryInstructions: 'Ring once'
  },
  paymentMethod: 'cod',
  note: null
};

describe('guest checkout browser client', () => {
  it('acquires server-issued access and sends its token and idempotency pair with CSRF', async () => {
    const issuedAccess = {
      token: 'A'.repeat(43),
      idempotencyKey: 'guest-attempt-123',
      expiresAt: '2099-01-01T00:00:00.000Z'
    };
    const responses = [
      jsonResponse({ authenticated: false, csrfToken: 'guest-csrf' }),
      jsonResponse({ access: issuedAccess }, 201),
      jsonResponse({ order: { id: 'order-1' }, replayed: false }, 201),
      jsonResponse({ order: { id: 'order-1' } }),
      jsonResponse({ orderId: 'order-1', status: 'confirmed', events: [] })
    ];
    const { api, fetch } = await storeApiHarness(responses);
    const issued = await api.guestOrders.issueAccess();
    expect(issued.access).toEqual(issuedAccess);

    await api.guestOrders.create(guestInput, {
      idempotencyKey: issued.access.idempotencyKey,
      guestOrderToken: issued.access.token
    });
    await api.guestOrders.get('order-1', { guestOrderToken: issued.access.token });
    await api.guestOrders.tracking('order-1', { guestOrderToken: issued.access.token });

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/auth/session',
      '/api/v1/guest-orders/access',
      '/api/v1/guest-orders',
      '/api/v1/guest-orders/order-1',
      '/api/v1/guest-orders/order-1/tracking'
    ]);
    const accessOptions = fetch.mock.calls[1][1];
    expect(accessOptions.headers.get('X-CSRF-Token')).toBe('guest-csrf');
    expect(accessOptions.headers.has('Idempotency-Key')).toBe(false);
    expect(accessOptions.headers.has('X-Guest-Order-Token')).toBe(false);
    const createOptions = fetch.mock.calls[2][1];
    expect(createOptions.headers.get('X-CSRF-Token')).toBe('guest-csrf');
    expect(createOptions.headers.get('Idempotency-Key')).toBe('guest-attempt-123');
    expect(createOptions.headers.get('X-Guest-Order-Token')).toBe(issued.access.token);
    expect(JSON.parse(createOptions.body)).toEqual(guestInput);
    expect(fetch.mock.calls[3][0]).not.toContain(issued.access.token);
    expect(fetch.mock.calls[3][1].headers.get('X-Guest-Order-Token')).toBe(issued.access.token);
    expect(fetch.mock.calls[4][1].headers.get('X-Guest-Order-Token')).toBe(issued.access.token);
  });

  it('rejects a malformed guest token before making a request', async () => {
    const { api, fetch } = await storeApiHarness([]);
    await expect(api.guestOrders.get('order-1', { guestOrderToken: 'not-a-token' })).rejects.toMatchObject({
      code: 'INVALID_GUEST_ORDER_TOKEN'
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

async function checkoutHarness({ issueAccess, create, get }) {
  const sessionStorage = memoryStorage();
  const localStorage = memoryStorage();
  const saveCart = vi.fn(async () => true);
  const saveDeliveryInfo = vi.fn();
  const broadcastStoreGuestCommerceChanged = vi.fn();
  const context = {
    $: () => null,
    TextEncoder,
    assertAuthenticatedRequestCurrent() {},
    broadcastStoreGuestCommerceChanged,
    cart: [],
    console,
    crypto: webcrypto,
    document: {
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; }
    },
    getLang: () => 'en',
    isValidMoroccanPhone: () => true,
    localStorage,
    normalizeMoroccanPhone: value => String(value || '').replace(/\D/g, '').replace(/^212/, '').replace(/^0/, ''),
    requestAnimationFrame: callback => callback(),
    saveCart,
    saveDeliveryInfo,
    sessionStorage,
    StoreAPI: {
      createIdempotencyKey: () => 'guest-attempt-123',
      guestOrders: { issueAccess, create, get }
    },
    t: key => key,
    updateBadges: vi.fn(),
    window: { addEventListener() {} }
  };
  context.globalThis = context;
  const source = await readFile(checkoutUrl, 'utf8');
  const hooks = `
    globalThis.__guestCheckoutTest = {
      submit: submitGuestOrder,
      loadPersisted: loadPersistedGuestOrder,
      runtimeErrorKey: checkoutRuntimeErrorKey,
      setCart(value) { cart = value; },
      getCart() { return cart; }
    };
  `;
  vm.runInNewContext(`${source}\n${hooks}`, context, { filename: 'js/checkout.js' });
  return {
    api: context.__guestCheckoutTest,
    broadcastStoreGuestCommerceChanged,
    localStorage,
    saveCart,
    saveDeliveryInfo,
    sessionStorage
  };
}

describe('guest checkout retry and completion state', () => {
  it('retains the cart after failure, reuses the same attempt, and clears only after success', async () => {
    const expiresAt = '2099-01-01T00:00:00.000Z';
    const issueAccess = vi.fn().mockResolvedValue({
      access: { token: 'A'.repeat(43), idempotencyKey: 'guest-attempt-123', expiresAt }
    });
    const create = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('network lost'), { code: 'NETWORK_ERROR' }))
      .mockResolvedValueOnce({ order: { id: 'order-1', orderNumber: 'AM-1', total: '90.00' } });
    const harness = await checkoutHarness({ issueAccess, create, get: vi.fn() });
    const originalCart = [{ id: 'product-1', qty: 2 }];
    harness.api.setCart(originalCart.map(item => ({ ...item })));

    await expect(harness.api.submit(guestInput)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(harness.api.getCart()).toEqual(originalCart);
    expect(harness.saveCart).not.toHaveBeenCalled();
    const firstAttempt = create.mock.calls[0][1];
    expect(harness.sessionStorage.getItem('am_guest_checkout_attempt_v1')).not.toBeNull();

    await expect(harness.api.submit(guestInput)).resolves.toMatchObject({
      order: { id: 'order-1' },
      access: { orderId: 'order-1', guestOrderToken: 'A'.repeat(43), expiresAt }
    });
    expect(issueAccess).toHaveBeenCalledOnce();
    expect(create.mock.calls[1][1]).toEqual(firstAttempt);
    expect(harness.api.getCart()).toEqual([]);
    expect(harness.saveCart).toHaveBeenCalledOnce();
    expect(harness.saveDeliveryInfo).toHaveBeenCalledOnce();
    expect(harness.broadcastStoreGuestCommerceChanged).toHaveBeenCalledOnce();
    expect(harness.sessionStorage.getItem('am_guest_checkout_attempt_v1')).toBeNull();
    expect(JSON.parse(harness.sessionStorage.getItem('am_guest_order_access_v1'))).toMatchObject({
      orderId: 'order-1',
      guestOrderToken: 'A'.repeat(43),
      expiresAt
    });
  });

  it('discards a definitively invalid access claim and obtains a new server-issued pair on retry', async () => {
    const expiresAt = '2099-01-01T00:00:00.000Z';
    const issueAccess = vi.fn()
      .mockResolvedValueOnce({ access: { token: 'A'.repeat(43), idempotencyKey: 'attempt-a', expiresAt } })
      .mockResolvedValueOnce({ access: { token: 'B'.repeat(43), idempotencyKey: 'attempt-b', expiresAt } });
    const create = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('claim expired'), { code: 'GUEST_CHECKOUT_ACCESS_INVALID' }))
      .mockResolvedValueOnce({ order: { id: 'order-2', orderNumber: 'AM-2', total: '90.00', accessExpiresAt: expiresAt } });
    const harness = await checkoutHarness({ issueAccess, create, get: vi.fn() });
    harness.api.setCart([{ id: 'product-1', qty: 2 }]);

    await expect(harness.api.submit(guestInput)).rejects.toMatchObject({ code: 'GUEST_CHECKOUT_ACCESS_INVALID' });
    expect(harness.sessionStorage.getItem('am_guest_checkout_attempt_v1')).toBeNull();
    expect(harness.api.getCart()).toHaveLength(1);

    await expect(harness.api.submit(guestInput)).resolves.toMatchObject({
      order: { id: 'order-2' },
      access: { guestOrderToken: 'B'.repeat(43), expiresAt }
    });
    expect(issueAccess).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][1]).toMatchObject({ idempotencyKey: 'attempt-b', guestOrderToken: 'B'.repeat(43) });
  });

  it('restores a completed order with the persisted bearer token and localizes credential conflicts', async () => {
    const expiresAt = '2099-01-01T00:00:00.000Z';
    const get = vi.fn().mockResolvedValue({ order: { id: 'order-1', status: 'confirmed' } });
    const harness = await checkoutHarness({ issueAccess: vi.fn(), create: vi.fn(), get });
    harness.sessionStorage.setItem('am_guest_order_access_v1', JSON.stringify({
      version: 2,
      orderId: 'order-1',
      guestOrderToken: 'B'.repeat(43),
      expiresAt
    }));
    harness.api.setCart([]);

    await expect(harness.api.loadPersisted()).resolves.toMatchObject({
      order: { id: 'order-1' },
      access: { orderId: 'order-1', guestOrderToken: 'B'.repeat(43), expiresAt }
    });
    expect(get).toHaveBeenCalledWith('order-1', { guestOrderToken: 'B'.repeat(43) });
    expect(harness.api.runtimeErrorKey({ code: 'GUEST_CHECKOUT_CREDENTIALS_REUSED' })).toBe('guest_checkout_conflict');
    expect(harness.api.runtimeErrorKey({ code: 'GUEST_CHECKOUT_ACCESS_INVALID' })).toBe('guest_checkout_access_error');
  });

  it('keeps guest cart and checkout navigation free of a login redirect', async () => {
    const checkoutSource = await readFile(checkoutUrl, 'utf8');
    const cartSource = await readFile(cartUrl, 'utf8');
    const guestInit = checkoutSource.slice(
      checkoutSource.indexOf('async function initCheckout()'),
      checkoutSource.indexOf("document.addEventListener('DOMContentLoaded'")
    );
    expect(guestInit).not.toContain('login.html');
    expect(cartSource).toContain('<a href="checkout.html" class="btn-checkout"');
    expect(cartSource).toContain('if (!getUser()) return;');
  });
});
