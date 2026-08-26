import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { unauthorized } from '../http/errors.js';
import { clearSessionCookie, setCsrfCookie, setSessionCookie } from '../security/cookies.js';
import { randomToken, tokenDigest } from '../security/tokens.js';

function supportedPaymentPreference(value) {
  return ['cod', 'wafacash', 'cashplus'].includes(value) ? value : 'cod';
}

export async function createSession(connection, userId, res) {
  const token = randomToken();
  const csrfToken = randomToken();
  const sessionId = randomUUID();
  const absolute = new Date(Date.now() + config.auth.sessionTtlMs);
  const idle = new Date(Math.min(absolute.getTime(), Date.now() + config.auth.sessionIdleMs));

  await connection.execute(
    `INSERT INTO auth_sessions
      (public_id, user_id, token_digest, csrf_digest, idle_expires_at, absolute_expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [sessionId, userId, tokenDigest(token), tokenDigest(csrfToken), idle, absolute]
  );

  setSessionCookie(res, token);
  setCsrfCookie(res, csrfToken);
  return { csrfToken, sessionPublicId: sessionId };
}

export async function revokeCurrentSession(req, res) {
  const rawToken = req.cookies?.[config.auth.cookieName];
  if (rawToken) {
    await req.app.locals.db.execute(
      'UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(3)) WHERE token_digest = ?',
      [tokenDigest(rawToken)]
    );
  }
  clearSessionCookie(res);
}

export async function loadSession(req, res, next) {
  try {
    const rawToken = req.cookies?.[config.auth.cookieName];
    if (!rawToken) {
      req.auth = null;
      return next();
    }

    const [rows] = await req.app.locals.db.execute(
      `SELECT s.id AS session_id, s.public_id AS session_public_id, s.user_id,
              s.csrf_digest, s.absolute_expires_at,
              u.public_id AS user_public_id, u.email, u.display_name, u.phone_e164,
              CASE WHEN demo.user_id IS NULL THEN 'customer' ELSE 'local_demo' END AS account_kind,
              u.status, u.email_verified_at,
              environment.environment_kind,
              p.language, p.theme, p.default_payment, p.order_notifications,
              p.low_stock_notifications, p.personalization_enabled
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN local_demo_accounts demo ON demo.user_id = u.id
         LEFT JOIN application_environment environment ON environment.singleton_id = 1
         LEFT JOIN user_preferences p ON p.user_id = u.id
        WHERE s.token_digest = ?
          AND s.revoked_at IS NULL
          AND s.idle_expires_at > UTC_TIMESTAMP(3)
          AND s.absolute_expires_at > UTC_TIMESTAMP(3)
          AND u.status = 'active'
        LIMIT 1`,
      [tokenDigest(rawToken)]
    );

    const row = rows[0];
    if (!row) {
      clearSessionCookie(res);
      req.auth = null;
      return next();
    }

    if (row.account_kind === 'local_demo' &&
        (!config.auth.localDevLoginEnabled || row.environment_kind !== 'local_development')) {
      await req.app.locals.db.execute(
        `UPDATE auth_sessions
            SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(3)),
                revocation_reason = COALESCE(revocation_reason, ?)
          WHERE id = ?`,
        [config.auth.localDevLoginEnabled ? 'demo_database_unattested' : 'demo_disabled', row.session_id]
      );
      clearSessionCookie(res);
      req.auth = null;
      return next();
    }

    req.auth = {
      sessionId: row.session_id,
      sessionPublicId: row.session_public_id,
      userId: row.user_id,
      accountKind: row.account_kind,
      csrfDigest: row.csrf_digest,
      user: {
        id: row.user_public_id,
        email: row.email,
        displayName: row.display_name,
        phone: row.phone_e164,
        emailVerified: Boolean(row.email_verified_at),
        preferences: {
          language: row.language || 'en',
          theme: row.theme || 'light',
          defaultPayment: supportedPaymentPreference(row.default_payment),
          orderNotifications: Boolean(row.order_notifications ?? true),
          lowStockNotifications: Boolean(row.low_stock_notifications ?? true),
          personalizationEnabled: Boolean(row.personalization_enabled ?? true)
        }
      }
    };

    const idleSeconds = Math.floor(config.auth.sessionIdleMs / 1000);
    await req.app.locals.db.execute(
      `UPDATE auth_sessions
          SET last_seen_at = UTC_TIMESTAMP(3),
              idle_expires_at = LEAST(absolute_expires_at, TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)))
        WHERE id = ?`,
      [idleSeconds, row.session_id]
    );
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireAuth(req, _res, next) {
  if (!req.auth) return next(unauthorized());
  return next();
}
