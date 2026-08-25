import { forbidden } from '../http/errors.js';
import { randomToken, safeTokenEqual, tokenDigest } from '../security/tokens.js';
import { adminCsrfCookieName, setAdminCsrfCookie } from './cookies.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function issueAdminCsrfToken(req, res) {
  const token = randomToken();
  const digest = tokenDigest(token);
  setAdminCsrfCookie(res, token);
  if (req.adminAuth?.sessionId) {
    await req.app.locals.db.execute(
      'UPDATE admin_sessions SET csrf_digest = ? WHERE id = ? AND revoked_at IS NULL',
      [digest, req.adminAuth.sessionId]
    );
    req.adminAuth.csrfDigest = digest;
  }
  return token;
}

export function requireAdminCsrf(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const fromCookie = req.cookies?.[adminCsrfCookieName];
  const fromHeader = req.get('x-csrf-token');
  if (!safeTokenEqual(fromCookie, fromHeader)) {
    return next(forbidden('ADMIN_CSRF_INVALID', 'The administrator security token is missing or expired.'));
  }

  if (req.adminAuth?.csrfDigest) {
    const actual = tokenDigest(fromHeader);
    const expected = Buffer.from(req.adminAuth.csrfDigest);
    if (actual.length !== expected.length || !actual.equals(expected)) {
      return next(forbidden('ADMIN_CSRF_INVALID', 'The administrator security token is missing or expired.'));
    }
  }
  return next();
}
