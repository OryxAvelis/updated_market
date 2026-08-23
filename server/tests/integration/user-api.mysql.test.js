import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { runMigrations } from '../../src/db/migrate.js';
import { pool } from '../../src/db/pool.js';
import { createLowStockEvaluator } from '../../src/engagement/low-stock.js';
import { createFulfillmentSignature } from '../../src/integrations/fulfillment-auth.js';
import {
  cleanupIntegrationData,
  createMockCatalog,
  createMockMailer,
  uniqueEmail,
  uniqueProduct
} from '../helpers/integration-fixtures.js';

const integrationEnabled = process.env.TEST_USE_DATABASE === 'true';
const databaseDescribe = integrationEnabled ? describe.sequential : describe.skip;
const origin = config.appOrigin;
const testPassword = 'AM-test-password-2026';
const changedPassword = 'AM-changed-password-2026';
const fulfillmentSecret = 'integration-fulfillment-secret-that-is-longer-than-32-bytes';
const trackedEmails = new Set();
const trackedProductIds = new Set();
let databaseReady = false;

function testApp(products = []) {
  const mailer = createMockMailer();
  const catalog = createMockCatalog(products);
  return {
    app: createApp({
      database: pool,
      catalog,
      mailService: mailer,
      fulfillmentWebhookSecret: fulfillmentSecret
    }),
    mailer,
    catalog
  };
}

function sendFulfillmentEvent(app, payload, {
  eventId = randomUUID(),
  secret = fulfillmentSecret,
  timestamp = String(Math.floor(Date.now() / 1000)),
  originHeader
} = {}) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = createFulfillmentSignature({ secret, timestamp, eventId, rawBody });
  let submission = request(app)
    .post('/api/v1/integrations/fulfillment/order-status')
    .set('Content-Type', 'application/json')
    .set('X-AM-Fulfillment-Timestamp', timestamp)
    .set('X-AM-Fulfillment-Event-Id', eventId)
    .set('X-AM-Fulfillment-Signature', signature);
  if (originHeader) submission = submission.set('Origin', originHeader);
  return submission.send(rawBody.toString('utf8'));
}

async function csrfFor(agent) {
  const response = await agent.get('/api/v1/auth/session');
  if (response.status !== 200 || typeof response.body.csrfToken !== 'string') {
    throw new Error('Could not bootstrap the integration-test CSRF token.');
  }
  return response.body.csrfToken;
}

async function register(agent, email, displayName = 'Integration Customer') {
  const csrfToken = await csrfFor(agent);
  const response = await agent
    .post('/api/v1/auth/register')
    .set('Origin', origin)
    .set('X-CSRF-Token', csrfToken)
    .send({ displayName, email, password: testPassword, language: 'en' });
  if (response.status !== 201 || typeof response.body.csrfToken !== 'string') {
    throw new Error(`Integration-test registration failed with HTTP ${response.status}.`);
  }
  return { response, csrfToken: response.body.csrfToken };
}

function addressPayload(label = 'Home') {
  return {
    label,
    recipientName: 'Integration Customer',
    phone: '+212612345678',
    email: null,
    addressLine1: '1 Integration Test Street',
    addressLine2: null,
    district: 'Test District',
    city: 'Casablanca',
    postalCode: '20000',
    deliveryInstructions: null,
    isDefault: true
  };
}

databaseDescribe('user API with MySQL', () => {
  beforeAll(async () => {
    if (!pool) throw new Error('TEST_USE_DATABASE=true did not create a database pool.');
    if (process.env.TEST_SKIP_MIGRATIONS !== 'true') {
      await runMigrations({ database: pool, log: { info() {}, error() {} } });
    }
    databaseReady = true;
  }, 60_000);

  afterAll(async () => {
    try {
      if (databaseReady) await cleanupIntegrationData(pool, trackedEmails, trackedProductIds);
    } finally {
      await pool?.end();
    }
  }, 60_000);

  it('enforces origin and CSRF, rotates real sessions, and makes password resets generic and one-use', async () => {
    const email = uniqueEmail('auth', trackedEmails);
    const { app, mailer } = testApp();
    const primary = request.agent(app);
    const initialCsrf = await csrfFor(primary);

    const missingCsrf = await primary
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ displayName: 'Rejected Customer', email, password: testPassword, language: 'en' });
    expect(missingCsrf.status).toBe(403);
    expect(missingCsrf.body.error.code).toBe('CSRF_INVALID');

    const foreignOrigin = await primary
      .post('/api/v1/auth/register')
      .set('Origin', 'https://untrusted.example')
      .set('X-CSRF-Token', initialCsrf)
      .send({ displayName: 'Rejected Customer', email, password: testPassword, language: 'en' });
    expect(foreignOrigin.status).toBe(403);
    expect(foreignOrigin.body.error.code).toBe('ORIGIN_REJECTED');

    const registration = await primary
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .set('X-CSRF-Token', initialCsrf)
      .send({ displayName: 'Auth Customer', email, password: testPassword, language: 'en' });
    expect(registration.status).toBe(201);
    const sessionCookie = (registration.headers['set-cookie'] || [])
      .find((cookie) => cookie.startsWith(`${config.auth.cookieName}=`));
    expect(Boolean(sessionCookie)).toBe(true);
    expect(/;\s*HttpOnly(?:;|$)/i.test(sessionCookie || '')).toBe(true);
    expect(/;\s*SameSite=Lax(?:;|$)/i.test(sessionCookie || '')).toBe(true);
    expect(/;\s*Path=\/(?:;|$)/i.test(sessionCookie || '')).toBe(true);

    const activeSession = await primary.get('/api/v1/auth/session');
    expect(activeSession.status).toBe(200);
    expect(activeSession.body.authenticated).toBe(true);
    expect(activeSession.body.user.email).toBe(email);

    const logout = await primary
      .post('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('X-CSRF-Token', activeSession.body.csrfToken)
      .send({});
    expect(logout.status).toBe(200);
    expect((await primary.get('/api/v1/auth/session')).body.authenticated).toBe(false);

    const primaryLoginCsrf = await csrfFor(primary);
    const primaryLogin = await primary
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', primaryLoginCsrf)
      .send({ email, password: testPassword });
    expect(primaryLogin.status).toBe(200);

    const secondSession = request.agent(app);
    const secondLoginCsrf = await csrfFor(secondSession);
    const secondLogin = await secondSession
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', secondLoginCsrf)
      .send({ email, password: testPassword });
    expect(secondLogin.status).toBe(200);
    const rotatedOutSession = await primary.get('/api/v1/auth/session');
    expect(rotatedOutSession.status).toBe(200);
    expect(rotatedOutSession.body.authenticated).toBe(false);

    const resetClient = request.agent(app);
    const resetCsrf = await csrfFor(resetClient);
    const unknownReset = await resetClient
      .post('/api/v1/auth/password-reset/request')
      .set('Origin', origin)
      .set('X-CSRF-Token', resetCsrf)
      .send({ email: uniqueEmail('unknown-reset', trackedEmails) });
    const knownReset = await resetClient
      .post('/api/v1/auth/password-reset/request')
      .set('Origin', origin)
      .set('X-CSRF-Token', resetCsrf)
      .send({ email });
    expect(unknownReset.status).toBe(202);
    expect(knownReset.status).toBe(202);
    expect(knownReset.body).toEqual(unknownReset.body);
    expect(mailer.deliveries.length).toBe(1);
    const resetToken = mailer.deliveries[0]?.token;
    expect(typeof resetToken === 'string' && resetToken.length >= 32).toBe(true);

    const confirmation = await resetClient
      .post('/api/v1/auth/password-reset/confirm')
      .set('Origin', origin)
      .set('X-CSRF-Token', resetCsrf)
      .send({ token: resetToken, newPassword: changedPassword });
    expect(confirmation.status).toBe(200);

    const reused = await resetClient
      .post('/api/v1/auth/password-reset/confirm')
      .set('Origin', origin)
      .set('X-CSRF-Token', confirmation.body.csrfToken)
      .send({ token: resetToken, newPassword: changedPassword });
    expect(reused.status).toBe(403);
    expect(reused.body.error.code).toBe('RESET_TOKEN_INVALID');

    const revokedSession = await secondSession.get('/api/v1/auth/session');
    expect(revokedSession.status).toBe(200);
    expect(revokedSession.body.authenticated).toBe(false);

    const fresh = request.agent(app);
    const freshCsrf = await csrfFor(fresh);
    const oldPasswordLogin = await fresh
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', freshCsrf)
      .send({ email, password: testPassword });
    expect(oldPasswordLogin.status).toBe(403);
    const newPasswordLogin = await fresh
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', freshCsrf)
      .send({ email, password: changedPassword });
    expect(newPasswordLogin.status).toBe(200);
  }, 60_000);

  it('isolates saved addresses by session user and persists preferences', async () => {
    const { app } = testApp();
    const owner = request.agent(app);
    const stranger = request.agent(app);
    const ownerAccount = await register(owner, uniqueEmail('address-owner', trackedEmails), 'Address Owner');
    const strangerAccount = await register(stranger, uniqueEmail('address-stranger', trackedEmails), 'Address Stranger');

    const created = await owner
      .post('/api/v1/me/addresses')
      .set('Origin', origin)
      .set('X-CSRF-Token', ownerAccount.csrfToken)
      .send(addressPayload());
    expect(created.status).toBe(201);
    const addressId = created.body.address.id;
    expect(typeof addressId).toBe('string');

    const strangerList = await stranger.get('/api/v1/me/addresses');
    expect(strangerList.status).toBe(200);
    expect(strangerList.body.addresses).toHaveLength(0);
    const foreignPatch = await stranger
      .patch(`/api/v1/me/addresses/${addressId}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', strangerAccount.csrfToken)
      .send({ label: 'Not allowed' });
    expect(foreignPatch.status).toBe(404);
    expect(foreignPatch.body.error.code).toBe('ADDRESS_NOT_FOUND');

    const preferences = await owner
      .patch('/api/v1/me/preferences')
      .set('Origin', origin)
      .set('X-CSRF-Token', ownerAccount.csrfToken)
      .send({ language: 'fr', theme: 'dark', defaultPayment: 'cashplus', personalizationEnabled: false });
    expect(preferences.status).toBe(200);
    expect(preferences.body.preferences).toMatchObject({
      language: 'fr', theme: 'dark', defaultPayment: 'cashplus', personalizationEnabled: false
    });
    const persisted = await owner.get('/api/v1/me/preferences');
    expect(persisted.status).toBe(200);
    expect(persisted.body.preferences).toMatchObject({
      language: 'fr', theme: 'dark', defaultPayment: 'cashplus', personalizationEnabled: false
    });
  }, 60_000);

  it('merges a guest cart using catalog-authoritative availability and pricing', async () => {
    const product = uniqueProduct('cart', trackedProductIds, { price: '12.34', stock_quantity: 10 });
    const { app, catalog } = testApp([product]);
    const shopper = request.agent(app);
    const account = await register(shopper, uniqueEmail('cart', trackedEmails));

    const tampered = await shopper
      .post('/api/v1/cart/merge')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .send({ items: [{ productId: product.id, quantity: 2, unitPrice: '0.01' }] });
    expect(tampered.status).toBe(422);
    expect(tampered.body.error.code).toBe('VALIDATION_FAILED');

    const merged = await shopper
      .post('/api/v1/cart/merge')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .send({ items: [{ productId: product.id, quantity: 2 }] });
    expect(merged.status).toBe(200);
    expect(merged.body.cart.items).toHaveLength(1);
    expect(merged.body.cart.items[0]).toMatchObject({
      productId: product.id, quantity: 2, unitPrice: '12.34', isAvailable: true, verified: true
    });
    expect(merged.body.cart).toMatchObject({ subtotal: '24.68', deliveryFee: '20.00', total: '44.68' });

    catalog.records.get(product.id).stock_quantity = 1;
    const reducedStock = await shopper.get('/api/v1/cart');
    expect(reducedStock.status).toBe(200);
    expect(reducedStock.body.cart).toMatchObject({
      checkoutReady: false,
      subtotal: '0.00',
      deliveryFee: '0.00',
      total: '0.00'
    });
    expect(reducedStock.body.cart.items[0]).toMatchObject({
      productId: product.id,
      quantity: 2,
      stockQuantity: 1,
      quantityAvailable: false
    });
    catalog.records.get(product.id).stock_quantity = 10;

    const [rows] = await pool.execute(
      'SELECT last_verified_price FROM catalog_product_refs WHERE external_id = ? LIMIT 1',
      [product.id]
    );
    expect(rows[0].last_verified_price).toBe('12.34');
  }, 60_000);

  it('creates an idempotent server-priced order, rejects total injection, and records cancellation tracking', async () => {
    const product = uniqueProduct('checkout', trackedProductIds, { price: '100.00', stock_quantity: 10 });
    const { app } = testApp([product]);
    const shopper = request.agent(app);
    const account = await register(shopper, uniqueEmail('checkout', trackedEmails));
    const address = await shopper
      .post('/api/v1/me/addresses')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .send(addressPayload('Checkout'));
    expect(address.status).toBe(201);
    const merged = await shopper
      .post('/api/v1/cart/merge')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .send({ items: [{ productId: product.id, quantity: 2 }] });
    expect(merged.status).toBe(200);

    const checkoutBody = { addressId: address.body.address.id, paymentMethod: 'cod', note: null };
    const tampered = await shopper
      .post('/api/v1/orders')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .set('Idempotency-Key', `tamper-${randomUUID()}`)
      .send({ ...checkoutBody, total: '0.01' });
    expect(tampered.status).toBe(422);
    expect(tampered.body.error.code).toBe('VALIDATION_FAILED');

    const idempotencyKey = `checkout-${randomUUID()}`;
    const submitCheckout = () => shopper
      .post('/api/v1/orders')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .set('Idempotency-Key', idempotencyKey)
      .send(checkoutBody);
    const concurrent = await Promise.all([submitCheckout(), submitCheckout()]);
    const placed = concurrent.find((response) => response.status === 201);
    const concurrentReplay = concurrent.find((response) => response.status === 200);
    expect(placed).toBeDefined();
    expect(concurrentReplay).toBeDefined();
    expect(placed.status).toBe(201);
    expect(placed.body.replayed).toBe(false);
    expect(placed.body.order).toMatchObject({
      status: 'confirmed', subtotal: '200.00', deliveryFee: '0.00', total: '200.00'
    });
    expect(placed.body.order.items).toHaveLength(1);
    expect(placed.body.order.items[0]).toMatchObject({
      productId: product.id, unitPrice: '100.00', quantity: 2, lineTotal: '200.00'
    });
    const orderId = placed.body.order.id;
    expect(concurrentReplay.body).toMatchObject({ replayed: true, order: { id: orderId } });

    const replay = await shopper
      .post('/api/v1/orders')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .set('Idempotency-Key', idempotencyKey)
      .send(checkoutBody);
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.order.id).toBe(orderId);

    const reusedForDifferentRequest = await shopper
      .post('/api/v1/orders')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .set('Idempotency-Key', idempotencyKey)
      .send({ ...checkoutBody, note: 'Different request' });
    expect(reusedForDifferentRequest.status).toBe(409);
    expect(reusedForDifferentRequest.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const cancelled = await shopper
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .send({ reason: 'changed_mind' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.order.status).toBe('cancelled');
    expect(cancelled.body.order.tracking.at(-1)).toMatchObject({ status: 'cancelled', code: 'order_cancelled' });

    const tracking = await shopper.get(`/api/v1/orders/${orderId}/tracking`);
    expect(tracking.status).toBe(200);
    expect(tracking.body.status).toBe('cancelled');
    expect(tracking.body.events.map((event) => event.status)).toEqual(['confirmed', 'cancelled']);
  }, 60_000);

  it('accepts only signed fulfillment events and advances tracking transactionally and idempotently', async () => {
    const product = uniqueProduct('fulfillment', trackedProductIds, { price: '75.00', stock_quantity: 10 });
    const { app } = testApp([product]);
    const shopper = request.agent(app);
    const account = await register(shopper, uniqueEmail('fulfillment', trackedEmails));
    const address = await shopper
      .post('/api/v1/me/addresses')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .send(addressPayload('Fulfillment'));
    await shopper
      .post('/api/v1/cart/merge')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .send({ items: [{ productId: product.id, quantity: 1 }] });
    const placed = await shopper
      .post('/api/v1/orders')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .set('Idempotency-Key', `fulfillment-${randomUUID()}`)
      .send({ addressId: address.body.address.id, paymentMethod: 'cod' });
    expect(placed.status).toBe(201);
    const orderId = placed.body.order.id;

    const preparingPayload = { type: 'order.status.updated', orderId, status: 'preparing' };
    const unsigned = await request(app)
      .post('/api/v1/integrations/fulfillment/order-status')
      .set('Content-Type', 'application/json')
      .send(preparingPayload);
    expect(unsigned.status).toBe(401);
    expect(unsigned.body.error.code).toBe('AUTH_REQUIRED');

    const signedBrowserAttempt = await sendFulfillmentEvent(app, preparingPayload, { originHeader: origin });
    expect(signedBrowserAttempt.status).toBe(401);

    const skipped = await sendFulfillmentEvent(app, {
      type: 'order.status.updated', orderId, status: 'shipping'
    });
    expect(skipped.status).toBe(409);
    expect(skipped.body.error.code).toBe('ORDER_STATUS_TRANSITION_INVALID');

    const preparingEventId = randomUUID();
    const prepared = await sendFulfillmentEvent(app, preparingPayload, { eventId: preparingEventId });
    expect(prepared.status).toBe(200);
    expect(prepared.body).toMatchObject({
      accepted: true,
      replayed: false,
      eventId: preparingEventId,
      order: { id: orderId, status: 'preparing' }
    });

    const replay = await sendFulfillmentEvent(app, preparingPayload, { eventId: preparingEventId });
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);

    const reused = await sendFulfillmentEvent(app, {
      type: 'order.status.updated', orderId, status: 'shipping'
    }, { eventId: preparingEventId });
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('FULFILLMENT_EVENT_ID_REUSED');

    const disabledNotifications = await shopper
      .patch('/api/v1/me/preferences')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .send({ orderNotifications: false });
    expect(disabledNotifications.status).toBe(200);

    const shipped = await sendFulfillmentEvent(app, {
      type: 'order.status.updated', orderId, status: 'shipping', location: 'Casablanca hub'
    });
    expect(shipped.status).toBe(200);
    expect(shipped.body.order.status).toBe('shipping');
    const delivered = await sendFulfillmentEvent(app, {
      type: 'order.status.updated', orderId, status: 'delivered'
    });
    expect(delivered.status).toBe(200);
    expect(delivered.body.order.status).toBe('delivered');

    const tracking = await shopper.get(`/api/v1/orders/${orderId}/tracking`);
    expect(tracking.status).toBe(200);
    expect(tracking.body.status).toBe('delivered');
    expect(tracking.body.events.map((event) => event.status)).toEqual([
      'confirmed', 'preparing', 'shipping', 'delivered'
    ]);
    expect(tracking.body.events.slice(1).every((event) => event.source === 'fulfillment')).toBe(true);

    const [notificationRows] = await pool.execute(
      `SELECT type FROM notifications
        WHERE order_id = (SELECT id FROM orders WHERE public_id = ? LIMIT 1)
        ORDER BY created_at`,
      [orderId]
    );
    expect(notificationRows.map((row) => row.type)).toEqual(['order_confirmed', 'order_preparing']);

    const [outboxRows] = await pool.execute(
      `SELECT event_type FROM outbox_events
        WHERE aggregate_type = 'order'
          AND aggregate_id = (SELECT CAST(id AS CHAR) FROM orders WHERE public_id = ? LIMIT 1)
        ORDER BY id`,
      [orderId]
    );
    expect(outboxRows.map((row) => row.event_type)).toEqual([
      'order.confirmed', 'order.preparing', 'order.shipping', 'order.delivered'
    ]);
  }, 60_000);

  it('enforces review ownership while exposing the published rating summary', async () => {
    const product = uniqueProduct('review', trackedProductIds, { price: '8.50' });
    const { app } = testApp([product]);
    const author = request.agent(app);
    const stranger = request.agent(app);
    const authorAccount = await register(author, uniqueEmail('review-author', trackedEmails), 'Review Author');
    const strangerAccount = await register(stranger, uniqueEmail('review-stranger', trackedEmails), 'Review Stranger');

    const created = await author
      .post(`/api/v1/catalog/products/${product.id}/reviews`)
      .set('Origin', origin)
      .set('X-CSRF-Token', authorAccount.csrfToken)
      .send({ rating: 4, title: 'Useful product', body: 'A clear integration-test review.' });
    expect(created.status).toBe(201);
    const reviewId = created.body.review.id;

    const foreignPatch = await stranger
      .patch(`/api/v1/reviews/${reviewId}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', strangerAccount.csrfToken)
      .send({ rating: 1 });
    expect(foreignPatch.status).toBe(404);
    expect(foreignPatch.body.error.code).toBe('REVIEW_NOT_FOUND');

    const ownerPatch = await author
      .patch(`/api/v1/reviews/${reviewId}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', authorAccount.csrfToken)
      .send({ rating: 5, title: 'Updated review' });
    expect(ownerPatch.status).toBe(200);

    const published = await request(app).get(`/api/v1/catalog/products/${product.id}/reviews`);
    expect(published.status).toBe(200);
    expect(published.body.summary).toEqual({ count: 1, average: '5.0' });
    expect(published.body.reviews).toHaveLength(1);
    expect(published.body.reviews[0]).toMatchObject({ id: reviewId, rating: 5, title: 'Updated review' });

    const removed = await author
      .delete(`/api/v1/reviews/${reviewId}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', authorAccount.csrfToken);
    expect(removed.status).toBe(204);
    const recreated = await author
      .post(`/api/v1/catalog/products/${product.id}/reviews`)
      .set('Origin', origin)
      .set('X-CSRF-Token', authorAccount.csrfToken)
      .send({ rating: 4, title: 'Reviewed again', body: 'A replacement after deletion.' });
    expect(recreated.status).toBe(201);
    expect(recreated.body.review).toMatchObject({ rating: 4, title: 'Reviewed again' });
    expect(recreated.body.review.id).not.toBe(reviewId);
    const republished = await request(app).get(`/api/v1/catalog/products/${product.id}/reviews`);
    expect(republished.body.summary).toEqual({ count: 1, average: '4.0' });
    expect(republished.body.reviews).toHaveLength(1);
    expect(republished.body.reviews[0].id).toBe(recreated.body.review.id);
  }, 60_000);

  it('aligns wishlist and explicit stock subscriptions and deduplicates real stock transitions', async () => {
    const product = uniqueProduct('low-stock', trackedProductIds, { stock_quantity: 3 });
    const catalog = createMockCatalog([product]);
    const app = createApp({ database: pool, catalog, mailService: createMockMailer() });
    const shopper = request.agent(app);
    const account = await register(shopper, uniqueEmail('low-stock', trackedEmails));
    const evaluator = createLowStockEvaluator({
      database: pool,
      catalog,
      logger: { info() {}, debug() {}, warn() {}, error() {} },
      options: {
        enabled: true,
        intervalMs: 60_000,
        runTimeoutMs: 10_000,
        batchSize: 100,
        concurrency: 2,
        defaultThreshold: 5,
        notificationTtlDays: 30
      }
    });

    const wishlisted = await shopper
      .post('/api/v1/wishlist/items')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .send({ productId: product.id });
    expect(wishlisted.status).toBe(201);

    const automaticStatus = await shopper.get(`/api/v1/me/low-stock-subscriptions/${product.id}`);
    expect(automaticStatus.status).toBe(200);
    expect(automaticStatus.body.subscription).toMatchObject({
      productId: product.id,
      subscribed: true,
      notificationsEnabled: true,
      sources: { explicit: false, wishlist: true }
    });

    expect((await evaluator.runNow()).notifications).toBe(1);
    expect((await evaluator.runNow()).notifications).toBe(0);
    let notifications = await shopper.get('/api/v1/notifications');
    expect(notifications.body.notifications.filter((item) => item.productId === product.id))
      .toHaveLength(1);
    expect(notifications.body.notifications[0]).toMatchObject({ type: 'low_stock', productId: product.id });

    catalog.records.get(product.id).stock_quantity = 20;
    expect((await evaluator.runNow()).notifications).toBe(1);
    notifications = await shopper.get('/api/v1/notifications');
    expect(notifications.body.notifications.filter((item) => item.productId === product.id).map((item) => item.type))
      .toEqual(['restocked', 'low_stock']);

    const disabled = await shopper
      .patch('/api/v1/me/preferences')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .send({ lowStockNotifications: false });
    expect(disabled.status).toBe(200);
    catalog.records.get(product.id).stock_quantity = 1;
    expect((await evaluator.runNow()).subscriptions).toBe(0);
    notifications = await shopper.get('/api/v1/notifications');
    expect(notifications.body.notifications.filter((item) => item.productId === product.id)).toHaveLength(2);

    await shopper
      .patch('/api/v1/me/preferences')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .send({ lowStockNotifications: true });
    expect((await evaluator.runNow()).notifications).toBe(1);

    const removed = await shopper
      .delete(`/api/v1/wishlist/items/${product.id}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken);
    expect(removed.status).toBe(204);
    expect((await shopper.get(`/api/v1/me/low-stock-subscriptions/${product.id}`)).body.subscription.subscribed).toBe(false);

    const explicit = await shopper
      .post('/api/v1/me/low-stock-subscriptions')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .send({ productId: product.id });
    expect(explicit.status).toBe(201);
    expect(explicit.body.subscription.sources.explicit).toBe(true);

    const optedOut = await shopper
      .delete(`/api/v1/me/low-stock-subscriptions/${product.id}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken);
    expect(optedOut.status).toBe(204);
    await shopper
      .post('/api/v1/wishlist/items')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .send({ productId: product.id });
    const optOutStatus = await shopper.get(`/api/v1/me/low-stock-subscriptions/${product.id}`);
    expect(optOutStatus.body.subscription).toMatchObject({
      subscribed: false,
      userOptedOut: true,
      sources: { explicit: false, wishlist: true }
    });
    await evaluator.stop();
  }, 60_000);
});
