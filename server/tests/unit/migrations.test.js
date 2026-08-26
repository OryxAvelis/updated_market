import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isRecoverableStartedStatementError,
  loadMigrations,
  migrationChecksum,
  normalizeMigrationSource,
  runMigrations,
  splitMigrationStatements
} from '../../src/db/migrate.js';

const guestClaimBackfillChecksum =
  '54dfc82bc0561c64401e5000030b9a94c3c9554ff0bf8e97cffb479a81bdb0ca';

function fakeDatabase(appliedRows = [], { progressRows = [], statementError = null } = {}) {
  const applied = new Map(appliedRows.map((row) => [row.name, row.checksum]));
  const progress = new Map(progressRows.map((row) => [
    `${row.migrationName}\u0000${row.statementNumber}`,
    { ...row }
  ]));
  const calls = [];
  const connection = {
    async query(sql) {
      calls.push({ kind: 'query', sql });
      if (sql.includes('SELECT DATABASE()')) return [[{ databaseName: 'am_market_unit_test' }]];
      if (sql.includes('SELECT name, checksum FROM schema_migrations')) {
        return [[...applied].map(([name, checksum]) => ({ name, checksum }))];
      }
      if (sql.includes('FROM schema_migration_statements')) {
        return [[...progress.values()].map((row) => ({ ...row }))];
      }
      if (statementError) await statementError(sql);
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
      if (sql.includes('INSERT INTO schema_migration_statements')) {
        progress.set(`${values[0]}\u0000${values[2]}`, {
          migrationName: values[0],
          migrationChecksum: values[1],
          statementNumber: values[2],
          statementChecksum: values[3],
          state: 'started'
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('UPDATE schema_migration_statements')) {
        const key = `${values[0]}\u0000${values[2]}`;
        const row = progress.get(key);
        if (
          row
          && row.migrationChecksum === values[1]
          && row.statementChecksum === values[3]
          && row.state === 'started'
        ) {
          row.state = 'completed';
          return [{ affectedRows: 1 }];
        }
        return [{ affectedRows: 0 }];
      }
      if (sql.includes('DELETE FROM schema_migration_statements')) {
        const key = `${values[0]}\u0000${values[2]}`;
        const row = progress.get(key);
        const matches = row
          && row.migrationChecksum === values[1]
          && row.statementChecksum === values[3]
          && row.state === 'started';
        if (matches) progress.delete(key);
        return [{ affectedRows: matches ? 1 : 0 }];
      }
      return [[], []];
    },
    release() {
      calls.push({ kind: 'release' });
    }
  };
  return {
    applied,
    progress,
    calls,
    database: { async getConnection() { return connection; } }
  };
}

async function withTemporaryMigration(source, callback) {
  const directory = await mkdtemp(path.join(tmpdir(), 'am-market-migration-unit-'));
  try {
    await writeFile(path.join(directory, '0001_recovery_test.sql'), source, 'utf8');
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

  it('recovers duplicate data only for the exact interrupted guest-claim backfill', () => {
    const duplicate = Object.assign(new Error('Duplicate entry'), {
      code: 'ER_DUP_ENTRY',
      errno: 1062
    });
    const recovery = {
      error: duplicate,
      migrationName: '0007_guest_checkout_hardening.sql',
      statementNumber: 5,
      statementChecksum: guestClaimBackfillChecksum
    };

    expect(isRecoverableStartedStatementError(recovery)).toBe(true);
    expect(isRecoverableStartedStatementError({ ...recovery, statementNumber: 4 })).toBe(false);
    expect(isRecoverableStartedStatementError({ ...recovery, statementChecksum: '0'.repeat(64) })).toBe(false);
    expect(isRecoverableStartedStatementError({
      ...recovery,
      error: Object.assign(new Error('foreign key failed'), {
        code: 'ER_NO_REFERENCED_ROW_2',
        errno: 1452
      })
    })).toBe(false);
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
      '0013_admin_tracking_source.sql',
      '0014_admin_workspace.sql',
      '0015_personalization_opt_out_cleanup.sql',
      '0016_personalization_snapshot_guard.sql'
    ]);
    expect(migrations.map((migration) => migration.statements.length)).toEqual([25, 1, 2, 1, 1, 1, 8, 1, 2, 2, 2, 2, 1, 3, 1, 3]);
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

  it('adds bounded administrator workspace documents and typed delivery settings', async () => {
    const migrations = await loadMigrations();
    const migration = migrations.find((entry) => entry.name === '0014_admin_workspace.sql');

    expect(migration.statements).toHaveLength(3);
    expect(migration.statements[0]).toMatch(
      /CREATE TABLE IF NOT EXISTS admin_workspace_documents[\s\S]+resource IN \('products', 'categories', 'inventory', 'promotions', 'delivery', 'settings'\)[\s\S]+JSON_TYPE\(document\) = 'OBJECT'/i
    );
    expect(migration.statements[1]).toMatch(
      /CREATE TABLE IF NOT EXISTS store_delivery_settings[\s\S]+default_fee_cents[\s\S]+free_delivery_threshold_cents/i
    );
    expect(migration.statements[2]).toMatch(/VALUES \(1, 2000, 20000, 0\)/i);
  });

  it('removes recommendation snapshots retained for customers who already opted out', async () => {
    const migrations = await loadMigrations();
    const migration = migrations.find((entry) => entry.name === '0015_personalization_opt_out_cleanup.sql');

    expect(migration.statements).toHaveLength(1);
    expect(migration.statements[0]).toMatch(
      /DELETE\s+rs[\s\S]+FROM\s+recommendation_snapshots\s+AS\s+rs[\s\S]+JOIN\s+user_preferences\s+AS\s+pref[\s\S]+personalization_enabled\s*=\s*0/i
    );
  });

  it('enforces personalization consent for recommendation snapshots inside MySQL', async () => {
    const migrations = await loadMigrations();
    const migration = migrations.find((entry) => entry.name === '0016_personalization_snapshot_guard.sql');

    expect(migration.statements).toHaveLength(3);
    expect(migration.statements[0]).toMatch(
      /CREATE\s+TRIGGER\s+trg_recommendation_snapshots_require_consent[\s\S]+BEFORE\s+INSERT\s+ON\s+recommendation_snapshots[\s\S]+SELECT\s+pref\.personalization_enabled[\s\S]+FOR\s+SHARE/i
    );
    expect(migration.statements[1]).toMatch(
      /CREATE\s+TRIGGER\s+trg_user_preferences_purge_recommendations[\s\S]+AFTER\s+UPDATE\s+ON\s+user_preferences[\s\S]+DELETE\s+FROM\s+recommendation_snapshots[\s\S]+NEW\.personalization_enabled\s*=\s*0/i
    );
    expect(migration.statements[2]).toMatch(
      /DELETE\s+snapshots[\s\S]+FROM\s+recommendation_snapshots[\s\S]+JOIN\s+user_preferences[\s\S]+personalization_enabled\s*=\s*0/i
    );
  });
});

describe('migration execution safety', () => {
  it('serializes, records checksums, and becomes a no-op on rerun', async () => {
    const fake = fakeDatabase();
    const first = await runMigrations({ database: fake.database, log: silentLog });
    const second = await runMigrations({ database: fake.database, log: silentLog });

    expect(first).toEqual({ applied: 16, total: 16 });
    expect(second).toEqual({ applied: 0, total: 16 });
    expect(fake.applied.size).toBe(16);
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

  it('lets an older rollback runner accept a completed trailing migration', async () => {
    const migrations = await loadMigrations();
    const newerChecksum = 'f'.repeat(64);
    const fake = fakeDatabase([
      ...migrations.map(({ name, checksum }) => ({ name, checksum })),
      { name: '0017_newer_release.sql', checksum: newerChecksum }
    ], {
      progressRows: [{
        migrationName: '0017_newer_release.sql',
        migrationChecksum: newerChecksum,
        statementNumber: 1,
        statementChecksum: 'e'.repeat(64),
        state: 'completed'
      }]
    });

    await expect(runMigrations({ database: fake.database, log: silentLog }))
      .resolves.toEqual({ applied: 0, total: migrations.length });
  });

  it('recovers an exact previously-started statement after its DDL already committed', async () => {
    await withTemporaryMigration('CREATE TABLE recovery_sample (id INT);\n', async (directory) => {
      const [migration] = await loadMigrations(directory);
      const statementChecksum = migrationChecksum(migration.statements[0]);
      const fake = fakeDatabase([], {
        progressRows: [{
          migrationName: migration.name,
          migrationChecksum: migration.checksum,
          statementNumber: 1,
          statementChecksum,
          state: 'started'
        }],
        statementError(sql) {
          if (!sql.includes('CREATE TABLE recovery_sample')) return;
          const error = new Error('Table recovery_sample already exists');
          error.code = 'ER_TABLE_EXISTS_ERROR';
          error.errno = 1050;
          throw error;
        }
      });

      await expect(runMigrations({
        database: fake.database,
        directory,
        log: silentLog
      })).resolves.toEqual({ applied: 1, total: 1 });
      expect(fake.progress.get(`${migration.name}\u00001`)?.state).toBe('completed');
      expect(fake.applied.get(migration.name)).toBe(migration.checksum);
    });
  });

  it('recovers an exact previously-started trigger after its DDL already committed', async () => {
    await withTemporaryMigration(
      'CREATE TRIGGER recovery_trigger BEFORE INSERT ON sample FOR EACH ROW SET NEW.id = NEW.id;\n',
      async (directory) => {
        const [migration] = await loadMigrations(directory);
        const statementChecksum = migrationChecksum(migration.statements[0]);
        const fake = fakeDatabase([], {
          progressRows: [{
            migrationName: migration.name,
            migrationChecksum: migration.checksum,
            statementNumber: 1,
            statementChecksum,
            state: 'started'
          }],
          statementError(sql) {
            if (!sql.includes('CREATE TRIGGER recovery_trigger')) return;
            const error = new Error('Trigger recovery_trigger already exists');
            error.code = 'ER_TRG_ALREADY_EXISTS';
            error.errno = 1359;
            throw error;
          }
        });

        await expect(runMigrations({ database: fake.database, directory, log: silentLog }))
          .resolves.toEqual({ applied: 1, total: 1 });
        expect(fake.progress.get(`${migration.name}\u00001`)?.state).toBe('completed');
      }
    );
  });

  it('recovers an exact interrupted ALTER after its foreign-key drop already committed', async () => {
    await withTemporaryMigration(
      'ALTER TABLE orders DROP FOREIGN KEY fk_orders_user;\n',
      async (directory) => {
        const [migration] = await loadMigrations(directory);
        const statementChecksum = migrationChecksum(migration.statements[0]);
        const fake = fakeDatabase([], {
          progressRows: [{
            migrationName: migration.name,
            migrationChecksum: migration.checksum,
            statementNumber: 1,
            statementChecksum,
            state: 'started'
          }],
          statementError(sql) {
            if (!sql.includes('DROP FOREIGN KEY fk_orders_user')) return;
            const error = new Error("Can't DROP 'fk_orders_user'; check that column/key exists");
            error.code = 'ER_CANT_DROP_FIELD_OR_KEY';
            error.errno = 1091;
            throw error;
          }
        });

        await expect(runMigrations({ database: fake.database, directory, log: silentLog }))
          .resolves.toEqual({ applied: 1, total: 1 });
        expect(fake.progress.get(`${migration.name}\u00001`)?.state).toBe('completed');
        expect(fake.applied.get(migration.name)).toBe(migration.checksum);
      }
    );
  });

  it('never accepts an already-exists error without durable prior started progress', async () => {
    await withTemporaryMigration('CREATE TABLE preexisting_sample (id INT);\n', async (directory) => {
      let statementAttempts = 0;
      const fake = fakeDatabase([], {
        statementError(sql) {
          if (!sql.includes('CREATE TABLE preexisting_sample')) return;
          statementAttempts += 1;
          const error = new Error('Table preexisting_sample already exists');
          error.code = 'ER_TABLE_EXISTS_ERROR';
          error.errno = 1050;
          throw error;
        }
      });

      await expect(runMigrations({ database: fake.database, directory, log: silentLog }))
        .rejects.toThrow('Table preexisting_sample already exists');
      expect(fake.progress.size).toBe(0);
      await expect(runMigrations({ database: fake.database, directory, log: silentLog }))
        .rejects.toThrow('Table preexisting_sample already exists');
      expect(fake.progress.size).toBe(0);
      expect(statementAttempts).toBe(2);
    });
  });

  it('rejects non-allowlisted errors even for an exact previously-started statement', async () => {
    await withTemporaryMigration('CREATE TABLE invalid_recovery_sample (id INT);\n', async (directory) => {
      const [migration] = await loadMigrations(directory);
      const statementChecksum = migrationChecksum(migration.statements[0]);
      const fake = fakeDatabase([], {
        progressRows: [{
          migrationName: migration.name,
          migrationChecksum: migration.checksum,
          statementNumber: 1,
          statementChecksum,
          state: 'started'
        }],
        statementError(sql) {
          if (!sql.includes('CREATE TABLE invalid_recovery_sample')) return;
          const error = new Error('Text mentions already exists but this is not a schema collision');
          error.code = 'ER_PARSE_ERROR';
          error.errno = 1064;
          throw error;
        }
      });

      await expect(runMigrations({ database: fake.database, directory, log: silentLog }))
        .rejects.toThrow('Text mentions already exists but this is not a schema collision');
      expect(fake.progress.get(`${migration.name}\u00001`)?.state).toBe('started');
      expect(fake.applied.has(migration.name)).toBe(false);
    });
  });

  it('rejects changed statement progress before executing the migration', async () => {
    await withTemporaryMigration('CREATE TABLE checksum_sample (id INT);\n', async (directory) => {
      const [migration] = await loadMigrations(directory);
      let statementExecuted = false;
      const fake = fakeDatabase([], {
        progressRows: [{
          migrationName: migration.name,
          migrationChecksum: migration.checksum,
          statementNumber: 1,
          statementChecksum: '0'.repeat(64),
          state: 'started'
        }],
        statementError(sql) {
          if (sql.includes('CREATE TABLE checksum_sample')) statementExecuted = true;
        }
      });

      await expect(runMigrations({ database: fake.database, directory, log: silentLog }))
        .rejects.toThrow(`Statement checksum mismatch in migration progress for ${migration.name} statement 1`);
      expect(statementExecuted).toBe(false);
    });
  });

  it('records the migration without replaying a statement already marked completed', async () => {
    await withTemporaryMigration('CREATE TABLE completed_sample (id INT);\n', async (directory) => {
      const [migration] = await loadMigrations(directory);
      const statementChecksum = migrationChecksum(migration.statements[0]);
      let statementExecuted = false;
      const fake = fakeDatabase([], {
        progressRows: [{
          migrationName: migration.name,
          migrationChecksum: migration.checksum,
          statementNumber: 1,
          statementChecksum,
          state: 'completed'
        }],
        statementError(sql) {
          if (sql.includes('CREATE TABLE completed_sample')) statementExecuted = true;
        }
      });

      await expect(runMigrations({ database: fake.database, directory, log: silentLog }))
        .resolves.toEqual({ applied: 1, total: 1 });
      expect(statementExecuted).toBe(false);
      expect(fake.applied.get(migration.name)).toBe(migration.checksum);
    });
  });
});
