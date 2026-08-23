import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool as defaultPool } from './pool.js';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
export const defaultMigrationsDirectory = path.join(sourceDirectory, 'migrations');

const migrationNamePattern = /^(\d{4})_[a-z0-9_]+\.sql$/;
const statementSeparator = /^[\t ]*--[\t ]+statement-breakpoint[\t ]*$/gmi;
const defaultLockTimeoutSeconds = 60;

const createMigrationsTableSql = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    statement_count INT UNSIGNED NOT NULL,
    execution_ms INT UNSIGNED NOT NULL,
    applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (name)
  ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
`;

export function normalizeMigrationSource(source) {
  return String(source).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

export function migrationChecksum(source) {
  return createHash('sha256').update(normalizeMigrationSource(source), 'utf8').digest('hex');
}

function containsExecutableSql(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[\t ]*--.*$/gm, '')
    .trim().length > 0;
}

export function splitMigrationStatements(source, migrationName = 'migration') {
  const normalized = normalizeMigrationSource(source);
  if (/^[\t ]*DELIMITER\b/im.test(normalized)) {
    throw new Error(`${migrationName} uses DELIMITER, which is not supported by the safe migration runner.`);
  }
  if (/^[\t ]*SET[\t ]+GLOBAL\b/im.test(normalized)) {
    throw new Error(`${migrationName} attempts to change global MySQL state.`);
  }

  const statements = normalized
    .split(statementSeparator)
    .map((statement) => statement.trim())
    .filter(containsExecutableSql);

  if (statements.length === 0) {
    throw new Error(`${migrationName} contains no executable SQL.`);
  }
  return statements;
}

export async function loadMigrations(directory = defaultMigrationsDirectory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sqlEntries = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql'));
  const invalid = sqlEntries.filter((entry) => !migrationNamePattern.test(entry.name));
  if (invalid.length > 0) {
    throw new Error(`Invalid migration filename(s): ${invalid.map((entry) => entry.name).join(', ')}`);
  }

  const seenVersions = new Set();
  const migrations = [];
  for (const entry of sqlEntries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    const [, version] = migrationNamePattern.exec(entry.name);
    if (seenVersions.has(version)) {
      throw new Error(`Migration version ${version} is used more than once.`);
    }
    seenVersions.add(version);

    const source = await readFile(path.join(directory, entry.name), 'utf8');
    migrations.push({
      name: entry.name,
      checksum: migrationChecksum(source),
      statements: splitMigrationStatements(source, entry.name)
    });
  }

  if (migrations.length === 0) {
    throw new Error(`No migrations were found in ${directory}.`);
  }
  return migrations;
}

function lockNameFor(databaseName) {
  const suffix = createHash('sha256').update(String(databaseName), 'utf8').digest('hex').slice(0, 40);
  return `am-market:migrations:${suffix}`;
}

function elapsedMilliseconds(startedAt) {
  const elapsed = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  return Math.max(0, Math.min(4_294_967_295, Math.round(elapsed)));
}

async function validateAppliedMigrations(connection, migrations) {
  const [rows] = await connection.query('SELECT name, checksum FROM schema_migrations ORDER BY name');
  const filesByName = new Map(migrations.map((migration) => [migration.name, migration]));
  const appliedByName = new Map();

  for (const row of rows) {
    const file = filesByName.get(row.name);
    if (!file) {
      throw new Error(`Applied migration ${row.name} is missing from the migrations directory.`);
    }
    if (row.checksum !== file.checksum) {
      throw new Error(`Checksum mismatch for applied migration ${row.name}; applied migrations are immutable.`);
    }
    appliedByName.set(row.name, row.checksum);
  }

  let pendingMigrationSeen = false;
  for (const migration of migrations) {
    if (!appliedByName.has(migration.name)) {
      pendingMigrationSeen = true;
      continue;
    }
    if (pendingMigrationSeen) {
      throw new Error(
        `Migration ${migration.name} is already applied after an earlier pending migration; migration history is not a contiguous prefix.`
      );
    }
  }
  return appliedByName;
}

export async function runMigrations({
  database = defaultPool,
  directory = defaultMigrationsDirectory,
  lockTimeoutSeconds = defaultLockTimeoutSeconds,
  log = console
} = {}) {
  if (!database) throw new Error('Database pool is not available for migrations.');
  if (!Number.isInteger(lockTimeoutSeconds) || lockTimeoutSeconds < 1 || lockTimeoutSeconds > 300) {
    throw new Error('lockTimeoutSeconds must be an integer between 1 and 300.');
  }

  const migrations = await loadMigrations(directory);
  const connection = await database.getConnection();
  let migrationLockName;
  let lockAcquired = false;

  try {
    await connection.query("SET SESSION time_zone = '+00:00'");
    await connection.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");

    const [databaseRows] = await connection.query('SELECT DATABASE() AS databaseName');
    const databaseName = databaseRows[0]?.databaseName;
    if (!databaseName) throw new Error('No MySQL database is selected for migrations.');

    migrationLockName = lockNameFor(databaseName);
    const [lockRows] = await connection.execute(
      'SELECT GET_LOCK(?, ?) AS acquired',
      [migrationLockName, lockTimeoutSeconds]
    );
    lockAcquired = Number(lockRows[0]?.acquired) === 1;
    if (!lockAcquired) {
      throw new Error(`Could not acquire the migration lock within ${lockTimeoutSeconds} seconds.`);
    }

    await connection.query(createMigrationsTableSql);
    const applied = await validateAppliedMigrations(connection, migrations);
    let appliedCount = 0;

    for (const migration of migrations) {
      if (applied.has(migration.name)) continue;

      const startedAt = process.hrtime.bigint();
      // Each chunk is sent separately. The pool never enables `multipleStatements`,
      // so a migration cannot smuggle a second statement through a single query.
      for (let index = 0; index < migration.statements.length; index += 1) {
        try {
          await connection.query(migration.statements[index]);
        } catch (error) {
          let warningText = '';
          try {
            const [warnings] = await connection.query('SHOW WARNINGS');
            warningText = warnings.map((warning) => warning.Message).filter(Boolean).join(' | ');
          } catch {
            // Preserve the original DDL error if diagnostic collection fails.
          }
          throw new Error(
            `${migration.name} statement ${index + 1}/${migration.statements.length} failed: ${warningText || error.message}`,
            { cause: error }
          );
        }
      }
      const executionMs = elapsedMilliseconds(startedAt);
      await connection.execute(
        `INSERT INTO schema_migrations
          (name, checksum, statement_count, execution_ms)
         VALUES (?, ?, ?, ?)`,
        [migration.name, migration.checksum, migration.statements.length, executionMs]
      );
      appliedCount += 1;
      log.info?.(`Applied ${migration.name} (${migration.statements.length} statements, ${executionMs} ms)`);
    }

    return { applied: appliedCount, total: migrations.length };
  } finally {
    if (lockAcquired && migrationLockName) {
      try {
        await connection.execute('SELECT RELEASE_LOCK(?) AS released', [migrationLockName]);
      } catch (error) {
        log.error?.(`Failed to release migration lock ${migrationLockName}: ${error.message}`);
      }
    }
    connection.release();
  }
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectExecution()) {
  try {
    const result = await runMigrations();
    console.info(`Migrations complete: ${result.applied} applied, ${result.total} available.`);
  } catch (error) {
    console.error(`Migration failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await defaultPool?.end();
  }
}
