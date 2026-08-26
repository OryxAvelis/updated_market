import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  defaultMigrationsDirectory,
  loadMigrations,
  runMigrations
} from '../../src/db/migrate.js';

const disposableDatabaseEnabled = process.env.TEST_USE_DISPOSABLE_MIGRATION_DATABASE === 'true';
const databaseDescribe = disposableDatabaseEnabled ? describe.sequential : describe.skip;
const migrationUnderTest = '0012_supported_payment_preferences.sql';
const databaseName = `am_market_migration_test_${randomUUID().replaceAll('-', '')}`;
let adminConnection = null;
let database = null;
let migrationDirectory = null;
let databaseCreated = false;
let testUserId = null;

function requiredEnvironment(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required for disposable migration tests.`);
  return value;
}

function quotedDisposableDatabaseName() {
  if (!/^am_market_migration_test_[a-f0-9]{32}$/.test(databaseName)) {
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

databaseDescribe('payment preference migration on a disposable MySQL database', () => {
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

    migrationDirectory = await mkdtemp(path.join(tmpdir(), 'am-market-migrations-'));
    const migrations = await loadMigrations();
    const legacyMigrations = migrations.filter((migration) => migration.name < migrationUnderTest);
    expect(legacyMigrations.map((migration) => migration.name).at(-1))
      .toBe('0011_customer_consistency_backfill.sql');
    for (const migration of legacyMigrations) {
      await copyFile(
        path.join(defaultMigrationsDirectory, migration.name),
        path.join(migrationDirectory, migration.name)
      );
    }

    await expect(runMigrations({
      database,
      directory: migrationDirectory,
      log: { info() {}, error() {} }
    })).resolves.toEqual({ applied: 11, total: 11 });

    const publicId = randomUUID();
    const email = `legacy-payment-preference-${publicId}@example.test`;
    const [result] = await database.execute(
      `INSERT INTO users
        (public_id, email, email_normalized, display_name, password_hash)
       VALUES (?, ?, ?, ?, ?)`,
      [publicId, email, email, 'Legacy Payment Preference', 'integration-test-password-hash']
    );
    testUserId = result.insertId;
    await database.execute(
      `INSERT INTO user_preferences (user_id, default_payment)
       VALUES (?, 'card')`,
      [testUserId]
    );

    await copyFile(
      path.join(defaultMigrationsDirectory, migrationUnderTest),
      path.join(migrationDirectory, migrationUnderTest)
    );
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
    try {
      if (migrationDirectory) {
        await rm(migrationDirectory, { recursive: true, force: true });
      }
    } catch (error) {
      cleanupError ||= error;
    }
    if (cleanupError) throw cleanupError;
  }, 60_000);

  it('backfills the legacy value, enforces supported preferences, and retries safely', async () => {
    const [legacyRows] = await database.execute(
      'SELECT default_payment FROM user_preferences WHERE user_id = ?',
      [testUserId]
    );
    expect(legacyRows).toEqual([{ default_payment: 'card' }]);

    await expect(runMigrations({
      database,
      directory: migrationDirectory,
      log: { info() {}, error() {} }
    })).resolves.toEqual({ applied: 1, total: 12 });

    const [backfilledRows] = await database.execute(
      'SELECT default_payment FROM user_preferences WHERE user_id = ?',
      [testUserId]
    );
    expect(backfilledRows).toEqual([{ default_payment: 'cod' }]);

    for (const paymentMethod of ['cod', 'wafacash', 'cashplus']) {
      await expect(database.execute(
        'UPDATE user_preferences SET default_payment = ? WHERE user_id = ?',
        [paymentMethod, testUserId]
      )).resolves.toBeDefined();
    }

    await expect(database.execute(
      "UPDATE user_preferences SET default_payment = 'card' WHERE user_id = ?",
      [testUserId]
    )).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' });

    const [ordersCheckRows] = await database.query(
      `SELECT check_clause AS checkClause
         FROM information_schema.check_constraints
        WHERE constraint_schema = DATABASE()
          AND constraint_name = 'chk_orders_payment_method'`
    );
    expect(ordersCheckRows).toHaveLength(1);
    const orderPaymentCheck = String(ordersCheckRows[0].checkClause).toLowerCase().replaceAll('\\', '');
    expect(orderPaymentCheck).toContain("'card'");

    // Reproduce a process stop after 0012's atomic DDL committed but before
    // its schema_migrations record became durable. Reapplying must succeed,
    // preserve the supported value, and restore one migration record.
    await database.execute('DELETE FROM schema_migrations WHERE name = ?', [migrationUnderTest]);
    await expect(runMigrations({
      database,
      directory: migrationDirectory,
      log: { info() {}, error() {} }
    })).resolves.toEqual({ applied: 1, total: 12 });

    const [retriedRows] = await database.execute(
      'SELECT default_payment FROM user_preferences WHERE user_id = ?',
      [testUserId]
    );
    expect(retriedRows).toEqual([{ default_payment: 'cashplus' }]);
    const [migrationRows] = await database.execute(
      'SELECT COUNT(*) AS migrationCount FROM schema_migrations WHERE name = ?',
      [migrationUnderTest]
    );
    expect(Number(migrationRows[0].migrationCount)).toBe(1);
    await expect(database.execute(
      "UPDATE user_preferences SET default_payment = 'card' WHERE user_id = ?",
      [testUserId]
    )).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' });

    await expect(runMigrations({
      database,
      directory: migrationDirectory,
      log: { info() {}, error() {} }
    })).resolves.toEqual({ applied: 0, total: 12 });
  }, 60_000);
});
