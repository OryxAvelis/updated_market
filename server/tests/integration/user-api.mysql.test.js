import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { provisionLocalDemoUser } from '../../src/auth/local-demo.js';
import { config } from '../../src/config.js';
import { runMigrations } from '../../src/db/migrate.js';
import { pool } from '../../src/db/pool.js';
import { createLowStockEvaluator } from '../../src/engagement/low-stock.js';
import { createFulfillmentSignature } from '../../src/integrations/fulfillment-auth.js';
import { csrfCookieName } from '../../src/security/cookies.js';
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
const trackedGuestOrderIds = new Set();
const trackedGuestTokens = new Set();
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

function responseCookie(response, name) {
  return (response.headers['set-cookie'] || [])
    .filter((cookie) => cookie.startsWith(`${name}=`))
    .at(-1)
    ?.split(';', 1)[0] || '';
}

async function issueGuestAccess(agent, csrfToken) {
  const response = await agent
    .post('/api/v1/guest-orders/access')
    .set('Origin', origin)
    .set('X-CSRF-Token', csrfToken);
  if (response.status !== 201 || typeof response.body.access?.token !== 'string') {
    throw new Error(`Guest checkout access issuance failed with HTTP ${response.status}.`);
  }
  trackedGuestTokens.add(response.body.access.token);
  return response.body.access;
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

function guestOrderPayload(productId, overrides = {}) {
  return {
    items: [{ productId, quantity: overrides.quantity ?? 1 }],
    delivery: {
      recipientName: overrides.recipientName || 'Guest Integration Customer',
      phone: '+212612345678',
      email: overrides.email || 'guest-integration@example.test',
      addressLine1: '10 Guest Integration Street',
      addressLine2: null,
      district: 'Maarif',
      city: 'Casablanca',
      postalCode: '20000',
      country: 'MA',
      deliveryInstructions: null
    },
    paymentMethod: 'cod',
    note: null
  };
}

function cartMergeKey() {
  return `am1.${Date.now().toString(36)}.${randomUUID()}`;
}

function uniqueGmailEmail(label) {
  const suffix = randomUUID().replaceAll('-', '');
  const email = `am.market.${label}.${suffix}@gmail.com`.toLowerCase();
  trackedEmails.add(email);
  return email;
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
      if (databaseReady) {
        await cleanupIntegrationData(
          pool,
          trackedEmails,
          trackedProductIds,
          trackedGuestOrderIds,
          trackedGuestTokens
        );
      }
    } finally {
      await pool?.end();
    }
  }, 60_000);

  it('keeps arbitrary-credential demo login explicitly capability-gated', async () => {
    const { app, mailer } = testApp();
    const shopper = request.agent(app);
    const initialSession = await shopper.get('/api/v1/auth/session');

    expect(initialSession.status).toBe(200);
    expect(initialSession.body.capabilities?.localDemoLogin).toBe(config.auth.localDevLoginEnabled);
    const initialCsrfCookie = responseCookie(initialSession, csrfCookieName);
    expect(initialCsrfCookie).not.toBe('');

    if (!config.auth.localDevLoginEnabled) {
      const disabled = await shopper
        .post('/api/v1/auth/demo-login')
        .set('Origin', origin)
        .set('Cookie', initialCsrfCookie)
        .set('X-CSRF-Token', initialSession.body.csrfToken)
        .send({ email: 'anything', password: 'anything' });
      expect(disabled.status).toBe(404);
      return;
    }

    trackedEmails.add(config.auth.localDevLoginUserEmail);
    await provisionLocalDemoUser(pool, config.auth.localDevLoginUserEmail);

    const demoLogin = await shopper
      .post('/api/v1/auth/demo-login')
      .set('Origin', origin)
      .set('Cookie', initialCsrfCookie)
      .set('X-CSRF-Token', initialSession.body.csrfToken)
      .send({ email: 'not an email address', password: 'x' });
    expect(demoLogin.status).toBe(200);
    expect(demoLogin.body).toMatchObject({
      localDemo: true,
      user: {
        email: config.auth.localDevLoginUserEmail,
        displayName: 'AM MARKET Shopper'
      }
    });

    const sessionCookie = responseCookie(demoLogin, config.auth.cookieName);
    expect(sessionCookie).not.toBe('');
    const activeSession = await shopper
      .get('/api/v1/auth/session')
      .set('Cookie', sessionCookie);
    expect(activeSession.status).toBe(200);
    expect(activeSession.body).toMatchObject({
      authenticated: true,
      capabilities: { localDemoLogin: true },
      user: { email: config.auth.localDevLoginUserEmail }
    });
    const activeCsrfCookie = responseCookie(activeSession, csrfCookieName);
    expect(activeCsrfCookie).not.toBe('');
    const authenticatedCookies = `${sessionCookie}; ${activeCsrfCookie}`;
    const authenticatedCsrfToken = activeSession.body.csrfToken;

    const protectedEmail = await request(app)
      .patch('/api/v1/me')
      .set('Origin', origin)
      .set('Cookie', authenticatedCookies)
      .set('X-CSRF-Token', authenticatedCsrfToken)
      .send({ email: 'renamed@example.test', currentPassword: 'anything' });
    expect(protectedEmail.status).toBe(403);
    expect(protectedEmail.body.error.code).toBe('DEMO_ACCOUNT_RESTRICTED');

    const protectedPassword = await request(app)
      .post('/api/v1/auth/password/change')
      .set('Origin', origin)
      .set('Cookie', authenticatedCookies)
      .set('X-CSRF-Token', authenticatedCsrfToken)
      .send({ currentPassword: 'anything', newPassword: testPassword });
    expect(protectedPassword.status).toBe(403);
    expect(protectedPassword.body.error.code).toBe('DEMO_ACCOUNT_RESTRICTED');

    const protectedClosure = await request(app)
      .delete('/api/v1/me')
      .set('Origin', origin)
      .set('Cookie', authenticatedCookies)
      .set('X-CSRF-Token', authenticatedCsrfToken)
      .send({ password: 'anything', action: 'deactivate' });
    expect(protectedClosure.status).toBe(403);
    expect(protectedClosure.body.error.code).toBe('DEMO_ACCOUNT_RESTRICTED');

    const resetRequest = await request(app)
      .post('/api/v1/auth/password-reset/request')
      .set('Origin', origin)
      .set('Cookie', authenticatedCookies)
      .set('X-CSRF-Token', authenticatedCsrfToken)
      .send({ email: config.auth.localDevLoginUserEmail });
    expect(resetRequest.status).toBe(202);
    expect(mailer.deliveries).toHaveLength(0);

    const strictClient = request.agent(app);
    const strictBootstrap = await strictClient.get('/api/v1/auth/session');
    const strictCsrfCookie = responseCookie(strictBootstrap, csrfCookieName);
    const strictLogin = await strictClient
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('Cookie', strictCsrfCookie)
      .set('X-CSRF-Token', strictBootstrap.body.csrfToken)
      .send({ email: 'not an email address', password: 'x' });
    expect(strictLogin.status).toBe(422);
    const reservedStrictLogin = await strictClient
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('Cookie', strictCsrfCookie)
      .set('X-CSRF-Token', strictBootstrap.body.csrfToken)
      .send({ email: config.auth.localDevLoginUserEmail, password: testPassword });
    expect(reservedStrictLogin.status).toBe(403);
    expect(reservedStrictLogin.body.error.code).toBe('INVALID_CREDENTIALS');
  }, 60_000);

  it('enforces origin and CSRF, keeps independent device sessions, and makes password resets generic and one-use', async () => {
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
    const stillActivePrimary = await primary.get('/api/v1/auth/session');
    expect(stillActivePrimary.status).toBe(200);
    expect(stillActivePrimary.body.authenticated).toBe(true);
    expect(stillActivePrimary.body.user.email).toBe(email);

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
    const revokedPrimary = await primary.get('/api/v1/auth/session');
    expect(revokedPrimary.status).toBe(200);
    expect(revokedPrimary.body.authenticated).toBe(false);

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

  it('persists normalized Gmail accounts and restores account data across concurrent devices', async () => {
    const cartProduct = uniqueProduct('gmail-cart', trackedProductIds, { price: '18.25', stock_quantity: 20 });
    const wishlistProduct = uniqueProduct('gmail-wishlist', trackedProductIds, { price: '31.50', stock_quantity: 12 });
    const { app } = testApp([cartProduct, wishlistProduct]);
    const primaryEmail = uniqueGmailEmail('primary');
    const otherEmail = uniqueGmailEmail('other');
    const registrationDevice = request.agent(app);
    const primaryAccount = await register(
      registrationDevice,
      `  ${primaryEmail.toUpperCase()}  `,
      'Gmail Integration Customer'
    );
    const primaryPublicId = primaryAccount.response.body.user.id;

    expect(primaryAccount.response.body.user).toMatchObject({
      id: primaryPublicId,
      email: primaryEmail,
      displayName: 'Gmail Integration Customer'
    });

    const [primaryRows] = await pool.execute(
      `SELECT u.id, u.public_id, u.email, u.email_normalized, u.password_hash,
              (SELECT COUNT(*) FROM user_preferences p WHERE p.user_id = u.id) AS preference_count,
              (SELECT COUNT(*) FROM carts c WHERE c.user_id = u.id) AS cart_count,
              (SELECT COUNT(*) FROM wishlists w WHERE w.user_id = u.id) AS wishlist_count
         FROM users u
        WHERE u.email_normalized = ?`,
      [primaryEmail]
    );
    expect(primaryRows).toHaveLength(1);
    expect(primaryRows[0]).toMatchObject({
      public_id: primaryPublicId,
      email: primaryEmail,
      email_normalized: primaryEmail
    });
    expect(primaryRows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(primaryRows[0].password_hash).not.toBe(testPassword);
    expect({
      preferences: Number(primaryRows[0].preference_count),
      carts: Number(primaryRows[0].cart_count),
      wishlists: Number(primaryRows[0].wishlist_count)
    }).toEqual({ preferences: 1, carts: 1, wishlists: 1 });

    const otherRegistrationDevice = request.agent(app);
    const otherAccount = await register(otherRegistrationDevice, otherEmail, 'Other Gmail Customer');
    expect(otherAccount.response.body.user.id).not.toBe(primaryPublicId);
    const [gmailAccounts] = await pool.execute(
      `SELECT email_normalized, public_id
         FROM users
        WHERE email_normalized IN (?, ?)
        ORDER BY email_normalized`,
      [primaryEmail, otherEmail]
    );
    expect(gmailAccounts).toHaveLength(2);
    expect(new Set(gmailAccounts.map((row) => row.public_id)).size).toBe(2);

    const preferences = await registrationDevice
      .patch('/api/v1/me/preferences')
      .set('Origin', origin)
      .set('X-CSRF-Token', primaryAccount.csrfToken)
      .send({ language: 'fr', theme: 'dark', defaultPayment: 'wafacash' });
    expect(preferences.status).toBe(200);

    const address = await registrationDevice
      .post('/api/v1/me/addresses')
      .set('Origin', origin)
      .set('X-CSRF-Token', primaryAccount.csrfToken)
      .send(addressPayload('Cross-device home'));
    expect(address.status).toBe(201);

    const cart = await registrationDevice
      .post('/api/v1/cart/items')
      .set('Origin', origin)
      .set('X-CSRF-Token', primaryAccount.csrfToken)
      .send({ productId: cartProduct.id, quantity: 2 });
    expect(cart.status).toBe(201);

    const wishlist = await registrationDevice
      .post('/api/v1/wishlist/items')
      .set('Origin', origin)
      .set('X-CSRF-Token', primaryAccount.csrfToken)
      .send({ productId: wishlistProduct.id });
    expect(wishlist.status).toBe(201);

    const logout = await registrationDevice
      .post('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('X-CSRF-Token', primaryAccount.csrfToken)
      .send({});
    expect(logout.status).toBe(200);

    const firstDevice = request.agent(app);
    const firstLoginCsrf = await csrfFor(firstDevice);
    const firstLogin = await firstDevice
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', firstLoginCsrf)
      .send({ email: primaryEmail.toUpperCase(), password: testPassword });
    expect(firstLogin.status).toBe(200);
    expect(firstLogin.body.user.id).toBe(primaryPublicId);

    const secondDevice = request.agent(app);
    const secondLoginCsrf = await csrfFor(secondDevice);
    const secondLogin = await secondDevice
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', secondLoginCsrf)
      .send({ email: ` ${primaryEmail} `, password: testPassword });
    expect(secondLogin.status).toBe(200);
    expect(secondLogin.body.user.id).toBe(primaryPublicId);

    const firstDeviceSession = await firstDevice.get('/api/v1/auth/session');
    expect(firstDeviceSession.status).toBe(200);
    expect(firstDeviceSession.body).toMatchObject({
      authenticated: true,
      user: { id: primaryPublicId, email: primaryEmail }
    });

    const [restoredPreferences, restoredAddresses, restoredCart, restoredWishlist] = await Promise.all([
      secondDevice.get('/api/v1/me/preferences'),
      secondDevice.get('/api/v1/me/addresses'),
      secondDevice.get('/api/v1/cart'),
      secondDevice.get('/api/v1/wishlist')
    ]);
    expect(restoredPreferences.status).toBe(200);
    expect(restoredPreferences.body.preferences).toMatchObject({
      language: 'fr',
      theme: 'dark',
      defaultPayment: 'wafacash'
    });
    expect(restoredAddresses.status).toBe(200);
    expect(restoredAddresses.body.addresses).toContainEqual(expect.objectContaining({
      id: address.body.address.id,
      label: 'Cross-device home',
      isDefault: true
    }));
    expect(restoredCart.status).toBe(200);
    expect(restoredCart.body.cart.items).toContainEqual(expect.objectContaining({
      productId: cartProduct.id,
      quantity: 2
    }));
    expect(restoredWishlist.status).toBe(200);
    expect(restoredWishlist.body.items).toContainEqual(expect.objectContaining({
      productId: wishlistProduct.id
    }));

    const duplicateDevice = request.agent(app);
    const duplicateCsrf = await csrfFor(duplicateDevice);
    const duplicate = await duplicateDevice
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .set('X-CSRF-Token', duplicateCsrf)
      .send({
        displayName: 'Duplicate Gmail Customer',
        email: ` ${primaryEmail.toUpperCase()} `,
        password: testPassword,
        language: 'en'
      });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    const [duplicateRows] = await pool.execute(
      'SELECT COUNT(*) AS total FROM users WHERE email_normalized = ?',
      [primaryEmail]
    );
    expect(Number(duplicateRows[0].total)).toBe(1);

    const passwordChange = await firstDevice
      .post('/api/v1/auth/password/change')
      .set('Origin', origin)
      .set('X-CSRF-Token', firstDeviceSession.body.csrfToken)
      .send({ currentPassword: testPassword, newPassword: changedPassword });
    expect(passwordChange.status).toBe(200);
    expect((await firstDevice.get('/api/v1/auth/session')).body.authenticated).toBe(true);
    expect((await secondDevice.get('/api/v1/auth/session')).body.authenticated).toBe(false);
  }, 60_000);

  it('isolates saved addresses by session user and persists preferences', async () => {
    const { app } = testApp();
    const owner = request.agent(app);
    const stranger = request.agent(app);
    const ownerAccount = await register(owner, uniqueEmail('address-owner', trackedEmails), 'Address Owner');
    const strangerAccount = await register(stranger, uniqueEmail('address-stranger', trackedEmails), 'Address Stranger');

    const firstAddress = { ...addressPayload(), isDefault: false };
    const created = await owner
      .post('/api/v1/me/addresses')
      .set('Origin', origin)
      .set('X-CSRF-Token', ownerAccount.csrfToken)
      .send(firstAddress);
    expect(created.status).toBe(201);
    const addressId = created.body.address.id;
    expect(typeof addressId).toBe('string');
    expect(created.body.address.isDefault).toBe(true);

    const replayedAddress = await owner
      .post('/api/v1/me/addresses')
      .set('Origin', origin)
      .set('X-CSRF-Token', ownerAccount.csrfToken)
      .send(firstAddress);
    expect(replayedAddress.status).toBe(200);
    expect(replayedAddress.body).toMatchObject({ replayed: true, address: { id: addressId } });
    const ownerAddresses = await owner.get('/api/v1/me/addresses');
    expect(ownerAddresses.body.addresses).toHaveLength(1);

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
    const mergeKey = cartMergeKey();

    const tampered = await shopper
      .post('/api/v1/cart/merge')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .set('Idempotency-Key', cartMergeKey())
      .send({ items: [{ productId: product.id, quantity: 2, unitPrice: '0.01' }] });
    expect(tampered.status).toBe(422);
    expect(tampered.body.error.code).toBe('VALIDATION_FAILED');

    const merged = await shopper
      .post('/api/v1/cart/merge')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .set('Idempotency-Key', mergeKey)
      .send({ items: [{ productId: product.id, quantity: 2 }] });
    expect(merged.status).toBe(200);
    expect(merged.body.cart.items).toHaveLength(1);
    expect(merged.body.cart.items[0]).toMatchObject({
      productId: product.id, quantity: 2, unitPrice: '12.34', isAvailable: true, verified: true
    });
    expect(merged.body.cart).toMatchObject({ subtotal: '24.68', deliveryFee: '20.00', total: '44.68' });

    const replayed = await shopper
      .post('/api/v1/cart/merge')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .set('Idempotency-Key', mergeKey)
      .send({ items: [{ productId: product.id, quantity: 2 }] });
    expect(replayed.status).toBe(200);
    expect(replayed.body.replayed).toBe(true);
    expect(replayed.body.cart.items[0].quantity).toBe(2);

    const reusedKey = await shopper
      .post('/api/v1/cart/merge')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .set('Idempotency-Key', mergeKey)
      .send({ items: [{ productId: product.id, quantity: 1 }] });
    expect(reusedKey.status).toBe(409);
    expect(reusedKey.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    catalog.records.get(product.id).stock_quantity = 120;
    const nearLimit = await shopper
      .put(`/api/v1/cart/items/${product.id}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .send({ quantity: 95 });
    expect(nearLimit.status).toBe(200);
    const excessiveMerge = await shopper
      .post('/api/v1/cart/merge')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .set('Idempotency-Key', cartMergeKey())
      .send({ items: [{ productId: product.id, quantity: 10 }] });
    expect(excessiveMerge.status).toBe(409);
    expect(excessiveMerge.body.error.code).toBe('QUANTITY_LIMIT_EXCEEDED');
    const unchangedAfterOverflow = await shopper.get('/api/v1/cart');
    expect(unchangedAfterOverflow.body.cart.items[0].quantity).toBe(95);

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
      quantity: 95,
      stockQuantity: 1,
      quantityAvailable: false
    });
    catalog.records.delete(product.id);
    const discontinued = await shopper.get('/api/v1/cart');
    expect(discontinued.status).toBe(200);
    expect(discontinued.body.cart).toMatchObject({ checkoutReady: false, total: '0.00' });
    expect(discontinued.body.cart.items[0]).toMatchObject({
      productId: product.id, isAvailable: false, stockQuantity: 0,
      quantityAvailable: false, verified: true
    });

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
      .set('Idempotency-Key', cartMergeKey())
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
    const concurrentResults = JSON.stringify(concurrent.map((response) => ({
      status: response.status,
      error: response.body.error
    })));
    expect(placed, concurrentResults).toBeDefined();
    expect(concurrentReplay, concurrentResults).toBeDefined();
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

  it('creates and privately retrieves an idempotent server-priced guest order', async () => {
    const product = uniqueProduct('guest-checkout', trackedProductIds, {
      price: '45.00',
      stock_quantity: 10
    });
    const { app, catalog } = testApp([product]);
    const guest = request.agent(app);
    const csrfToken = await csrfFor(guest);
    const missingOriginAccess = await guest
      .post('/api/v1/guest-orders/access')
      .set('X-CSRF-Token', csrfToken);
    expect(missingOriginAccess.status).toBe(403);
    expect(missingOriginAccess.body.error.code).toBe('ORIGIN_REJECTED');

    const missingCsrfAccess = await guest
      .post('/api/v1/guest-orders/access')
      .set('Origin', origin);
    expect(missingCsrfAccess.status).toBe(403);
    expect(missingCsrfAccess.body.error.code).toBe('CSRF_INVALID');

    const access = await issueGuestAccess(guest, csrfToken);
    expect(access.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(access.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
    expect(Date.parse(access.expiresAt)).toBeGreaterThan(Date.now());
    const guestToken = access.token;
    const idempotencyKey = access.idempotencyKey;
    const body = {
      items: [{ productId: product.id, quantity: 2 }],
      delivery: {
        recipientName: 'Guest Customer',
        phone: '+212612345678',
        email: 'guest-checkout@example.test',
        addressLine1: '10 Guest Checkout Street',
        addressLine2: null,
        district: 'Maarif',
        city: 'Casablanca',
        postalCode: '20000',
        country: 'MA',
        deliveryInstructions: 'Ring once'
      },
      paymentMethod: 'cod',
      note: 'Leave at reception'
    };

    const missingOrigin = await guest
      .post('/api/v1/guest-orders')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', `missing-origin-${randomUUID()}`)
      .set('X-Guest-Order-Token', randomBytes(32).toString('base64url'))
      .send(body);
    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.body.error.code).toBe('ORIGIN_REJECTED');

    const missingCsrf = await guest
      .post('/api/v1/guest-orders')
      .set('Origin', origin)
      .set('Idempotency-Key', `missing-csrf-${randomUUID()}`)
      .set('X-Guest-Order-Token', randomBytes(32).toString('base64url'))
      .send(body);
    expect(missingCsrf.status).toBe(403);
    expect(missingCsrf.body.error.code).toBe('CSRF_INVALID');

    const missingToken = await guest
      .post('/api/v1/guest-orders')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', `missing-token-${randomUUID()}`)
      .send(body);
    expect(missingToken.status).toBe(400);
    expect(missingToken.body.error.code).toBe('GUEST_ORDER_TOKEN_REQUIRED');

    const tampered = await guest
      .post('/api/v1/guest-orders')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', `tampered-${randomUUID()}`)
      .set('X-Guest-Order-Token', randomBytes(32).toString('base64url'))
      .send({ ...body, total: '0.01' });
    expect(tampered.status).toBe(422);
    expect(tampered.body.error.code).toBe('VALIDATION_FAILED');

    const submit = () => guest
      .post('/api/v1/guest-orders')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', idempotencyKey)
      .set('X-Guest-Order-Token', guestToken)
      .send(body);
    const concurrent = await Promise.all([submit(), submit()]);
    const placed = concurrent.find((response) => response.status === 201);
    const concurrentReplay = concurrent.find((response) => response.status === 200);
    expect(placed, JSON.stringify(concurrent.map((response) => ({
      status: response.status,
      error: response.body.error
    })))).toBeDefined();
    expect(concurrentReplay, JSON.stringify(concurrent.map((response) => ({
      status: response.status,
      error: response.body.error
    })))).toBeDefined();
    expect(placed.body).toMatchObject({
      replayed: false,
      order: {
        status: 'confirmed',
        subtotal: '90.00',
        deliveryFee: '20.00',
        total: '110.00',
        address: {
          recipientName: 'Guest Customer',
          email: 'guest-checkout@example.test',
          city: 'Casablanca'
        }
      }
    });
    expect(Date.parse(placed.body.order.accessExpiresAt)).toBeGreaterThan(Date.now());
    expect(placed.body.order.items).toHaveLength(1);
    expect(placed.body.order.items[0]).toMatchObject({
      productId: product.id,
      unitPrice: '45.00',
      quantity: 2,
      lineTotal: '90.00'
    });
    const orderId = placed.body.order.id;
    trackedGuestOrderIds.add(orderId);
    expect(concurrentReplay.body).toMatchObject({ replayed: true, order: { id: orderId } });

    const replay = await submit();
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ replayed: true, order: { id: orderId } });

    const changedRequest = await guest
      .post('/api/v1/guest-orders')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', idempotencyKey)
      .set('X-Guest-Order-Token', guestToken)
      .send({ ...body, note: 'Changed after checkout' });
    expect(changedRequest.status).toBe(409);
    expect(changedRequest.body.error.code).toBe('GUEST_CHECKOUT_CREDENTIALS_REUSED');

    const reusedToken = await guest
      .post('/api/v1/guest-orders')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', `new-key-${randomUUID()}`)
      .set('X-Guest-Order-Token', guestToken)
      .send(body);
    expect(reusedToken.status).toBe(409);
    expect(reusedToken.body.error.code).toBe('GUEST_CHECKOUT_CREDENTIALS_REUSED');

    const reusedIdempotencyKey = await guest
      .post('/api/v1/guest-orders')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', idempotencyKey)
      .set('X-Guest-Order-Token', randomBytes(32).toString('base64url'))
      .send(body);
    expect(reusedIdempotencyKey.status).toBe(409);
    expect(reusedIdempotencyKey.body.error.code).toBe('GUEST_CHECKOUT_CREDENTIALS_REUSED');

    const duplicateItems = await guest
      .post('/api/v1/guest-orders')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', `duplicate-items-${randomUUID()}`)
      .set('X-Guest-Order-Token', randomBytes(32).toString('base64url'))
      .send({ ...body, items: [body.items[0], body.items[0]] });
    expect(duplicateItems.status).toBe(422);
    expect(duplicateItems.body.error.code).toBe('VALIDATION_FAILED');

    const noToken = await guest.get(`/api/v1/guest-orders/${orderId}`);
    expect(noToken.status).toBe(404);
    expect(noToken.body.error.code).toBe('ORDER_NOT_FOUND');
    expect(noToken.headers['cache-control']).toBe('no-store');

    const wrongToken = await guest
      .get(`/api/v1/guest-orders/${orderId}`)
      .set('X-Guest-Order-Token', randomBytes(32).toString('base64url'));
    expect(wrongToken.status).toBe(404);
    expect(wrongToken.body.error.code).toBe('ORDER_NOT_FOUND');

    const detail = await guest
      .get(`/api/v1/guest-orders/${orderId}`)
      .set('X-Guest-Order-Token', guestToken);
    expect(detail.status).toBe(200);
    expect(detail.headers['cache-control']).toBe('no-store');
    expect(detail.body.order).toMatchObject({
      id: orderId,
      orderNumber: placed.body.order.orderNumber,
      address: { phone: '+212612345678' }
    });

    const privateList = await guest.get('/api/v1/orders');
    expect(privateList.status).toBe(401);
    expect(privateList.body.error.code).toBe('AUTH_REQUIRED');

    const account = request.agent(app);
    await register(account, uniqueEmail('guest-order-stranger', trackedEmails), 'Account Customer');
    const foreignDetail = await account.get(`/api/v1/orders/${orderId}`);
    expect(foreignDetail.status).toBe(404);
    expect(foreignDetail.body.error.code).toBe('ORDER_NOT_FOUND');

    const prepared = await sendFulfillmentEvent(app, {
      type: 'order.status.updated',
      orderId,
      status: 'preparing'
    });
    expect(prepared.status).toBe(200);
    expect(prepared.body.order).toMatchObject({ id: orderId, status: 'preparing' });

    const tracking = await guest
      .get(`/api/v1/guest-orders/${orderId}/tracking`)
      .set('X-Guest-Order-Token', guestToken);
    expect(tracking.status).toBe(200);
    expect(tracking.body).toMatchObject({ orderId, status: 'preparing' });
    expect(tracking.body.events.map((event) => event.status)).toEqual(['confirmed', 'preparing']);

    const [orderRows] = await pool.execute(
      `SELECT user_id, cart_version, guest_access_digest, guest_idempotency_digest,
              idempotency_digest, guest_access_expires_at, guest_access_revoked_at
         FROM orders WHERE public_id = ? LIMIT 1`,
      [orderId]
    );
    expect(orderRows[0].user_id).toBeNull();
    expect(orderRows[0].cart_version).toBeNull();
    expect(Buffer.from(orderRows[0].guest_access_digest)).toHaveLength(32);
    expect(Buffer.from(orderRows[0].guest_idempotency_digest).equals(
      Buffer.from(orderRows[0].idempotency_digest)
    )).toBe(true);
    expect(new Date(orderRows[0].guest_access_expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(orderRows[0].guest_access_revoked_at).toBeNull();
    const [claimRows] = await pool.execute(
      `SELECT state, request_digest, lease_digest, order_id
         FROM guest_checkout_claims WHERE access_digest = ? LIMIT 1`,
      [orderRows[0].guest_access_digest]
    );
    expect(claimRows[0].state).toBe('completed');
    expect(Buffer.from(claimRows[0].request_digest)).toHaveLength(32);
    expect(claimRows[0].lease_digest).toBeNull();
    expect(claimRows[0].order_id).toBeDefined();
    const [inventoryRows] = await pool.execute(
      `SELECT i.available_quantity, a.quantity, a.inventory_policy
         FROM catalog_inventory i
         JOIN catalog_product_refs r ON r.id = i.product_ref_id
         JOIN order_inventory_allocations a ON a.product_ref_id = i.product_ref_id
        WHERE r.external_id = ? AND a.order_id = ?`,
      [product.id, claimRows[0].order_id]
    );
    expect(inventoryRows[0]).toMatchObject({
      available_quantity: 8,
      quantity: 2,
      inventory_policy: 'finite'
    });
    const [notificationRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM notifications
        WHERE order_id = (SELECT id FROM orders WHERE public_id = ? LIMIT 1)`,
      [orderId]
    );
    expect(Number(notificationRows[0].total)).toBe(0);

    catalog.records.get(product.id).stock_quantity = 0;
    const unavailableAccess = await issueGuestAccess(guest, csrfToken);
    const unavailable = await guest
      .post('/api/v1/guest-orders')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', unavailableAccess.idempotencyKey)
      .set('X-Guest-Order-Token', unavailableAccess.token)
      .send(body);
    expect(unavailable.status).toBe(409);
    expect(unavailable.body.error.code).toBe('CART_CHANGED');
    const unavailableRetry = await guest
      .post('/api/v1/guest-orders')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', unavailableAccess.idempotencyKey)
      .set('X-Guest-Order-Token', unavailableAccess.token)
      .send(body);
    expect(unavailableRetry.status).toBe(409);
    expect(unavailableRetry.body.error.code).toBe('CART_CHANGED');
  }, 60_000);

  it('expires and revokes guest bearer access without disclosing order PII', async () => {
    const product = uniqueProduct('guest-access-lifecycle', trackedProductIds, {
      price: '18.00',
      stock_quantity: null
    });
    const { app } = testApp([product]);
    const guest = request.agent(app);
    const csrfToken = await csrfFor(guest);
    const body = guestOrderPayload(product.id);

    const availabilityAccess = await issueGuestAccess(guest, csrfToken);
    const placed = await guest
      .post('/api/v1/guest-orders')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', availabilityAccess.idempotencyKey)
      .set('X-Guest-Order-Token', availabilityAccess.token)
      .send(body);
    expect(placed.status).toBe(201);
    trackedGuestOrderIds.add(placed.body.order.id);
    const [allocationRows] = await pool.execute(
      `SELECT a.inventory_policy, a.quantity,
              (SELECT COUNT(*) FROM catalog_inventory i
                WHERE i.product_ref_id = a.product_ref_id) AS finite_rows
         FROM order_inventory_allocations a
         JOIN order_items oi
           ON oi.order_id = a.order_id AND oi.product_ref_id = a.product_ref_id
        WHERE oi.external_product_id = ? AND oi.order_id = (
          SELECT id FROM orders WHERE public_id = ? LIMIT 1
        )`,
      [product.id, placed.body.order.id]
    );
    expect(allocationRows[0]).toMatchObject({
      inventory_policy: 'availability_only',
      quantity: 1,
      finite_rows: 0
    });

    const revoked = await guest
      .delete(`/api/v1/guest-orders/${placed.body.order.id}/access`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrfToken)
      .set('X-Guest-Order-Token', availabilityAccess.token);
    expect(revoked.status).toBe(204);
    const concealedRevoked = await guest
      .get(`/api/v1/guest-orders/${placed.body.order.id}`)
      .set('X-Guest-Order-Token', availabilityAccess.token);
    expect(concealedRevoked.status).toBe(404);
    expect(concealedRevoked.body.error).toEqual({
      code: 'ORDER_NOT_FOUND',
      message: 'The order was not found.'
    });
    expect(JSON.stringify(concealedRevoked.body)).not.toContain('guest-integration@example.test');
    const revokedReplay = await guest
      .post('/api/v1/guest-orders')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', availabilityAccess.idempotencyKey)
      .set('X-Guest-Order-Token', availabilityAccess.token)
      .send(body);
    expect(revokedReplay.status).toBe(404);
    expect(revokedReplay.body.error.code).toBe('ORDER_NOT_FOUND');

    const expiredCredential = await issueGuestAccess(guest, csrfToken);
    await pool.execute(
      `UPDATE guest_checkout_claims
          SET created_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 DAY),
              access_expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)
        WHERE access_digest = UNHEX(SHA2(?, 256))`,
      [expiredCredential.token]
    );
    const expiredCredentialAttempt = await guest
      .post('/api/v1/guest-orders')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', expiredCredential.idempotencyKey)
      .set('X-Guest-Order-Token', expiredCredential.token)
      .send(body);
    expect(expiredCredentialAttempt.status).toBe(400);
    expect(expiredCredentialAttempt.body.error.code).toBe('GUEST_CHECKOUT_ACCESS_INVALID');

    const expiringOrderAccess = await issueGuestAccess(guest, csrfToken);
    const expiringOrder = await guest
      .post('/api/v1/guest-orders')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', expiringOrderAccess.idempotencyKey)
      .set('X-Guest-Order-Token', expiringOrderAccess.token)
      .send(body);
    expect(expiringOrder.status).toBe(201);
    trackedGuestOrderIds.add(expiringOrder.body.order.id);
    await pool.execute(
      `UPDATE orders
          SET placed_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 DAY),
              guest_access_expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)
        WHERE public_id = ?`,
      [expiringOrder.body.order.id]
    );
    const concealedExpired = await guest
      .get(`/api/v1/guest-orders/${expiringOrder.body.order.id}`)
      .set('X-Guest-Order-Token', expiringOrderAccess.token);
    expect(concealedExpired.status).toBe(404);
    expect(concealedExpired.body.error).toEqual({
      code: 'ORDER_NOT_FOUND',
      message: 'The order was not found.'
    });
    expect(JSON.stringify(concealedExpired.body)).not.toContain('guest-integration@example.test');
  }, 60_000);

  it('serializes finite guest inventory so concurrent buyers cannot oversell it', async () => {
    const product = uniqueProduct('guest-inventory-race', trackedProductIds, {
      price: '25.00',
      stock_quantity: 3
    });
    const { app } = testApp([product]);
    const firstGuest = request.agent(app);
    const secondGuest = request.agent(app);
    const firstCsrf = await csrfFor(firstGuest);
    const secondCsrf = await csrfFor(secondGuest);
    const firstAccess = await issueGuestAccess(firstGuest, firstCsrf);
    const secondAccess = await issueGuestAccess(secondGuest, secondCsrf);
    const submit = (agent, csrfToken, access, suffix) => agent
      .post('/api/v1/guest-orders')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', access.idempotencyKey)
      .set('X-Guest-Order-Token', access.token)
      .send(guestOrderPayload(product.id, {
        quantity: 2,
        email: `inventory-${suffix}@example.test`,
        recipientName: `Inventory Guest ${suffix}`
      }));
    const responses = await Promise.all([
      submit(firstGuest, firstCsrf, firstAccess, 'one'),
      submit(secondGuest, secondCsrf, secondAccess, 'two')
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const winner = responses.find((response) => response.status === 201);
    const loser = responses.find((response) => response.status === 409);
    trackedGuestOrderIds.add(winner.body.order.id);
    expect(loser.body.error.code).toBe('CART_CHANGED');
    const [inventoryRows] = await pool.execute(
      `SELECT i.available_quantity,
              (SELECT COUNT(*) FROM order_inventory_allocations a
                WHERE a.product_ref_id = i.product_ref_id) AS allocations
         FROM catalog_inventory i
         JOIN catalog_product_refs r ON r.id = i.product_ref_id
        WHERE r.external_id = ?`,
      [product.id]
    );
    expect(inventoryRows[0]).toMatchObject({ available_quantity: 1, allocations: 1 });
  }, 60_000);

  it('uses one finite inventory ledger for authenticated and guest checkout races', async () => {
    const product = uniqueProduct('mixed-inventory-race', trackedProductIds, {
      price: '31.00',
      stock_quantity: 1
    });
    const { app } = testApp([product]);
    const shopper = request.agent(app);
    const account = await register(shopper, uniqueEmail('mixed-inventory', trackedEmails));
    const address = await shopper
      .post('/api/v1/me/addresses')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .send(addressPayload('Inventory race'));
    await shopper
      .post('/api/v1/cart/merge')
      .set('Origin', origin)
      .set('X-CSRF-Token', account.csrfToken)
      .set('Idempotency-Key', cartMergeKey())
      .send({ items: [{ productId: product.id, quantity: 1 }] });

    const guest = request.agent(app);
    const guestCsrf = await csrfFor(guest);
    const guestAccess = await issueGuestAccess(guest, guestCsrf);
    const [accountResponse, guestResponse] = await Promise.all([
      shopper
        .post('/api/v1/orders')
        .set('Origin', origin)
        .set('X-CSRF-Token', account.csrfToken)
        .set('Idempotency-Key', `mixed-auth-${randomUUID()}`)
        .send({ addressId: address.body.address.id, paymentMethod: 'cod' }),
      guest
        .post('/api/v1/guest-orders')
        .set('Origin', origin)
        .set('X-CSRF-Token', guestCsrf)
        .set('Idempotency-Key', guestAccess.idempotencyKey)
        .set('X-Guest-Order-Token', guestAccess.token)
        .send(guestOrderPayload(product.id))
    ]);
    expect([accountResponse.status, guestResponse.status].sort()).toEqual([201, 409]);
    if (guestResponse.status === 201) trackedGuestOrderIds.add(guestResponse.body.order.id);
    expect([accountResponse, guestResponse].find((response) => response.status === 409).body.error.code)
      .toBe('CART_CHANGED');
    const [ledgerRows] = await pool.execute(
      `SELECT i.available_quantity,
              (SELECT COUNT(*) FROM order_inventory_allocations a
                WHERE a.product_ref_id = i.product_ref_id) AS allocations
         FROM catalog_inventory i
         JOIN catalog_product_refs r ON r.id = i.product_ref_id
        WHERE r.external_id = ?`,
      [product.id]
    );
    expect(ledgerRows[0]).toMatchObject({ available_quantity: 0, allocations: 1 });
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
      .set('Idempotency-Key', cartMergeKey())
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

    const orderDetail = await shopper.get(`/api/v1/orders/${orderId}`);
    expect(orderDetail.status).toBe(200);
    const expectedReturnDeadline = new Date(
      Date.parse(orderDetail.body.order.deliveredAt) + 7 * 24 * 60 * 60 * 1000
    ).toISOString();
    expect(orderDetail.body.order).toMatchObject({
      returnEligible: true,
      returnDeadline: expectedReturnDeadline
    });

    const orderHistory = await shopper.get('/api/v1/orders?limit=20');
    expect(orderHistory.status).toBe(200);
    expect(orderHistory.body.orders.find((order) => order.id === orderId)).toMatchObject({
      returnEligible: true,
      returnDeadline: expectedReturnDeadline
    });

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

    const mineForProduct = await author
      .get(`/api/v1/me/reviews?product_id=${encodeURIComponent(product.id)}&page=1&limit=1`);
    expect(mineForProduct.status).toBe(200);
    expect(mineForProduct.body.reviews).toHaveLength(1);
    expect(mineForProduct.body.reviews[0]).toMatchObject({ id: reviewId, productId: product.id });

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
    const disabledStatus = await shopper.get(`/api/v1/me/low-stock-subscriptions/${product.id}`);
    expect(disabledStatus.body.subscription).toMatchObject({
      subscribed: true,
      notificationsEnabled: false
    });
    await evaluator.runNow();
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
