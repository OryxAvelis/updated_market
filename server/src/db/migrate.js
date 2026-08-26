import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
export const defaultMigrationsDirectory = path.join(sourceDirectory, 'migrations');

const migrationNamePattern = /^(\d{4})_[a-z0-9_]+\.sql$/;
const statementSeparator = /^[\t ]*--[\t ]+statement-breakpoint[\t ]*$/gmi;
const defaultLockTimeoutSeconds = 60;
const alreadyExistsErrorCodes = new Set([
  'ER_TABLE_EXISTS_ERROR',
  'ER_TRG_ALREADY_EXISTS',
  'ER_DUP_FIELDNAME',
  'ER_DUP_KEYNAME',
  'ER_FK_DUP_NAME',
  'ER_DUP_CONSTRAINT_NAME',
  'ER_CANT_DROP_FIELD_OR_KEY'
]);
const alreadyExistsErrorNumbers = new Set([1050, 1060, 1061, 1091, 1359, 1826, 3822]);
const recoverableDuplicateStatements = new Map([
  [
    '0007_guest_checkout_hardening.sql\u00005',
    '54dfc82bc0561c64401e5000030b9a94c3c9554ff0bf8e97cffb479a81bdb0ca'
  ]
]);

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

const createMigrationStatementsTableSql = `
  CREATE TABLE IF NOT EXISTS schema_migration_statements (
    migration_name VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    migration_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    statement_number INT UNSIGNED NOT NULL,
    statement_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    state ENUM('started', 'completed') CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    completed_at DATETIME(3) NULL,
    PRIMARY KEY (migration_name, statement_number),
    CONSTRAINT chk_schema_migration_statement_number CHECK (statement_number > 0)
  ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
`;

export function normalizeMigrationSource(source) {
  return String(source).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

export function migrationChecksum(source) {
  return createHash('sha256').update(normalizeMigrationSource(source), 'utf8').digest('hex');
}

export function isRecoverableStartedStatementError({
  error,
  migrationName,
  statementNumber,
  statementChecksum
}) {
  if (isAlreadyExistsError(error)) return true;
  const duplicateEntry = error?.code === 'ER_DUP_ENTRY' || Number(error?.errno) === 1062;
  if (!duplicateEntry) return false;
  return recoverableDuplicateStatements.get(`${migrationName}\u0000${statementNumber}`) === statementChecksum;
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
  const appliedByName = new Map();
  const newerAppliedByName = new Map();

  for (let index = 0; index < Math.min(rows.length, migrations.length); index += 1) {
    const row = rows[index];
    const migration = migrations[index];
    if (row.name !== migration.name) {
      throw new Error(
        `Applied migration history diverges at ${migration.name}; found ${row.name} instead.`
      );
    }
    if (row.checksum !== migration.checksum) {
      throw new Error(`Checksum mismatch for applied migration ${row.name}; applied migrations are immutable.`);
    }
    appliedByName.set(row.name, row.checksum);
  }

  if (rows.length > migrations.length) {
    const latestExpectedVersion = Number(migrationNamePattern.exec(migrations.at(-1).name)[1]);
    let previousVersion = latestExpectedVersion;
    for (const row of rows.slice(migrations.length)) {
      const match = migrationNamePattern.exec(row.name);
      const version = match ? Number(match[1]) : NaN;
      if (!match || !Number.isInteger(version) || version <= previousVersion) {
        throw new Error(`Applied migration ${row.name} is not a valid trailing newer migration.`);
      }
      if (!/^[a-f0-9]{64}$/.test(String(row.checksum || ''))) {
        throw new Error(`Applied migration ${row.name} has an invalid checksum.`);
      }
      newerAppliedByName.set(row.name, row.checksum);
      previousVersion = version;
    }
  }
  return { appliedByName, newerAppliedByName };
}

function statementProgressKey(migrationName, statementNumber) {
  return `${migrationName}\u0000${statementNumber}`;
}

function isAlreadyExistsError(error) {
  return alreadyExistsErrorCodes.has(error?.code)
    || alreadyExistsErrorNumbers.has(Number(error?.errno));
}

async function validateStatementProgress(connection, migrations, newerAppliedByName = new Map()) {
  const [rows] = await connection.query(
    `SELECT migration_name AS migrationName,
            migration_checksum AS migrationChecksum,
            statement_number AS statementNumber,
            statement_checksum AS statementChecksum,
            state
       FROM schema_migration_statements
      ORDER BY migration_name, statement_number`
  );
  const filesByName = new Map(migrations.map((migration) => [migration.name, migration]));
  const progressByStatement = new Map();

  for (const row of rows) {
    const migration = filesByName.get(row.migrationName);
    if (!migration) {
      const newerChecksum = newerAppliedByName.get(row.migrationName);
      const statementNumber = Number(row.statementNumber);
      if (
        newerChecksum
        && row.migrationChecksum === newerChecksum
        && Number.isInteger(statementNumber)
        && statementNumber > 0
        && /^[a-f0-9]{64}$/.test(String(row.statementChecksum || ''))
        && row.state === 'completed'
      ) {
        continue;
      }
      throw new Error(
        `Migration statement progress references missing migration ${row.migrationName}.`
      );
    }
    if (row.migrationChecksum !== migration.checksum) {
      throw new Error(
        `Migration checksum mismatch in statement progress for ${row.migrationName}; migrations are immutable.`
      );
    }

    const statementNumber = Number(row.statementNumber);
    const statement = migration.statements[statementNumber - 1];
    if (!Number.isInteger(statementNumber) || statementNumber < 1 || !statement) {
      throw new Error(
        `Invalid statement progress number ${row.statementNumber} for ${row.migrationName}.`
      );
    }
    const expectedStatementChecksum = migrationChecksum(statement);
    if (row.statementChecksum !== expectedStatementChecksum) {
      throw new Error(
        `Statement checksum mismatch in migration progress for ${row.migrationName} statement ${statementNumber}.`
      );
    }
    if (row.state !== 'started' && row.state !== 'completed') {
      throw new Error(
        `Invalid migration progress state for ${row.migrationName} statement ${statementNumber}.`
      );
    }

    progressByStatement.set(statementProgressKey(row.migrationName, statementNumber), {
      migrationChecksum: row.migrationChecksum,
      statementChecksum: row.statementChecksum,
      state: row.state
    });
  }
  return progressByStatement;
}

async function recordStatementStarted(connection, migration, statementNumber, statementChecksum) {
  await connection.execute(
    `INSERT INTO schema_migration_statements
      (migration_name, migration_checksum, statement_number, statement_checksum, state)
     VALUES (?, ?, ?, ?, 'started')`,
    [migration.name, migration.checksum, statementNumber, statementChecksum]
  );
}

async function recordStatementCompleted(connection, migration, statementNumber, statementChecksum) {
  const [result] = await connection.execute(
    `UPDATE schema_migration_statements
        SET state = 'completed', completed_at = CURRENT_TIMESTAMP(3)
      WHERE migration_name = ?
        AND migration_checksum = ?
        AND statement_number = ?
        AND statement_checksum = ?
        AND state = 'started'`,
    [migration.name, migration.checksum, statementNumber, statementChecksum]
  );
  if (Number(result.affectedRows) !== 1) {
    throw new Error(
      `Could not mark ${migration.name} statement ${statementNumber} as completed.`
    );
  }
}

async function removeNewStatementMarker(connection, migration, statementNumber, statementChecksum, log) {
  try {
    await connection.execute(
      `DELETE FROM schema_migration_statements
        WHERE migration_name = ?
          AND migration_checksum = ?
          AND statement_number = ?
          AND statement_checksum = ?
          AND state = 'started'`,
      [migration.name, migration.checksum, statementNumber, statementChecksum]
    );
  } catch (error) {
    // A lost connection after DDL is ambiguous by definition. Keep the original
    // statement error; the durable started row is the evidence used on recovery.
    log.error?.(
      `Failed to clear statement progress for ${migration.name} statement ${statementNumber}: ${error.message}`
    );
  }
}

export async function runMigrations({
  database,
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
    await connection.query(createMigrationStatementsTableSql);
    const { appliedByName: applied, newerAppliedByName } = await validateAppliedMigrations(
      connection,
      migrations
    );
    const statementProgress = await validateStatementProgress(
      connection,
      migrations,
      newerAppliedByName
    );
    let appliedCount = 0;

    for (const migration of migrations) {
      if (applied.has(migration.name)) continue;

      const startedAt = process.hrtime.bigint();
      // Each chunk is sent separately. The pool never enables `multipleStatements`,
      // so a migration cannot smuggle a second statement through a single query.
      for (let index = 0; index < migration.statements.length; index += 1) {
        const statementNumber = index + 1;
        const statement = migration.statements[index];
        const statementChecksum = migrationChecksum(statement);
        const progressKey = statementProgressKey(migration.name, statementNumber);
        const existingProgress = statementProgress.get(progressKey);
        if (existingProgress?.state === 'completed') continue;

        const recoveringStartedStatement = existingProgress?.state === 'started';
        if (!recoveringStartedStatement) {
          await recordStatementStarted(connection, migration, statementNumber, statementChecksum);
          statementProgress.set(progressKey, {
            migrationChecksum: migration.checksum,
            statementChecksum,
            state: 'started'
          });
        }

        try {
          await connection.query(statement);
        } catch (error) {
          if (recoveringStartedStatement && isRecoverableStartedStatementError({
            error,
            migrationName: migration.name,
            statementNumber,
            statementChecksum
          })) {
            log.warn?.(
              `Recovered ${migration.name} statement ${statementNumber} after MySQL reported an already-committed result.`
            );
          } else {
            if (!recoveringStartedStatement) {
              await removeNewStatementMarker(
                connection,
                migration,
                statementNumber,
                statementChecksum,
                log
              );
              statementProgress.delete(progressKey);
            }

            let warningText = '';
            try {
              const [warnings] = await connection.query('SHOW WARNINGS');
              warningText = warnings.map((warning) => warning.Message).filter(Boolean).join(' | ');
            } catch {
              // Preserve the original DDL error if diagnostic collection fails.
            }
            throw new Error(
              `${migration.name} statement ${statementNumber}/${migration.statements.length} failed: ${warningText || error.message}`,
              { cause: error }
            );
          }
        }

        await recordStatementCompleted(
          connection,
          migration,
          statementNumber,
          statementChecksum
        );
        statementProgress.set(progressKey, {
          migrationChecksum: migration.checksum,
          statementChecksum,
          state: 'completed'
        });
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
  let cliPool;
  try {
    ({ pool: cliPool } = await import('./pool.js'));
    const result = await runMigrations({ database: cliPool });
    console.info(`Migrations complete: ${result.applied} applied, ${result.total} available.`);
  } catch (error) {
    console.error(`Migration failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await cliPool?.end();
  }
}
