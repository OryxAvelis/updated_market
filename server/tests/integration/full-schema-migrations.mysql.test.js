import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations, runMigrations } from '../../src/db/migrate.js';

const disposableDatabaseEnabled = process.env.TEST_USE_DISPOSABLE_MIGRATION_DATABASE === 'true';
const databaseDescribe = disposableDatabaseEnabled ? describe.sequential : describe.skip;
const databaseName = `am_market_full_migration_test_${randomUUID().replaceAll('-', '')}`;
let adminConnection = null;
let database = null;
let databaseCreated = false;
let migrations = [];

function requiredEnvironment(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required for disposable migration tests.`);
  return value;
}

function quotedDisposableDatabaseName() {
  if (!/^am_market_full_migration_test_[a-f0-9]{32}$/.test(databaseName)) {
    throw new Error('Refusing to operate on an unexpected disposable database name.');
  }
  return `\`${databaseName}\``;
}

async function adminOptions() {
  const caPath = requiredEnvironment('TEST_MYSQL_ADMIN_TLS_CA_PATH');
  return {
    host: requiredEnvironment('TEST_MYSQL_ADMIN_HOST'),
    port: Number(requiredEnvironment('TEST_MYSQL_ADMIN_PORT')),
    user: requiredEnvironment('TEST_MYSQL_ADMIN_USER'),
    password: requiredEnvironment('TEST_MYSQL_ADMIN_PASSWORD'),
    charset: 'utf8mb4',
    timezone: 'Z',
    supportBigNumbers: true,
    decimalNumbers: false,
    dateStrings: true,
    ssl: {
      ca: await readFile(caPath, 'utf8'),
      rejectUnauthorized: true,
      servername: process.env.TEST_MYSQL_ADMIN_TLS_SERVERNAME || 'localhost'
    }
  };
}

databaseDescribe('full schema migrations on a disposable MySQL database', () => {
  beforeAll(async () => {
    const options = await adminOptions();
    adminConnection = await mysql.createConnection(options);
    await adminConnection.query(
      `CREATE DATABASE ${quotedDisposableDatabaseName()}
       CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
    );
    databaseCreated = true;
    database = mysql.createPool({
      ...options,
      database: databaseName,
      waitForConnections: true,
      connectionLimit: 2,
      maxIdle: 2,
      idleTimeout: 10_000,
      queueLimit: 0
    });
    migrations = await loadMigrations();
  }, 60_000);

  afterAll(async () => {
    let cleanupError = null;
    try {
      await database?.end();
    } catch (error) {
      cleanupError = error;
    }
    try {
      if (adminConnection && databaseCreated) {
        await adminConnection.query(`DROP DATABASE ${quotedDisposableDatabaseName()}`);
      }
    } catch (error) {
      cleanupError ||= error;
    }
    try {
      await adminConnection?.end();
    } catch (error) {
      cleanupError ||= error;
    }
    if (cleanupError) throw cleanupError;
  }, 60_000);

  it('applies every migration once and replays the complete ledger safely', async () => {
    expect(migrations.at(-1)?.name).toBe('0016_personalization_snapshot_guard.sql');

    await expect(runMigrations({
      database,
      log: { info() {}, error() {} }
    })).resolves.toEqual({ applied: migrations.length, total: migrations.length });

    await expect(runMigrations({
      database,
      log: { info() {}, error() {} }
    })).resolves.toEqual({ applied: 0, total: migrations.length });

    const [ledgerRows] = await database.query(
      `SELECT name AS migrationName, checksum, statement_count AS statementCount
         FROM schema_migrations
        ORDER BY name`
    );
    expect(ledgerRows.map(row => row.migrationName)).toEqual(
      migrations.map(migration => migration.name)
    );
    expect(ledgerRows.every(row => /^[a-f0-9]{64}$/.test(row.checksum))).toBe(true);
    expect(ledgerRows.every(row => Number(row.statementCount) > 0)).toBe(true);

    const [progressRows] = await database.query(
      `SELECT state, COUNT(*) AS count
         FROM schema_migration_statements
        GROUP BY state`
    );
    expect(progressRows).toHaveLength(1);
    expect(progressRows[0].state).toBe('completed');
    expect(Number(progressRows[0].count)).toBeGreaterThanOrEqual(migrations.length);

    const [tableRows] = await database.query(
      `SELECT table_name AS tableName
         FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name IN ('admin_workspace_documents', 'store_delivery_settings')
        ORDER BY table_name`
    );
    expect(tableRows).toEqual([
      { tableName: 'admin_workspace_documents' },
      { tableName: 'store_delivery_settings' }
    ]);
  }, 60_000);

  it('serializes recommendation writes with opt-out and purges legacy snapshots', async () => {
    const suffix = randomUUID();
    const [userResult] = await database.execute(
      `INSERT INTO users
        (public_id, email, email_normalized, display_name, password_hash)
       VALUES (?, ?, ?, 'Migration test user', 'not-a-real-password-hash')`,
      [suffix, `${suffix}@example.test`, `${suffix}@example.test`]
    );
    const userId = userResult.insertId;
    await database.execute(
      'INSERT INTO user_preferences (user_id, personalization_enabled) VALUES (?, 1)',
      [userId]
    );
    const [productResult] = await database.execute(
      `INSERT INTO catalog_product_refs
        (external_id, last_known_name, last_verified_price, is_available, last_verified_at)
       VALUES (?, 'Migration test product', 1.00, 1, UTC_TIMESTAMP(3))`,
      [`migration-${suffix}`]
    );
    const productRefId = productResult.insertId;
    const insertSnapshot = `INSERT INTO recommendation_snapshots
      (user_id, product_ref_id, score, reason, expires_at)
     VALUES (?, ?, 1, 'migration_test', TIMESTAMPADD(HOUR, 1, UTC_TIMESTAMP(3)))`;

    const writer = await database.getConnection();
    const optOut = await database.getConnection();
    try {
      await writer.beginTransaction();
      await writer.execute(insertSnapshot, [userId, productRefId]);

      await optOut.beginTransaction();
      const optOutUpdate = optOut.execute(
        'UPDATE user_preferences SET personalization_enabled = 0 WHERE user_id = ?',
        [userId]
      );
      await new Promise(resolve => setTimeout(resolve, 100));
      await writer.commit();
      await optOutUpdate;
      await optOut.commit();
    } catch (error) {
      await writer.rollback();
      await optOut.rollback();
      throw error;
    } finally {
      writer.release();
      optOut.release();
    }

    const [afterConcurrentOptOut] = await database.execute(
      'SELECT COUNT(*) AS count FROM recommendation_snapshots WHERE user_id = ?',
      [userId]
    );
    expect(Number(afterConcurrentOptOut[0].count)).toBe(0);
    await expect(database.execute(insertSnapshot, [userId, productRefId])).rejects.toThrow();

    await database.execute(
      'UPDATE user_preferences SET personalization_enabled = 1 WHERE user_id = ?',
      [userId]
    );
    await database.execute(insertSnapshot, [userId, productRefId]);
    await database.execute(
      'UPDATE user_preferences SET personalization_enabled = 0 WHERE user_id = ?',
      [userId]
    );
    const [afterLegacyStyleOptOut] = await database.execute(
      'SELECT COUNT(*) AS count FROM recommendation_snapshots WHERE user_id = ?',
      [userId]
    );
    expect(Number(afterLegacyStyleOptOut[0].count)).toBe(0);
  }, 60_000);
});
