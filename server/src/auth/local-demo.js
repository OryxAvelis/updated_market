import { randomUUID } from 'node:crypto';
import { hashPassword } from '../security/passwords.js';
import { randomToken } from '../security/tokens.js';

export const LOCAL_DEMO_DISPLAY_NAME = 'Local Demo Shopper';
export const LOCAL_DEMO_EMAIL_SUFFIX = '@local.am-market.test';

export function isLocalDemoEmail(email) {
  return String(email || '').trim().toLowerCase().endsWith(LOCAL_DEMO_EMAIL_SUFFIX);
}

export async function assertLocalDevelopmentDatabase(database, { demoEmail } = {}) {
  if (!database?.execute) throw new Error('A database pool is required to verify the local demo database.');
  const [environmentRows] = await database.execute(
    'SELECT environment_kind FROM application_environment WHERE singleton_id = 1 LIMIT 1'
  );
  if (environmentRows[0]?.environment_kind !== 'local_development') {
    throw new Error('The selected MySQL database is not attested for local development.');
  }
  if (demoEmail) {
    const normalizedEmail = String(demoEmail).trim().toLowerCase();
    const [userRows] = await database.execute(
      `SELECT u.id
         FROM local_demo_accounts demo
         JOIN users u ON u.id = demo.user_id
        WHERE demo.singleton_id = 1
          AND u.email_normalized = ?
          AND u.status = 'active'
        LIMIT 1`,
      [normalizedEmail]
    );
    if (!userRows[0]) throw new Error('The marked local demo account is unavailable.');
  }
  return true;
}

export async function provisionLocalDemoUser(database, email) {
  if (!database?.getConnection) throw new Error('A database pool is required to provision the local demo user.');
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!isLocalDemoEmail(normalizedEmail)) {
    throw new Error(`The local demo user email must use the reserved ${LOCAL_DEMO_EMAIL_SUFFIX} domain.`);
  }
  const passwordHash = await hashPassword(randomToken());

  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [environmentRows] = await connection.execute(
      `SELECT environment_kind
         FROM application_environment
        WHERE singleton_id = 1
        LIMIT 1 FOR UPDATE`
    );
    if (environmentRows[0]?.environment_kind !== 'local_development') {
      throw new Error('The selected MySQL database is not attested for local development.');
    }

    const [markedRows] = await connection.execute(
      `SELECT u.id, u.public_id, u.email_normalized
         FROM local_demo_accounts demo
         JOIN users u ON u.id = demo.user_id
        WHERE demo.singleton_id = 1
        LIMIT 1 FOR UPDATE`
    );
    if (markedRows[0] && markedRows[0].email_normalized !== normalizedEmail) {
      throw new Error('The marked local demo account does not match the configured demo email.');
    }

    const [existingRows] = await connection.execute(
      `SELECT u.id, u.public_id, demo.user_id AS demo_user_id
         FROM users u
         LEFT JOIN local_demo_accounts demo ON demo.user_id = u.id
        WHERE u.email_normalized = ?
        LIMIT 1 FOR UPDATE`,
      [normalizedEmail]
    );

    let userId;
    let publicId;
    if (existingRows[0]) {
      if (!existingRows[0].demo_user_id) {
        throw new Error('Refusing to replace an existing customer with the configured demo email.');
      }
      userId = existingRows[0].id;
      publicId = existingRows[0].public_id;
      await connection.execute(
        `UPDATE users
            SET display_name = ?, status = 'active', failed_login_count = 0,
                locked_until = NULL, deactivated_at = NULL, password_hash = ?,
                password_changed_at = UTC_TIMESTAMP(3)
          WHERE id = ?`,
        [LOCAL_DEMO_DISPLAY_NAME, passwordHash, userId]
      );
    } else {
      publicId = randomUUID();
      const [insert] = await connection.execute(
        `INSERT INTO users
          (public_id, email, email_normalized, display_name, password_hash, status, password_changed_at)
         VALUES (?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP(3))`,
        [publicId, normalizedEmail, normalizedEmail, LOCAL_DEMO_DISPLAY_NAME, passwordHash]
      );
      userId = insert.insertId;
      await connection.execute(
        'INSERT INTO local_demo_accounts (singleton_id, user_id) VALUES (1, ?)',
        [userId]
      );
    }

    await connection.execute(
      `UPDATE auth_sessions
          SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(3)),
              revocation_reason = COALESCE(revocation_reason, 'demo_reprovisioned')
        WHERE user_id = ?`,
      [userId]
    );
    await connection.execute(
      `UPDATE password_reset_tokens
          SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(3))
        WHERE user_id = ? AND used_at IS NULL`,
      [userId]
    );

    await connection.execute(
      `INSERT IGNORE INTO user_preferences (user_id, language, theme, default_payment)
       VALUES (?, 'en', 'light', 'cod')`,
      [userId]
    );
    await connection.execute(
      'INSERT IGNORE INTO carts (public_id, user_id) VALUES (?, ?)',
      [randomUUID(), userId]
    );
    await connection.execute(
      'INSERT IGNORE INTO wishlists (public_id, user_id) VALUES (?, ?)',
      [randomUUID(), userId]
    );
    await connection.commit();
    return { id: userId, publicId, email: normalizedEmail };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
