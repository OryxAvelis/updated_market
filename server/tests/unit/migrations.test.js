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
      '0005_cart_merge_idempotency.sql',
      '0006_guest_orders.sql',
      '0007_guest_checkout_hardening.sql',
      '0008_inventory_allocation_policy.sql',
      '0009_local_demo_safety.sql',
      '0010_admin_auth.sql',
      '0011_customer_consistency_backfill.sql',
      '0012_supported_payment_preferences.sql',
      '0013_admin_tracking_source.sql'
    ]);
    expect(migrations.map((migration) => migration.statements.length)).toEqual([25, 1, 2, 1, 1, 1, 8, 1, 2, 2, 2, 2, 1]);
    for (const migration of migrations) {
      expect(migration.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(migration.statements.every((statement) => (statement.match(/;/g) || []).length === 1)).toBe(true);
    }
  });

  it('tightens only saved payment preferences after the consistency backfill', async () => {
    const migrations = await loadMigrations();
    const migration = migrations.find((entry) => entry.name === '0012_supported_payment_preferences.sql');

    expect(migration.name).toBe('0012_supported_payment_preferences.sql');
    expect(migration.statements[0]).toMatch(
      /UPDATE\s+user_preferences[\s\S]+SET\s+default_payment\s*=\s*'cod'[\s\S]+WHERE\s+default_payment\s*=\s*'card'/i
    );
    expect(migration.statements[1]).toMatch(
      /ALTER\s+TABLE\s+user_preferences[\s\S]+DROP\s+CHECK\s+chk_user_preferences_payment[\s\S]+ADD\s+CONSTRAINT\s+chk_user_preferences_payment[\s\S]+default_payment\s+IN\s*\(\s*'cod'\s*,\s*'wafacash'\s*,\s*'cashplus'\s*\)/i
    );
    expect(migration.statements.join('\n')).not.toMatch(
      /(?:ALTER\s+TABLE|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+orders\b|chk_orders_payment_method/i
    );
  });

  it('adds an explicit administrator source to order tracking events', async () => {
    const migrations = await loadMigrations();
    const migration = migrations.find((entry) => entry.name === '0013_admin_tracking_source.sql');

    expect(migration.statements).toHaveLength(1);
    expect(migration.statements[0]).toMatch(
      /ALTER\s+TABLE\s+order_tracking_events[\s\S]+DROP\s+CHECK\s+chk_order_tracking_events_source[\s\S]+ADD\s+CONSTRAINT\s+chk_order_tracking_events_source[\s\S]+source\s+IN\s*\([\s\S]*'admin'[\s\S]*\)/i
    );
  });
});

describe('migration execution safety', () => {
  it('serializes, records checksums, and becomes a no-op on rerun', async () => {
    const fake = fakeDatabase();
    const first = await runMigrations({ database: fake.database, log: silentLog });
    const second = await runMigrations({ database: fake.database, log: silentLog });

    expect(first).toEqual({ applied: 13, total: 13 });
    expect(second).toEqual({ applied: 0, total: 13 });
    expect(fake.applied.size).toBe(13);
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
