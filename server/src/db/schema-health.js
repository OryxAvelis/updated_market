import { loadMigrations } from './migrate.js';

let expectedMigrationsPromise;
const migrationNamePattern = /^(\d{4})_[a-z0-9_]+\.sql$/;

async function expectedMigrations() {
  expectedMigrationsPromise ||= loadMigrations();
  return expectedMigrationsPromise;
}

export async function assertCurrentSchema(connection, expected = null) {
  const migrations = expected || await expectedMigrations();
  const [rows] = await connection.query(
    'SELECT name, checksum FROM schema_migrations ORDER BY name'
  );

  if (rows.length < migrations.length) {
    throw new Error(
      `Database schema is not current: expected at least ${migrations.length} applied migration(s), found ${rows.length}.`
    );
  }

  for (let index = 0; index < migrations.length; index += 1) {
    const applied = rows[index];
    const expectedMigration = migrations[index];
    if (applied?.name !== expectedMigration.name || applied?.checksum !== expectedMigration.checksum) {
      throw new Error(`Database schema migration mismatch at ${expectedMigration.name}.`);
    }
  }

  let previousVersion = Number(migrationNamePattern.exec(migrations.at(-1)?.name || '')?.[1]);
  for (const applied of rows.slice(migrations.length)) {
    const match = migrationNamePattern.exec(applied?.name || '');
    const version = match ? Number(match[1]) : NaN;
    if (
      !match
      || !Number.isInteger(version)
      || version <= previousVersion
      || !/^[a-f0-9]{64}$/.test(String(applied?.checksum || ''))
    ) {
      throw new Error(`Database schema has an invalid trailing migration ${applied?.name || '(missing name)'}.`);
    }
    previousVersion = version;
  }

  return {
    appliedCount: rows.length,
    latestMigration: migrations.at(-1)?.name || null
  };
}
