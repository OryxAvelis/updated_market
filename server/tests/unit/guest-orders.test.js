import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import {
  guestCheckoutRequestDigest,
  validGuestOrderToken
} from '../../src/orders/guest-routes.js';

const guestToken = 'A'.repeat(43);
const delivery = {
  recipientName: 'Guest Customer',
  phone: '+212612345678',
  email: null,
  addressLine1: '1 Guest Checkout Street',
  addressLine2: null,
  district: 'Maarif',
  city: 'Casablanca',
  postalCode: null,
  country: 'MA',
  deliveryInstructions: null
};

function digest(items, overrides = {}) {
  return guestCheckoutRequestDigest({
    items,
    delivery,
    paymentMethod: 'cod',
    note: null,
    ...overrides
  }).toString('hex');
}

function contractApp() {
  const database = {
    async execute() {
      throw new Error('The route contract test unexpectedly reached the database.');
    }
  };
  return createApp({
    database,
    catalog: { async getProduct() { throw new Error('Unexpected catalog request.'); } },
    mailService: { async sendPasswordReset() { return true; } },
    fulfillmentWebhookSecret: 'guest-order-unit-test-secret-that-is-long-enough'
  });
}

describe('guest order security contract', () => {
  it('accepts only a 256-bit base64url bearer token', () => {
    expect(validGuestOrderToken(guestToken)).toBe(true);
    expect(validGuestOrderToken('A'.repeat(42))).toBe(false);
    expect(validGuestOrderToken(`${'A'.repeat(42)}=`)).toBe(false);
    expect(validGuestOrderToken(`${'A'.repeat(42)}B`)).toBe(false);
    expect(validGuestOrderToken('!'.repeat(43))).toBe(false);
    expect(validGuestOrderToken(null)).toBe(false);
  });

  it('canonicalizes cart order while binding every meaningful checkout field', () => {
    const first = digest([
      { productId: 'product-b', quantity: 1 },
      { productId: 'product-a', quantity: 2 }
    ]);
    const reordered = digest([
      { productId: 'product-a', quantity: 2 },
      { productId: 'product-b', quantity: 1 }
    ]);
    expect(reordered).toBe(first);
    expect(digest([{ productId: 'product-a', quantity: 3 }])).not.toBe(
      digest([{ productId: 'product-a', quantity: 2 }])
    );
    expect(digest([{ productId: 'product-a', quantity: 2 }], {
      delivery: { ...delivery, city: 'Rabat' }
    })).not.toBe(digest([{ productId: 'product-a', quantity: 2 }]));
    expect(digest([{ productId: 'product-a', quantity: 2 }], {
      paymentMethod: 'wafacash'
    })).not.toBe(digest([{ productId: 'product-a', quantity: 2 }]));
  });

  it('keeps account orders protected and conceals guest order lookup without a token', async () => {
    const app = contractApp();
    const privateOrders = await request(app).get('/api/v1/orders');
    expect(privateOrders.status).toBe(401);
    expect(privateOrders.body.error.code).toBe('AUTH_REQUIRED');

    const concealedGuest = await request(app)
      .get('/api/v1/guest-orders/00000000-0000-4000-8000-000000000001');
    expect(concealedGuest.status).toBe(404);
    expect(concealedGuest.body.error).toEqual({
      code: 'ORDER_NOT_FOUND',
      message: 'The order was not found.'
    });
    expect(concealedGuest.headers['cache-control']).toBe('no-store');
  });

  it('allows the guest token header only for an exact trusted CORS origin', async () => {
    const app = contractApp();
    const allowed = await request(app)
      .options('/api/v1/guest-orders')
      .set('Origin', config.appOrigin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'X-Guest-Order-Token');
    expect(allowed.status).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(config.appOrigin);
    expect(allowed.headers['access-control-allow-headers']).toContain('X-Guest-Order-Token');

    const denied = await request(app)
      .options('/api/v1/guest-orders')
      .set('Origin', 'https://attacker.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'X-Guest-Order-Token');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('issues a server-owned checkout token pair while persisting only digests', async () => {
    const writes = [];
    const database = {
      async execute(sql, values = []) {
        writes.push({ sql, values });
        return [{ affectedRows: 1 }];
      }
    };
    const app = createApp({
      database,
      catalog: { async getProduct() { throw new Error('Unexpected catalog request.'); } },
      mailService: { async sendPasswordReset() { return true; } },
      fulfillmentWebhookSecret: 'guest-order-unit-test-secret-that-is-long-enough'
    });
    const guest = request.agent(app);
    const session = await guest.get('/api/v1/auth/session');
    const response = await guest
      .post('/api/v1/guest-orders/access')
      .set('Origin', config.appOrigin)
      .set('X-CSRF-Token', session.body.csrfToken);

    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(validGuestOrderToken(response.body.access.token)).toBe(true);
    expect(response.body.access.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
    expect(Date.parse(response.body.access.expiresAt)).toBeGreaterThan(Date.now());
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toContain('INSERT INTO guest_checkout_claims');
    expect(writes[0].values[0]).toBeInstanceOf(Buffer);
    expect(writes[0].values[0]).toHaveLength(32);
    expect(writes[0].values[1]).toBeInstanceOf(Buffer);
    expect(writes[0].values[1]).toHaveLength(32);
    expect(writes[0].values).not.toContain(response.body.access.token);
    expect(writes[0].values).not.toContain(response.body.access.idempotencyKey);
  });

  it('bounds the guest-cart contract at 100 products by rejecting a 101st item', async () => {
    const app = contractApp();
    const guest = request.agent(app);
    const session = await guest.get('/api/v1/auth/session');
    const csrfToken = session.body.csrfToken;
    const items = Array.from({ length: 101 }, (_, index) => ({
      productId: `product-${index + 1}`,
      quantity: 1
    }));
    const response = await guest
      .post('/api/v1/guest-orders')
      .set('Origin', config.appOrigin)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'guest-cart-limit-test')
      .set('X-Guest-Order-Token', guestToken)
      .send({ items, delivery, paymentMethod: 'cod', note: null });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'items' })
    ]));
  });
});
