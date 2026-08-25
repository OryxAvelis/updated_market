import { describe, expect, it } from 'vitest';
import { MySqlRateLimitStore } from '../../src/security/mysql-rate-limit-store.js';

function database({ failSelect = false } = {}) {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push({ kind: 'begin' }); },
    async execute(sql, values = []) {
      calls.push({ kind: 'execute', sql, values });
      if (failSelect && sql.includes('SELECT hits')) throw new Error('rate store unavailable');
      if (sql.includes('SELECT hits')) return [[]];
      return [{ affectedRows: 1 }];
    },
    async commit() { calls.push({ kind: 'commit' }); },
    async rollback() { calls.push({ kind: 'rollback' }); },
    release() { calls.push({ kind: 'release' }); }
  };
  return {
    calls,
    async getConnection() { return connection; },
    async execute(sql, values = []) {
      calls.push({ kind: 'pool-execute', sql, values });
      return [{ affectedRows: 1 }];
    }
  };
}

describe('shared MySQL rate-limit store', () => {
  it('hashes client keys before storing a shared counter', async () => {
    const pool = database();
    const store = new MySqlRateLimitStore(pool, { scope: 'guest-checkout', windowMs: 60_000 });
    const result = await store.increment('203.0.113.10');

    expect(result.totalHits).toBe(1);
    expect(result.resetTime).toBeInstanceOf(Date);
    const select = pool.calls.find((call) => call.sql?.includes('SELECT hits'));
    expect(select.values[0]).toBe('guest-checkout');
    expect(select.values[1]).toBeInstanceOf(Buffer);
    expect(select.values[1]).toHaveLength(32);
    expect(select.values).not.toContain('203.0.113.10');
    expect(pool.calls.map((call) => call.kind)).toContain('commit');
    expect(pool.calls.map((call) => call.kind)).toContain('release');
  });

  it('fails closed by propagating storage errors after rollback', async () => {
    const pool = database({ failSelect: true });
    const store = new MySqlRateLimitStore(pool, { scope: 'guest-lookup', windowMs: 60_000 });

    await expect(store.increment('198.51.100.7')).rejects.toThrow('rate store unavailable');
    expect(pool.calls.map((call) => call.kind)).toContain('rollback');
    expect(pool.calls.map((call) => call.kind)).toContain('release');
    expect(pool.calls.map((call) => call.kind)).not.toContain('commit');
  });
});
