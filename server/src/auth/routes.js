import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { createMailService } from '../email/mailer.js';
import { conflict, forbidden, unavailable } from '../http/errors.js';
import { logger } from '../logger.js';
import { clearCsrfCookie, clearSessionCookie } from '../security/cookies.js';
import { issueCsrfToken, issueSessionCsrfToken } from '../security/csrf.js';
import { hashPassword, passwordNeedsRehash, verifyPassword } from '../security/passwords.js';
import { randomToken, tokenDigest } from '../security/tokens.js';
import { displayNameSchema, emailSchema, optionalPhoneSchema, passwordSchema } from '../validation/common.js';
import { createSession, requireAuth, revokeCurrentSession } from './session.js';
import { isLocalDemoEmail } from './local-demo.js';

const registerSchema = z.object({
  displayName: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
  language: z.enum(['en', 'fr']).default('en')
}).strict();

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128)
}).strict();

const localDemoLoginSchema = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128)
}).strict();

const resetRequestSchema = z.object({ email: emailSchema }).strict();
const resetConfirmSchema = z.object({ token: z.string().min(32).max(256), newPassword: passwordSchema }).strict();
const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema
}).strict();
const RESET_RESPONSE_FLOOR_MS = 350;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createAuthLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 12,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again.' } }
  });
}

function createResetLimiter() {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 6,
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

function serializeUser(row) {
  return {
    id: row.public_id,
    email: row.email,
    displayName: row.display_name,
    phone: row.phone_e164,
    emailVerified: Boolean(row.email_verified_at)
  };
}

async function findUserByEmail(database, email) {
  const [rows] = await database.execute(
    `SELECT u.id, u.public_id, u.email, u.email_normalized, u.display_name, u.phone_e164,
            u.password_hash,
            CASE WHEN demo.user_id IS NULL THEN 'customer' ELSE 'local_demo' END AS account_kind,
            u.status, u.email_verified_at
       FROM users u
       LEFT JOIN local_demo_accounts demo ON demo.user_id = u.id
      WHERE u.email_normalized = ?
      LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

async function findLocalDemoUser(database, email) {
  const [rows] = await database.execute(
    `SELECT u.id, u.public_id, u.email, u.email_normalized, u.display_name, u.phone_e164,
            u.password_hash, 'local_demo' AS account_kind, u.status, u.email_verified_at
       FROM users u
       JOIN local_demo_accounts demo
         ON demo.user_id = u.id
        AND demo.singleton_id = 1
       JOIN application_environment environment
         ON environment.singleton_id = 1
        AND environment.environment_kind = 'local_development'
      WHERE u.email_normalized = ?
      LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

async function replaceUserSession(req, res, user) {
  await revokeCurrentSession(req, res);
  return inTransaction(req.app.locals.db, async (connection) => {
    await connection.execute(
      `UPDATE auth_sessions
          SET revoked_at = UTC_TIMESTAMP(3)
        WHERE user_id = ? AND revoked_at IS NULL
        ORDER BY created_at DESC
        LIMIT 100`,
      [user.id]
    );
    return createSession(connection, user.id, res);
  });
}

function authenticatedResponse(user, session, extra = {}) {
  return {
    user: { ...serializeUser(user) },
    csrfToken: session.csrfToken,
    ...extra
  };
}

export function createAuthRouter({ mailService = createMailService() } = {}) {
  const router = Router();
  // A router instance owns its limiter stores. This keeps independently
  // created app instances isolated while preserving one shared limit in each
  // real server process.
  const authLimiter = createAuthLimiter();
  const resetLimiter = createResetLimiter();

  router.get('/csrf', async (req, res) => {
    const csrfToken = await issueSessionCsrfToken(req, res);
    res.set('Cache-Control', 'no-store').json({ csrfToken });
  });

  router.get('/session', async (req, res) => {
    const csrfToken = await issueSessionCsrfToken(req, res);
    const session = req.auth
      ? { authenticated: true, user: req.auth.user, csrfToken }
      : { authenticated: false, csrfToken };
    res.set('Cache-Control', 'no-store').json({
      ...session,
      capabilities: { localDemoLogin: config.auth.localDevLoginEnabled }
    });
  });

  router.post('/register', authLimiter, async (req, res) => {
    const input = registerSchema.parse(req.body);
    if (isLocalDemoEmail(input.email)) {
      throw conflict('EMAIL_RESERVED', 'This email domain is reserved for the local demo account.');
    }
    const passwordHash = await hashPassword(input.password);
    const userPublicId = randomUUID();

    let result;
    try {
      result = await inTransaction(req.app.locals.db, async (connection) => {
        const [insert] = await connection.execute(
          `INSERT INTO users
            (public_id, email, email_normalized, display_name, password_hash, status, password_changed_at)
           VALUES (?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP(3))`,
          [userPublicId, input.email, input.email, input.displayName, passwordHash]
        );
        const userId = insert.insertId;
        await connection.execute(
          `INSERT INTO user_preferences (user_id, language, theme, default_payment)
           VALUES (?, ?, 'light', 'cod')`,
          [userId, input.language]
        );
        await connection.execute('INSERT INTO carts (public_id, user_id) VALUES (?, ?)', [randomUUID(), userId]);
        await connection.execute('INSERT INTO wishlists (public_id, user_id) VALUES (?, ?)', [randomUUID(), userId]);
        const session = await createSession(connection, userId, res);
        return { userId, session };
      });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        throw conflict('EMAIL_ALREADY_REGISTERED', 'An account already exists for this email address.');
      }
      throw error;
    }

    res.status(201).set('Cache-Control', 'no-store').json({
      user: {
        id: userPublicId,
        email: input.email,
        displayName: input.displayName,
        phone: null,
        emailVerified: false,
        preferences: {
          language: input.language,
          theme: 'light',
          defaultPayment: 'cod',
          orderNotifications: true,
          lowStockNotifications: true,
          personalizationEnabled: true
        }
      },
      csrfToken: result.session.csrfToken
    });
  });

  router.post('/login', authLimiter, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = isLocalDemoEmail(input.email)
      ? null
      : await findUserByEmail(req.app.locals.db, input.email);
    const passwordUser = user?.account_kind === 'customer' ? user : null;
    const valid = await verifyPassword(passwordUser?.password_hash, input.password);
    if (!valid || !passwordUser || passwordUser.status !== 'active') {
      throw forbidden('INVALID_CREDENTIALS', 'The email or password is incorrect.');
    }

    if (await passwordNeedsRehash(passwordUser.password_hash)) {
      const upgraded = await hashPassword(input.password);
      await req.app.locals.db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [upgraded, passwordUser.id]);
    }

    const session = await replaceUserSession(req, res, passwordUser);
    res.set('Cache-Control', 'no-store').json(authenticatedResponse(passwordUser, session));
  });

  if (config.auth.localDevLoginEnabled) {
    router.post('/demo-login', authLimiter, async (req, res) => {
      localDemoLoginSchema.parse(req.body);
      const user = await findLocalDemoUser(req.app.locals.db, config.auth.localDevLoginUserEmail);
      if (!user || user.status !== 'active') {
        throw unavailable('LOCAL_DEV_LOGIN_UNAVAILABLE', 'The local demo account is unavailable.');
      }
      const session = await replaceUserSession(req, res, user);
      res.set('Cache-Control', 'no-store').json(authenticatedResponse(user, session, { localDemo: true }));
    });
  }

  router.post('/logout', async (req, res) => {
    await revokeCurrentSession(req, res);
    clearCsrfCookie(res);
    const csrfToken = issueCsrfToken(res);
    res.set('Cache-Control', 'no-store').json({ authenticated: false, csrfToken });
  });

  router.post('/password-reset/request', resetLimiter, async (req, res) => {
    const startedAt = performance.now();
    const input = resetRequestSchema.parse(req.body);
    const user = isLocalDemoEmail(input.email)
      ? null
      : await findUserByEmail(req.app.locals.db, input.email);
    const token = randomToken();
    const digest = tokenDigest(token);
    if (user?.status === 'active' && user.account_kind === 'customer') {
      const tokenPublicId = randomUUID();
      const expiresAt = new Date(Date.now() + config.auth.resetTtlMs);
      await inTransaction(req.app.locals.db, async (connection) => {
        await connection.execute(
          `UPDATE password_reset_tokens
              SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(3))
            WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
          [user.id]
        );
        await connection.execute(
          `INSERT INTO password_reset_tokens (public_id, user_id, token_digest, expires_at)
           VALUES (?, ?, ?, ?)`,
          [tokenPublicId, user.id, digest, expiresAt]
        );
      });
      void (async () => {
        try {
          const delivered = await mailService.sendPasswordReset({
            to: user.email,
            displayName: user.display_name,
            token
          });
          if (delivered) return;
          await req.app.locals.db.execute(
            'UPDATE password_reset_tokens SET revoked_at = UTC_TIMESTAMP(3) WHERE public_id = ?',
            [tokenPublicId]
          );
        } catch (error) {
          logger.error({ err: error, resetId: tokenPublicId }, 'Password-reset email delivery failed');
          try {
            await req.app.locals.db.execute(
              'UPDATE password_reset_tokens SET revoked_at = UTC_TIMESTAMP(3) WHERE public_id = ?',
              [tokenPublicId]
            );
          } catch (revokeError) {
            logger.error({ err: revokeError, resetId: tokenPublicId }, 'Could not revoke an undelivered password-reset token');
          }
        }
      })();
    } else {
      // Keep the unknown-account path close to the same database/crypto shape.
      // The fixed response floor below hides normal variance without delaying
      // email delivery, which continues outside the request timing channel.
      await req.app.locals.db.execute('SELECT SHA2(?, 256) AS digest', [digest.toString('hex')]);
    }

    const remaining = Math.max(0, RESET_RESPONSE_FLOOR_MS - (performance.now() - startedAt));
    if (remaining) await delay(remaining);
    res.status(202).json({ message: 'If an account exists, a reset link will be sent shortly.' });
  });

  router.post('/password-reset/confirm', resetLimiter, async (req, res) => {
    const input = resetConfirmSchema.parse(req.body);
    const newHash = await hashPassword(input.newPassword);
    const changed = await inTransaction(req.app.locals.db, async (connection) => {
      const [rows] = await connection.execute(
        `SELECT reset.id, reset.user_id
           FROM password_reset_tokens reset
           JOIN users u
             ON u.id = reset.user_id
            AND u.status = 'active'
           LEFT JOIN local_demo_accounts demo ON demo.user_id = u.id
          WHERE reset.token_digest = ?
            AND demo.user_id IS NULL
            AND reset.used_at IS NULL AND reset.revoked_at IS NULL
            AND reset.expires_at > UTC_TIMESTAMP(3)
          LIMIT 1 FOR UPDATE`,
        [tokenDigest(input.token)]
      );
      const reset = rows[0];
      if (!reset) return false;
      await connection.execute(
        `UPDATE users
            SET password_hash = ?, password_changed_at = UTC_TIMESTAMP(3)
          WHERE id = ? AND status = 'active'`,
        [newHash, reset.user_id]
      );
      await connection.execute(
        'UPDATE password_reset_tokens SET used_at = UTC_TIMESTAMP(3) WHERE id = ?',
        [reset.id]
      );
      await connection.execute(
        `UPDATE password_reset_tokens
            SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(3))
          WHERE user_id = ? AND id <> ? AND used_at IS NULL`,
        [reset.user_id, reset.id]
      );
      await connection.execute(
        'UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(3)) WHERE user_id = ?',
        [reset.user_id]
      );
      return true;
    });

    if (!changed) throw forbidden('RESET_TOKEN_INVALID', 'This reset link is invalid or expired.');
    clearSessionCookie(res);
    clearCsrfCookie(res);
    const csrfToken = issueCsrfToken(res);
    res.json({ message: 'Password changed successfully.', csrfToken });
  });

  router.post('/password/change', requireAuth, async (req, res) => {
    const input = passwordChangeSchema.parse(req.body);
    if (req.auth.accountKind === 'local_demo') {
      throw forbidden('DEMO_ACCOUNT_RESTRICTED', 'The local demo account password cannot be changed.');
    }
    const [rows] = await req.app.locals.db.execute(
      'SELECT password_hash FROM users WHERE id = ? AND status = \'active\' LIMIT 1',
      [req.auth.userId]
    );
    if (!rows[0] || !(await verifyPassword(rows[0].password_hash, input.currentPassword))) {
      throw forbidden('CURRENT_PASSWORD_INVALID', 'The current password is incorrect.');
    }
    const newHash = await hashPassword(input.newPassword);
    const session = await inTransaction(req.app.locals.db, async (connection) => {
      await connection.execute(
        'UPDATE users SET password_hash = ?, password_changed_at = UTC_TIMESTAMP(3) WHERE id = ?',
        [newHash, req.auth.userId]
      );
      await connection.execute(
        'UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(3)) WHERE user_id = ?',
        [req.auth.userId]
      );
      return createSession(connection, req.auth.userId, res);
    });
    res.set('Cache-Control', 'no-store').json({ message: 'Password changed successfully.', csrfToken: session.csrfToken });
  });

  return router;
}
