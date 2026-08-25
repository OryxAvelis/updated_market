import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { forbidden } from '../http/errors.js';
import { hashPassword, passwordNeedsRehash, verifyPassword } from '../security/passwords.js';
import { emailSchema } from '../validation/common.js';
import { clearAdminCsrfCookie } from './cookies.js';
import { issueAdminCsrfToken } from './csrf.js';
import { createAdminSession, requireAdmin, revokeCurrentAdminSession } from './session.js';

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128)
}).strict();

function createAdminLoginLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again.' } }
  });
}

async function inTransaction(database, work) {
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

async function findAdminByEmail(database, email) {
  const [rows] = await database.execute(
    `SELECT id, public_id, email, email_normalized, display_name, password_hash,
            role, status, failed_login_count, locked_until
       FROM admin_identities
      WHERE email_normalized = ?
      LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

function serializeAdmin(identity) {
  return {
    id: identity.public_id,
    email: identity.email,
    displayName: identity.display_name,
    role: identity.role
  };
}

function isLoginAllowed(identity) {
  if (!identity || identity.status !== 'active') return false;
  if (!identity.locked_until) return true;
  return new Date(identity.locked_until).getTime() <= Date.now();
}

async function recordFailedLogin(database, identity) {
  if (!identity) return;
  await database.execute(
    `UPDATE admin_identities
        SET failed_login_count = LEAST(failed_login_count + 1, 1000),
            locked_until = CASE
              WHEN failed_login_count + 1 >= 5 THEN TIMESTAMPADD(MINUTE, 15, UTC_TIMESTAMP(3))
              ELSE locked_until
            END
      WHERE id = ?`,
    [identity.id]
  );
}

export function createAdminAuthRouter() {
  const router = Router();
  const loginLimiter = createAdminLoginLimiter();

  router.get('/auth/csrf', async (req, res) => {
    const csrfToken = await issueAdminCsrfToken(req, res);
    res.set('Cache-Control', 'no-store').json({ csrfToken });
  });

  router.get('/auth/session', async (req, res) => {
    const csrfToken = await issueAdminCsrfToken(req, res);
    res.set('Cache-Control', 'no-store').json(req.adminAuth
      ? { authenticated: true, admin: req.adminAuth.admin, csrfToken }
      : { authenticated: false, csrfToken });
  });

  router.get('/auth/me', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store').json({ admin: req.adminAuth.admin });
  });

  router.post('/auth/login', loginLimiter, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const identity = await findAdminByEmail(req.app.locals.db, input.email);
    const validPassword = await verifyPassword(identity?.password_hash, input.password);
    if (!validPassword || !isLoginAllowed(identity)) {
      await recordFailedLogin(req.app.locals.db, identity);
      throw forbidden('INVALID_ADMIN_CREDENTIALS', 'The email or password is incorrect.');
    }

    const upgradedHash = await passwordNeedsRehash(identity.password_hash)
      ? await hashPassword(input.password)
      : null;
    await revokeCurrentAdminSession(req, res, 'replaced');
    const session = await inTransaction(req.app.locals.db, async (connection) => {
      await connection.execute(
        `UPDATE admin_identities
            SET failed_login_count = 0,
                locked_until = NULL,
                last_login_at = UTC_TIMESTAMP(3),
                password_hash = COALESCE(?, password_hash)
          WHERE id = ? AND status = 'active'`,
        [upgradedHash, identity.id]
      );
      return createAdminSession(connection, identity.id, res);
    });

    res.set('Cache-Control', 'no-store').json({
      authenticated: true,
      admin: serializeAdmin(identity),
      csrfToken: session.csrfToken
    });
  });

  router.post('/auth/logout', async (req, res) => {
    await revokeCurrentAdminSession(req, res);
    clearAdminCsrfCookie(res);
    const csrfToken = await issueAdminCsrfToken(req, res);
    res.set('Cache-Control', 'no-store').json({ authenticated: false, csrfToken });
  });

  return router;
}
