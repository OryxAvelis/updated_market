import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { createResendMailService } from '../../src/email/mailer.js';

describe('password-reset delivery failure', () => {
  it('revokes the issued digest when the HTTPS provider rejects delivery', async () => {
    const user = {
      id: 71,
      public_id: '00000000-0000-4000-8000-000000000071',
      email: 'reset-customer@example.com',
      email_normalized: 'reset-customer@example.com',
      display_name: 'Reset Customer',
      phone_e164: null,
      password_hash: 'unused',
      account_kind: 'customer',
      status: 'active',
      email_verified_at: null
    };
    let insertedResetId;
    let resolveRevocation;
    const revoked = new Promise((resolve) => { resolveRevocation = resolve; });
    const connection = {
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
      release() {},
      async execute(sql, params = []) {
        if (sql.includes('FROM users u') && sql.includes('FOR UPDATE')) {
          return [[{ id: user.id, email: user.email, display_name: user.display_name }], []];
        }
        if (sql.includes('UPDATE password_reset_tokens')) return [{ affectedRows: 1 }, []];
        if (sql.includes('INSERT INTO password_reset_tokens')) {
          insertedResetId = params[0];
          expect(params[2]).toBeInstanceOf(Buffer);
          return [{ affectedRows: 1 }, []];
        }
        throw new Error(`Unexpected transaction query: ${sql}`);
      }
    };
    const database = {
      async getConnection() {
        return connection;
      },
      async execute(sql, params = []) {
        if (sql.includes('FROM users u') && sql.includes('LEFT JOIN local_demo_accounts')) {
          return [[user], []];
        }
        if (sql.includes('UPDATE password_reset_tokens') && sql.includes('WHERE public_id = ?')) {
          resolveRevocation(params[0]);
          return [{ affectedRows: 1 }, []];
        }
        throw new Error(`Unexpected pool query: ${sql}`);
      }
    };
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 503 }));
    const mailService = createResendMailService({
      apiKey: 're_unit_test_key_1234567890',
      from: 'AM MARKET <reset@market.example>',
      resetUrl: 'https://market.example/reset-password.html',
      timeoutMs: 1000,
      fetchImpl
    });
    const client = request.agent(createApp({ database, mailService }));
    const bootstrap = await client.get('/api/v1/auth/session');
    const response = await client
      .post('/api/v1/auth/password-reset/request')
      .set('Origin', config.appOrigin)
      .set('X-CSRF-Token', bootstrap.body.csrfToken)
      .send({ email: user.email });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ message: 'If an account exists, a reset link will be sent shortly.' });
    const revokedResetId = await Promise.race([
      revoked,
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Reset token was not revoked.')), 1000))
    ]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(revokedResetId).toBe(insertedResetId);
  });
});
