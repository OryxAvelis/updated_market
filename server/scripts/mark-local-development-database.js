import { config } from '../src/config.js';

const loopbackHosts = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);
if (config.env !== 'development') {
  throw new Error('A local-development database attestation can be written only in development mode.');
}
if (!loopbackHosts.has(String(config.db.host || '').trim().toLowerCase())) {
  throw new Error('A local-development database attestation can be written only through a loopback MySQL host.');
}

const confirmation = String(process.env.LOCAL_DEVELOPMENT_DATABASE_CONFIRMATION || '').trim();
if (!confirmation || confirmation !== config.db.database) {
  throw new Error('The confirmed database name must exactly match the selected MySQL database.');
}
const { pool } = await import('../src/db/pool.js');
if (!pool) throw new Error('The database pool is unavailable.');

const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  const [databaseRows] = await connection.query('SELECT DATABASE() AS databaseName');
  const actualDatabase = String(databaseRows[0]?.databaseName || '');
  if (actualDatabase !== confirmation) {
    throw new Error('The connected MySQL database does not match the explicit confirmation.');
  }

  const [rows] = await connection.execute(
    'SELECT environment_kind FROM application_environment WHERE singleton_id = 1 LIMIT 1 FOR UPDATE'
  );
  if (rows[0] && rows[0].environment_kind !== 'local_development') {
    throw new Error(`Refusing to replace the existing ${rows[0].environment_kind} database attestation.`);
  }
  if (!rows[0]) {
    await connection.execute(
      `INSERT INTO application_environment (singleton_id, environment_kind)
       VALUES (1, 'local_development')`
    );
  }
  await connection.commit();
  process.stdout.write(`Database ${actualDatabase} is attested for local development.\n`);
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  connection.release();
  await pool.end();
}
