import { describe, expect, it, vi } from 'vitest';
import { assertCurrentSchema } from '../../src/db/schema-health.js';

const expected = [
  { name: '0001_initial.sql', checksum: 'a'.repeat(64) },
  { name: '0002_feature.sql', checksum: 'b'.repeat(64) }
];

function connection(rows) {
  return {
    query: vi.fn(async () => [rows])
  };
}

describe('database schema readiness', () => {
  it('accepts an exact ordered migration ledger', async () => {
    const database = connection(expected);

    await expect(assertCurrentSchema(database, expected)).resolves.toEqual({
      appliedCount: 2,
      latestMigration: '0002_feature.sql'
    });
    expect(database.query).toHaveBeenCalledWith(
      'SELECT name, checksum FROM schema_migrations ORDER BY name'
    );
  });

  it('accepts a checksum-matching expected prefix followed by newer migrations', async () => {
    const database = connection([
      ...expected,
      { name: '0003_newer_feature.sql', checksum: 'c'.repeat(64) }
    ]);

    await expect(assertCurrentSchema(database, expected)).resolves.toEqual({
      appliedCount: 3,
      latestMigration: '0002_feature.sql'
    });
  });

  it('fails closed when a deployment has a pending migration', async () => {
    const database = connection(expected.slice(0, 1));

    await expect(assertCurrentSchema(database, expected))
      .rejects.toThrow('expected at least 2 applied migration(s), found 1');
  });

  it('fails closed when a newer-looking row replaces an expected prefix entry', async () => {
    const database = connection([
      expected[0],
      { name: '0003_newer_feature.sql', checksum: 'c'.repeat(64) }
    ]);

    await expect(assertCurrentSchema(database, expected))
      .rejects.toThrow('migration mismatch at 0002_feature.sql');
  });

  it('fails closed when a trailing ledger row is not a well-formed newer migration', async () => {
    const database = connection([
      ...expected,
      { name: '0003_newer_feature.sql', checksum: 'not-a-checksum' }
    ]);

    await expect(assertCurrentSchema(database, expected))
      .rejects.toThrow('invalid trailing migration 0003_newer_feature.sql');
  });

  it('fails closed when an applied checksum or migration order differs', async () => {
    const database = connection([
      expected[0],
      { name: expected[1].name, checksum: 'c'.repeat(64) }
    ]);

    await expect(assertCurrentSchema(database, expected))
      .rejects.toThrow('migration mismatch at 0002_feature.sql');
  });
});
