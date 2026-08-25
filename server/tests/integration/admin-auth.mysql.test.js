import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { runMigrations } from '../../src/db/migrate.js';
import { pool } from '../../src/db/pool.js';
import { hashPassword } from '../../src/security/passwords.js';
import { createMockCatalog, createMockMailer } from '../helpers/integration-fixtures.js';

const integrationEnabled = process.env.TEST_USE_DATABASE === 'true';
const databaseDescribe = integrationEnabled ? describe.sequential : describe.skip;
const adminEmail = `owner.${randomUUID().replaceAll('-', '')}@example.com`;
const adminPassword = `AM-admin-${randomBytes(24).toString('base64url')}`;

databaseDescribe('administrator authentication with MySQL', () => {
  beforeAll(async () => {
    if (!pool) throw new Error('TEST_USE_DATABASE=true did not create a database pool.');
    if (process.env.TEST_SKIP_MIGRATIONS !== 'true') {
      await runMigrations({ database: pool, log: { info() {}, error() {} } });
    }
    await pool.execute(
      `INSERT INTO admin_identities
        (public_id, email, email_normalized, display_name, password_hash, role, status)
       VALUES (?, ?, ?, 'Integration Owner', ?, 'owner', 'active')`,
      [randomUUID(), adminEmail, adminEmail, await hashPassword(adminPassword)]
    );
  }, 60_000);

  afterAll(async () => {
    try {
      await pool?.execute('DELETE FROM admin_identities WHERE email_normalized = ?', [adminEmail]);
    } finally {
      await pool?.end();
    }
  }, 60_000);

  it('keeps admin access separate, server-backed, CSRF-protected, and revocable', async () => {
    const app = createApp({
      database: pool,
      catalog: createMockCatalog([]),
      mailService: createMockMailer()
    });
    const administrator = request.agent(app);

    const deniedPage = await administrator.get('/admin/index.html');
    expect(deniedPage.status).toBe(302);
    expect(deniedPage.headers.location).toBe('/admin/login.html?next=index.html');

    const bootstrap = await administrator.get('/api/v1/admin/auth/session');
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body).toMatchObject({ authenticated: false });
    expect(bootstrap.body.csrfToken).toEqual(expect.any(String));

    const wrongPassword = await administrator
      .post('/api/v1/admin/auth/login')
      .set('Origin', config.appOrigin)
      .set('X-CSRF-Token', bootstrap.body.csrfToken)
      .send({ email: adminEmail, password: `${adminPassword}-wrong` });
    expect(wrongPassword.status).toBe(403);
    expect(wrongPassword.body.error?.code).toBe('INVALID_ADMIN_CREDENTIALS');

    const loggedIn = await administrator
      .post('/api/v1/admin/auth/login')
      .set('Origin', config.appOrigin)
      .set('X-CSRF-Token', bootstrap.body.csrfToken)
      .send({ email: `  ${adminEmail.toUpperCase()}  `, password: adminPassword });
    expect(loggedIn.status).toBe(200);
    expect(loggedIn.body).toMatchObject({
      authenticated: true,
      admin: { email: adminEmail, displayName: 'Integration Owner', role: 'owner' }
    });
    expect(loggedIn.body.csrfToken).toEqual(expect.any(String));
    const sessionCookie = (loggedIn.headers['set-cookie'] || [])
      .find((cookie) => cookie.startsWith('am_admin_session='));
    expect(sessionCookie).toMatch(/;\s*HttpOnly(?:;|$)/i);
    expect(sessionCookie).toMatch(/;\s*SameSite=Strict(?:;|$)/i);

    const allowedPage = await administrator.get('/admin/index.html');
    expect(allowedPage.status).toBe(200);
    const identity = await administrator.get('/api/v1/admin/auth/me');
    expect(identity.status).toBe(200);
    expect(identity.body.admin.email).toBe(adminEmail);

    const loggedOut = await administrator
      .post('/api/v1/admin/auth/logout')
      .set('Origin', config.appOrigin)
      .set('X-CSRF-Token', loggedIn.body.csrfToken);
    expect(loggedOut.status).toBe(200);
    expect(loggedOut.body.authenticated).toBe(false);
    expect((await administrator.get('/admin/index.html')).status).toBe(302);
  }, 60_000);
});
