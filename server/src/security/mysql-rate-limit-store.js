import { createHash } from 'node:crypto';
import { databaseDateToIso } from '../db/date.js';

function counterDigest(key) {
  return createHash('sha256').update(String(key), 'utf8').digest();
}

export class MySqlRateLimitStore {
  constructor(database, { scope, windowMs }) {
    if (!database) throw new Error('The MySQL rate-limit store requires a database pool.');
    if (!/^[a-z0-9:_-]{1,64}$/i.test(scope)) throw new Error('The rate-limit scope is invalid.');
    this.database = database;
    this.scope = scope;
    this.windowMs = windowMs;
    this.localKeys = false;
  }

  init(options) {
    if (Number.isFinite(options?.windowMs)) this.windowMs = options.windowMs;
  }

  async increment(key) {
    if (typeof this.database.getConnection !== 'function') {
      throw new Error('The MySQL rate-limit store is unavailable.');
    }
    const connection = await this.database.getConnection();
    const digest = counterDigest(key);
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT hits, expires_at
           FROM rate_limit_counters
          WHERE scope = ? AND counter_digest = ?
          LIMIT 1 FOR UPDATE`,
        [this.scope, digest]
      );
      const now = Date.now();
      const current = rows[0];
      const currentExpiryMs = current ? Date.parse(databaseDateToIso(current.expires_at)) : 0;
      const expired = !current || currentExpiryMs <= now;
      const totalHits = expired ? 1 : Number(current.hits) + 1;
      const resetTime = new Date(expired
        ? now + this.windowMs
        : currentExpiryMs);
      if (!current) {
        await connection.execute(
          `INSERT INTO rate_limit_counters
            (scope, counter_digest, hits, window_started_at, expires_at)
           VALUES (?, ?, 1, UTC_TIMESTAMP(3), ?)`,
          [this.scope, digest, resetTime]
        );
      } else if (expired) {
        await connection.execute(
          `UPDATE rate_limit_counters
              SET hits = 1, window_started_at = UTC_TIMESTAMP(3), expires_at = ?
            WHERE scope = ? AND counter_digest = ?`,
          [resetTime, this.scope, digest]
        );
      } else {
        await connection.execute(
          `UPDATE rate_limit_counters
              SET hits = ?
            WHERE scope = ? AND counter_digest = ?`,
          [totalHits, this.scope, digest]
        );
      }
      await connection.commit();
      return { totalHits, resetTime };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async decrement(key) {
    const digest = counterDigest(key);
    await this.database.execute(
      `UPDATE rate_limit_counters
          SET hits = GREATEST(1, hits - 1)
        WHERE scope = ? AND counter_digest = ?`,
      [this.scope, digest]
    );
  }

  async resetKey(key) {
    await this.database.execute(
      'DELETE FROM rate_limit_counters WHERE scope = ? AND counter_digest = ?',
      [this.scope, counterDigest(key)]
    );
  }

  async resetAll() {
    await this.database.execute('DELETE FROM rate_limit_counters WHERE scope = ?', [this.scope]);
  }
}
