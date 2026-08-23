import mysql from 'mysql2/promise';
import { config } from '../config.js';

function sslOptions() {
  if (!config.db.tls) return undefined;
  const ca = config.readDatabaseCa();
  if (!ca) throw new Error('DB_TLS=true requires DB_TLS_CA_PATH.');
  return {
    ca,
    rejectUnauthorized: true,
    ...(config.db.tlsServername ? { servername: config.db.tlsServername } : {})
  };
}

export function connectionOptions(overrides = {}) {
  return {
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    charset: 'utf8mb4',
    timezone: 'Z',
    supportBigNumbers: true,
    decimalNumbers: false,
    dateStrings: true,
    ssl: sslOptions(),
    ...overrides
  };
}

export function createDatabasePool() {
  return mysql.createPool({
    ...connectionOptions(),
    waitForConnections: true,
    connectionLimit: config.db.connectionLimit,
    maxIdle: config.db.connectionLimit,
    idleTimeout: 60000,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  });
}

export const pool = config.isTest && process.env.TEST_USE_DATABASE !== 'true'
  ? null
  : createDatabasePool();

export async function withTransaction(work, database = pool) {
  if (!database) throw new Error('Database pool is not available.');
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
