import { describe, expect, it, vi } from 'vitest';
import {
  assertLocalDevelopmentDatabase,
  provisionLocalDemoUser
} from '../../src/auth/local-demo.js';
import { loadSession } from '../../src/auth/session.js';
import { config } from '../../src/config.js';

const demoEmail = 'demo@local.am-market.test';

function provisioningDatabase({ environmentKind = 'local_development', marked = [], existing = [] } = {}) {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push({ operation: 'begin' }); },
    async commit() { calls.push({ operation: 'commit' }); },
    async rollback() { calls.push({ operation: 'rollback' }); },
    release() { calls.push({ operation: 'release' }); },
    async execute(sql, values = []) {
      calls.push({ operation: 'execute', sql, values });
      if (sql.includes('FROM application_environment')) {
        return [[...(environmentKind ? [{ environment_kind: environmentKind }] : [])], []];
      }
      if (sql.includes('FROM local_demo_accounts demo') && sql.includes('FOR UPDATE')) return [marked, []];
      if (sql.includes('WHERE u.email_normalized = ?')) return [existing, []];
      if (sql.includes('INSERT INTO users')) return [{ insertId: 91, affectedRows: 1 }, []];
      return [{ affectedRows: 1 }, []];
    }
  };
  return {
    calls,
    database: { async getConnection() { return connection; } }
  };
}

describe('local demo database and identity safety', () => {
  it('requires a database-level local-development attestation and a marked active demo account', async () => {
    const unattested = {
      async execute() { return [[], []]; }
    };
    await expect(assertLocalDevelopmentDatabase(unattested, { demoEmail }))
      .rejects.toThrow('not attested for local development');

    const queries = [];
    const attested = {
      async execute(sql, values = []) {
        queries.push({ sql, values });
        if (sql.includes('application_environment')) {
          return [[{ environment_kind: 'local_development' }], []];
        }
        return [[{ id: 41 }], []];
      }
    };
    await expect(assertLocalDevelopmentDatabase(attested, { demoEmail })).resolves.toBe(true);
    expect(queries[1].sql).toContain('FROM local_demo_accounts demo');
    expect(queries[1].values).toEqual([demoEmail]);
  });

  it('fails on a reserved-email collision without modifying the customer', async () => {
    const fixture = provisioningDatabase({
      existing: [{ id: 7, public_id: 'customer-id', demo_user_id: null }]
    });

    await expect(provisionLocalDemoUser(fixture.database, demoEmail))
      .rejects.toThrow('Refusing to replace an existing customer');

    expect(fixture.calls.some((call) => call.operation === 'rollback')).toBe(true);
    expect(fixture.calls.some((call) => /UPDATE users/i.test(call.sql || ''))).toBe(false);
    expect(fixture.calls.some((call) => /INSERT INTO users/i.test(call.sql || ''))).toBe(false);
  });

  it('creates only a marked demo identity and revokes old sessions and reset tokens', async () => {
    const fixture = provisioningDatabase();
    const result = await provisionLocalDemoUser(fixture.database, demoEmail);

    expect(result).toMatchObject({ id: 91, email: demoEmail });
    const statements = fixture.calls.map((call) => call.sql || '');
    expect(statements.some((sql) => /INSERT INTO local_demo_accounts[\s\S]*singleton_id[\s\S]*user_id/i.test(sql))).toBe(true);
    expect(statements.some((sql) => /UPDATE auth_sessions[\s\S]*demo_reprovisioned/i.test(sql))).toBe(true);
    expect(statements.some((sql) => /UPDATE password_reset_tokens[\s\S]*revoked_at/i.test(sql))).toBe(true);
    expect(fixture.calls.some((call) => call.operation === 'commit')).toBe(true);
  });

  it('refuses a different marked demo identity', async () => {
    const fixture = provisioningDatabase({
      marked: [{ id: 1, public_id: 'marked-id', email_normalized: 'other@local.am-market.test' }]
    });
    await expect(provisionLocalDemoUser(fixture.database, demoEmail))
      .rejects.toThrow('does not match the configured demo email');
    expect(fixture.calls.some((call) => call.operation === 'rollback')).toBe(true);
  });

  it('revokes a marked demo session whenever demo mode is disabled', async () => {
    expect(config.auth.localDevLoginEnabled).toBe(false);
    const queries = [];
    const database = {
      async execute(sql, values = []) {
        queries.push({ sql, values });
        if (/^\s*SELECT/i.test(sql)) {
          return [[{
            session_id: 8,
            account_kind: 'local_demo',
            environment_kind: 'local_development'
          }], []];
        }
        return [{ affectedRows: 1 }, []];
      }
    };
    const req = {
      cookies: { [config.auth.cookieName]: 'raw-demo-session-token' },
      app: { locals: { db: database } }
    };
    const res = { clearCookie: vi.fn() };
    const next = vi.fn();

    await loadSession(req, res, next);

    expect(req.auth).toBeNull();
    expect(res.clearCookie).toHaveBeenCalledOnce();
    expect(queries[1].values).toEqual(['demo_disabled', 8]);
    expect(next).toHaveBeenCalledWith();
  });
});
