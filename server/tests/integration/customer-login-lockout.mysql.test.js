import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { runMigrations } from '../../src/db/migrate.js';
import { pool } from '../../src/db/pool.js';
import {
  cleanupIntegrationData,
  createMockCatalog,
  createMockMailer,
  uniqueEmail
} from '../helpers/integration-fixtures.js';

const integrationEnabled = process.env.TEST_USE_DATABASE === 'true';
const databaseDescribe = integrationEnabled ? describe.sequential : describe.skip;
const trackedEmails = new Set();
const origin = config.appOrigin;
const password = `AM-lockout-${randomUUID()}`;
const changedPassword = `AM-lockout-changed-${randomUUID()}`;

databaseDescribe('customer login lockout with MySQL', () => {
  beforeAll(async () => {
    if (!pool) throw new Error('TEST_USE_DATABASE=true did not create a database pool.');
    if (process.env.TEST_SKIP_MIGRATIONS !== 'true') {
      await runMigrations({ database: pool, log: { info() {}, error() {} } });
    }
  }, 60_000);

  afterAll(async () => {
    try {
      await cleanupIntegrationData(pool, trackedEmails, new Set());
    } finally {
      await pool?.end();
    }
  }, 60_000);

  it('locks after five failures, stays generic, and resets counters after an allowed login', async () => {
    const email = uniqueEmail('login-lockout', trackedEmails);
    const app = createApp({
      database: pool,
      catalog: createMockCatalog([]),
      mailService: createMockMailer()
    });
    const customer = request.agent(app);
    const bootstrap = await customer.get('/api/v1/auth/session');

    const registration = await customer
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .set('X-CSRF-Token', bootstrap.body.csrfToken)
      .send({ displayName: 'Lockout Customer', email, password, language: 'en' });
    expect(registration.status).toBe(201);

    const logout = await customer
      .post('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('X-CSRF-Token', registration.body.csrfToken)
      .send({});
    expect(logout.status).toBe(200);

    const cleanLogin = await customer
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', logout.body.csrfToken)
      .send({ email, password });
    expect(cleanLogin.status).toBe(200);
    const secondLogout = await customer
      .post('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('X-CSRF-Token', cleanLogin.body.csrfToken)
      .send({});
    expect(secondLogout.status).toBe(200);

    let genericError;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await customer
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .set('X-CSRF-Token', secondLogout.body.csrfToken)
        .send({ email, password: `${password}-wrong` });
      expect(response.status).toBe(403);
      expect(response.body.error).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'The email or password is incorrect.'
      });
      genericError ||= response.body.error;
      const [[attemptState]] = await pool.execute(
        'SELECT failed_login_count FROM users WHERE email_normalized = ? LIMIT 1',
        [email]
      );
      expect(attemptState.failed_login_count).toBe(attempt);
    }

    const [[locked]] = await pool.execute(
      `SELECT failed_login_count, locked_until,
              DATE_FORMAT(locked_until, '%Y-%m-%d %H:%i:%s.%f') AS lock_value,
              TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), locked_until) AS lock_remaining_microseconds
         FROM users
        WHERE email_normalized = ?
        LIMIT 1`,
      [email]
    );
    expect(locked.failed_login_count).toBe(5);
    expect(locked.locked_until).not.toBeNull();
    expect(Number(locked.lock_remaining_microseconds)).toBeGreaterThan(0);

    const correctButLocked = await customer
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', secondLogout.body.csrfToken)
      .send({ email, password });
    expect(correctButLocked.status).toBe(403);
    expect(correctButLocked.body.error).toEqual(genericError);
    const [[stillLocked]] = await pool.execute(
      `SELECT failed_login_count,
              DATE_FORMAT(locked_until, '%Y-%m-%d %H:%i:%s.%f') AS lock_value
         FROM users WHERE email_normalized = ? LIMIT 1`,
      [email]
    );
    expect(stillLocked.failed_login_count).toBe(5);
    expect(stillLocked.lock_value).toBe(locked.lock_value);

    await pool.execute(
      'UPDATE users SET locked_until = TIMESTAMPADD(SECOND, -1, UTC_TIMESTAMP(3)) WHERE email_normalized = ?',
      [email]
    );

    const wrongAfterExpiry = await customer
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', secondLogout.body.csrfToken)
      .send({ email, password: `${password}-still-wrong` });
    expect(wrongAfterExpiry.status).toBe(403);
    expect(wrongAfterExpiry.body.error).toEqual(genericError);

    const [[freshFailureWindow]] = await pool.execute(
      'SELECT failed_login_count, locked_until FROM users WHERE email_normalized = ? LIMIT 1',
      [email]
    );
    expect(freshFailureWindow.failed_login_count).toBe(1);
    expect(freshFailureWindow.locked_until).toBeNull();

    const allowed = await customer
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', secondLogout.body.csrfToken)
      .send({ email, password });
    expect(allowed.status).toBe(200);
    expect(allowed.body.user.email).toBe(email);

    const [[reset]] = await pool.execute(
      'SELECT failed_login_count, locked_until FROM users WHERE email_normalized = ? LIMIT 1',
      [email]
    );
    expect(reset.failed_login_count).toBe(0);
    expect(reset.locked_until).toBeNull();
  }, 60_000);

  it('lets a valid existing session change a locked account password and clears the lock atomically', async () => {
    const email = uniqueEmail('session-password-change-lockout', trackedEmails);
    const app = createApp({
      database: pool,
      catalog: createMockCatalog([]),
      mailService: createMockMailer()
    });
    const existingSession = request.agent(app);
    const bootstrap = await existingSession.get('/api/v1/auth/session');
    const registration = await existingSession
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .set('X-CSRF-Token', bootstrap.body.csrfToken)
      .send({ displayName: 'Locked Session Customer', email, password, language: 'en' });
    expect(registration.status).toBe(201);

    await pool.execute(
      `UPDATE users
          SET failed_login_count = 5,
              locked_until = TIMESTAMPADD(MINUTE, 15, UTC_TIMESTAMP(3))
        WHERE email_normalized = ?`,
      [email]
    );

    const lockedLoginClient = request.agent(app);
    const lockedBootstrap = await lockedLoginClient.get('/api/v1/auth/session');
    const lockedLogin = await lockedLoginClient
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', lockedBootstrap.body.csrfToken)
      .send({ email, password });
    expect(lockedLogin.status).toBe(403);
    expect(lockedLogin.body.error.code).toBe('INVALID_CREDENTIALS');

    const changed = await existingSession
      .post('/api/v1/auth/password/change')
      .set('Origin', origin)
      .set('X-CSRF-Token', registration.body.csrfToken)
      .send({ currentPassword: password, newPassword: changedPassword });
    expect(changed.status).toBe(200);

    const [[unlocked]] = await pool.execute(
      'SELECT failed_login_count, locked_until FROM users WHERE email_normalized = ? LIMIT 1',
      [email]
    );
    expect(unlocked.failed_login_count).toBe(0);
    expect(unlocked.locked_until).toBeNull();

    const freshClient = request.agent(app);
    const freshBootstrap = await freshClient.get('/api/v1/auth/session');
    const freshLogin = await freshClient
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', freshBootstrap.body.csrfToken)
      .send({ email, password: changedPassword });
    expect(freshLogin.status).toBe(200);
    expect(freshLogin.body.user.email).toBe(email);
  }, 60_000);
});
