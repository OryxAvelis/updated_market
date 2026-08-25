import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';

const serverRoot = fileURLToPath(new URL('../../', import.meta.url));
const projectRoot = path.resolve(serverRoot, '..');

function emptyDatabase() {
  return {
    async execute() {
      throw new Error('A customer cookie must never trigger an administrator-session lookup.');
    }
  };
}

function developmentEnvironment() {
  const environment = {
    ...process.env,
    NODE_ENV: 'development',
    LOG_LEVEL: 'silent',
    HOST: '127.0.0.1',
    APP_ORIGIN: 'https://localhost:3443',
    ALLOWED_ORIGINS: 'https://localhost:3443',
    PASSWORD_RESET_URL: 'https://localhost:3443/reset-password.html',
    DB_HOST: '127.0.0.1',
    DB_TLS: 'true',
    TRUST_PROXY: '0',
    TLS_TERMINATED_BY_PROXY: 'false',
    LOCAL_DEV_LOGIN: 'false',
    LOCAL_DEV_LOGIN_USER_EMAIL: ''
  };
  delete environment.ENV_FILE;
  return environment;
}

describe('administrator authentication boundary', () => {
  it('denies protected admin HTML and API routes before authentication', async () => {
    const app = createApp({ database: emptyDatabase() });
    const page = await request(app).get('/admin/orders.html');
    const api = await request(app).get('/api/v1/admin/auth/me');

    expect(page.status).toBe(302);
    expect(page.headers.location).toBe('/admin/login.html?next=orders.html');
    expect(api.status).toBe(401);
    expect(api.body.error?.code).toBe('AUTH_REQUIRED');
  });

  it('does not treat a customer session cookie as administrator authorization', async () => {
    const app = createApp({ database: emptyDatabase() });
    const page = await request(app)
      .get('/admin/index.html')
      .set('Cookie', 'am_session=customer-session-token');
    const api = await request(app)
      .get('/api/v1/admin/auth/me')
      .set('Cookie', 'am_session=customer-session-token');

    expect(page.status).toBe(302);
    expect(api.status).toBe(401);
  });

  it('sets a separate secure HTTP-only Strict cookie after valid administrator credentials', () => {
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', `
      const [{ createApp }, { config }, { hashPassword }, { randomBytes }, { default: request }] = await Promise.all([
        import('./src/app.js'), import('./src/config.js'),
        import('./src/security/passwords.js'), import('node:crypto'), import('supertest')
      ]);
      const password = randomBytes(24).toString('base64url');
      const passwordHash = await hashPassword(password);
      const identity = {
        id: 17,
        public_id: '00000000-0000-4000-8000-000000000017',
        email: 'owner@example.com',
        email_normalized: 'owner@example.com',
        display_name: 'Store Owner',
        password_hash: passwordHash,
        role: 'owner',
        status: 'active',
        failed_login_count: 0,
        locked_until: null
      };
      const connection = {
        async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
        async execute() { return [{ affectedRows: 1 }, []]; }
      };
      const database = {
        async execute(sql) {
          if (sql.includes('FROM admin_identities')) return [[identity], []];
          return [{ affectedRows: 1 }, []];
        },
        async getConnection() { return connection; }
      };
      const app = createApp({ database });
      const bootstrap = await request(app).get('/api/v1/admin/auth/session');
      const response = await request(app)
        .post('/api/v1/admin/auth/login')
        .set('Origin', config.appOrigin)
        .set('Cookie', '__Host-am_admin_csrf=' + bootstrap.body.csrfToken)
        .set('X-CSRF-Token', bootstrap.body.csrfToken)
        .send({ email: identity.email, password });
      console.log(JSON.stringify({ status: response.status, cookies: response.headers['set-cookie'] || [] }));
    `], {
      cwd: serverRoot,
      env: developmentEnvironment(),
      encoding: 'utf8'
    }).trim();
    const result = JSON.parse(output);
    const sessionCookie = result.cookies.find((cookie) => cookie.startsWith('__Host-am_admin_session='));
    const csrfCookie = result.cookies.find((cookie) => cookie.startsWith('__Host-am_admin_csrf='));

    expect(result.status).toBe(200);
    expect(sessionCookie).toMatch(/;\s*Path=\/(?:;|$)/i);
    expect(sessionCookie).toMatch(/;\s*HttpOnly(?:;|$)/i);
    expect(sessionCookie).toMatch(/;\s*Secure(?:;|$)/i);
    expect(sessionCookie).toMatch(/;\s*SameSite=Strict(?:;|$)/i);
    expect(csrfCookie).toMatch(/;\s*Secure(?:;|$)/i);
    expect(csrfCookie).toMatch(/;\s*SameSite=Strict(?:;|$)/i);
    expect(csrfCookie).not.toMatch(/;\s*HttpOnly(?:;|$)/i);
  });

  it('contains no public credential literal or Web Storage authentication', async () => {
    const authSource = await readFile(path.join(projectRoot, 'admin', 'js', 'admin-auth.js'), 'utf8');
    expect(authSource).not.toMatch(/DEMO_(?:EMAIL|PASSWORD)|localStorage|sessionStorage/);
    expect(authSource).not.toMatch(/\b(?:const|let|var)\s+\w*password\w*\s*=/i);
    expect(authSource).toContain('/api/v1/admin/auth');
  });
});
