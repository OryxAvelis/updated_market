import { describe, expect, it } from 'vitest';
import {
  loadMigrations,
  migrationChecksum,
  normalizeMigrationSource,
  runMigrations,
  splitMigrationStatements
} from '../../src/db/migrate.js';

function fakeDatabase(appliedRows = []) {
  const applied = new Map(appliedRows.map((row) => [row.name, row.checksum]));
  const calls = [];
  const connection = {
    async query(sql) {
      calls.push({ kind: 'query', sql });
      if (sql.includes('SELECT DATABASE()')) return [[{ databaseName: 'am_market_unit_test' }]];
      if (sql.includes('SELECT name, checksum FROM schema_migrations')) {
        return [[...applied].map(([name, checksum]) => ({ name, checksum }))];
      }
      return [[], []];
    },
    async execute(sql, values = []) {
      calls.push({ kind: 'execute', sql, values });
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
      if (sql.includes('INSERT INTO schema_migrations')) {
        applied.set(values[0], values[1]);
        return [{ affectedRows: 1 }];
      }
      return [[], []];
    },
    release() {
      calls.push({ kind: 'release' });
    }
  };
  return {
    applied,
    calls,
    database: { async getConnection() { return connection; } }
  };
}

const silentLog = { info() {}, error() {} };

describe('migration source safety', () => {
  it('normalizes BOM and line endings before checksumming', () => {
    const windows = '\uFEFFCREATE TABLE sample (id INT);\r\n';
    const unix = 'CREATE TABLE sample (id INT);\n';

    expect(normalizeMigrationSource(windows)).toBe(unix);
    expect(migrationChecksum(windows)).toBe(migrationChecksum(unix));
    expect(migrationChecksum(`${unix}-- changed\n`)).not.toBe(migrationChecksum(unix));
  });

  it('splits only on an explicit statement boundary', () => {
    const statements = splitMigrationStatements(`
      -- a regular comment; semicolons here are not separators
      CREATE TABLE one (id INT);
      -- statement-breakpoint
      INSERT INTO one (id) VALUES (1);
    `, 'sample.sql');

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('CREATE TABLE one');
    expect(statements[1]).toContain('INSERT INTO one');
  });

  it.each([
    ['DELIMITER //\nCREATE PROCEDURE unsafe() SELECT 1//', 'DELIMITER'],
    ["SET GLOBAL sql_mode = ''", 'global MySQL state']
  ])('rejects unsafe migration source containing %s', (source, message) => {
    expect(() => splitMigrationStatements(source, 'unsafe.sql')).toThrow(message);
  });

  it('loads ordered immutable migrations as individually executed statements', async () => {
    const migrations = await loadMigrations();

    expect(migrations.map((migration) => migration.name)).toEqual([
      '0001_initial_user_schema.sql',
      '0002_fulfillment_webhook_events.sql',
      '0003_low_stock_transition_state.sql',
      '0004_return_idempotency.sql',
      '0005_cart_merge_idempotency.sql'
    ]);
    expect(migrations.map((migration) => migration.statements.length)).toEqual([25, 1, 2, 1, 1]);
    for (const migration of migrations) {
      expect(migration.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(migration.statements.every((statement) => (statement.match(/;/g) || []).length === 1)).toBe(true);
    }
  });
});

describe('migration execution safety', () => {
  it('serializes, records checksums, and becomes a no-op on rerun', async () => {
    const fake = fakeDatabase();
    const first = await runMigrations({ database: fake.database, log: silentLog });
    const second = await runMigrations({ database: fake.database, log: silentLog });

    expect(first).toEqual({ applied: 5, total: 5 });
    expect(second).toEqual({ applied: 0, total: 5 });
    expect(fake.applied.size).toBe(5);
    expect(fake.calls.filter((call) => call.sql?.includes('GET_LOCK'))).toHaveLength(2);
    expect(fake.calls.filter((call) => call.sql?.includes('RELEASE_LOCK'))).toHaveLength(2);
    expect(fake.calls.some((call) => /multipleStatements/i.test(call.sql || ''))).toBe(false);
  });

  it('rejects a checksum mismatch before executing schema statements', async () => {
    const [migration] = await loadMigrations();
    const fake = fakeDatabase([{ name: migration.name, checksum: '0'.repeat(64) }]);

    await expect(runMigrations({ database: fake.database, log: silentLog }))
      .rejects.toThrow(`Checksum mismatch for applied migration ${migration.name}`);
    expect(fake.calls.filter((call) => call.kind === 'release')).toHaveLength(1);
  });
});
