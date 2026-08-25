import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { unauthorized } from '../http/errors.js';
import { randomToken, tokenDigest } from '../security/tokens.js';
import {
  adminSessionCookieName,
  clearAdminSessionCookie,
  setAdminCsrfCookie,
  setAdminSessionCookie
} from './cookies.js';

export async function createAdminSession(connection, adminId, res) {
  const token = randomToken();
  const csrfToken = randomToken();
  const absolute = new Date(Date.now() + config.auth.sessionTtlMs);
  const idle = new Date(Math.min(absolute.getTime(), Date.now() + config.auth.sessionIdleMs));

  await connection.execute(
    `INSERT INTO admin_sessions
      (public_id, admin_id, token_digest, csrf_digest, idle_expires_at, absolute_expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), adminId, tokenDigest(token), tokenDigest(csrfToken), idle, absolute]
  );
  setAdminSessionCookie(res, token);
  setAdminCsrfCookie(res, csrfToken);
  return { csrfToken };
}

export async function revokeCurrentAdminSession(req, res, reason = 'logout') {
  const rawToken = req.cookies?.[adminSessionCookieName];
  if (rawToken) {
    await req.app.locals.db.execute(
      `UPDATE admin_sessions
          SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(3)),
              revocation_reason = COALESCE(revocation_reason, ?)
        WHERE token_digest = ?`,
      [reason, tokenDigest(rawToken)]
    );
  }
  clearAdminSessionCookie(res);
}

export async function loadAdminSession(req, res, next) {
  try {
    const rawToken = req.cookies?.[adminSessionCookieName];
    if (!rawToken) {
      req.adminAuth = null;
      return next();
    }

    const [rows] = await req.app.locals.db.execute(
      `SELECT session.id AS session_id, session.admin_id, session.csrf_digest,
              identity.public_id, identity.email, identity.display_name, identity.role
         FROM admin_sessions session
         JOIN admin_identities identity ON identity.id = session.admin_id
        WHERE session.token_digest = ?
          AND session.revoked_at IS NULL
          AND session.idle_expires_at > UTC_TIMESTAMP(3)
          AND session.absolute_expires_at > UTC_TIMESTAMP(3)
          AND identity.status = 'active'
          AND (identity.locked_until IS NULL OR identity.locked_until <= UTC_TIMESTAMP(3))
        LIMIT 1`,
      [tokenDigest(rawToken)]
    );
    const row = rows[0];
    if (!row) {
      clearAdminSessionCookie(res);
      req.adminAuth = null;
      return next();
    }

    req.adminAuth = {
      sessionId: row.session_id,
      adminId: row.admin_id,
      csrfDigest: row.csrf_digest,
      admin: {
        id: row.public_id,
        email: row.email,
        displayName: row.display_name,
        role: row.role
      }
    };

    const idleSeconds = Math.floor(config.auth.sessionIdleMs / 1000);
    await req.app.locals.db.execute(
      `UPDATE admin_sessions
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

export function requireAdmin(req, _res, next) {
  if (!req.adminAuth) return next(unauthorized('Administrator authentication is required.'));
  return next();
}

export function requireAdminPage(req, res, next) {
  if (req.adminAuth) return next();
  const requested = String(req.params?.page || 'index.html').toLowerCase();
  res.set('Cache-Control', 'no-store');
  return res.redirect(302, `/admin/login.html?next=${encodeURIComponent(requested)}`);
}
