import { config } from '../config.js';
import { forbidden } from '../http/errors.js';
import { csrfCookieName, setCsrfCookie } from './cookies.js';
import { randomToken, safeTokenEqual, tokenDigest } from './tokens.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function issueCsrfToken(res) {
  const token = randomToken();
  setCsrfCookie(res, token);
  return token;
}

export async function issueSessionCsrfToken(req, res) {
  const token = issueCsrfToken(res);
  if (req.auth?.sessionId) {
    await req.app.locals.db.execute(
      'UPDATE auth_sessions SET csrf_digest = ? WHERE id = ? AND revoked_at IS NULL',
      [tokenDigest(token), req.auth.sessionId]
    );
    req.auth.csrfDigest = tokenDigest(token);
  }
  return token;
}

export function requireCsrf(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const fromCookie = req.cookies?.[csrfCookieName];
  const fromHeader = req.get('x-csrf-token');
  if (!safeTokenEqual(fromCookie, fromHeader)) {
    return next(forbidden('CSRF_INVALID', 'The security token is missing or expired.'));
  }

  if (req.auth?.csrfDigest) {
    const actual = tokenDigest(fromHeader);
    const expected = Buffer.from(req.auth.csrfDigest);
    if (actual.length !== expected.length || !actual.equals(expected)) {
      return next(forbidden('CSRF_INVALID', 'The security token is missing or expired.'));
    }
  }
  return next();
}

export function csrfCookieForRequest(req) {
  return req.cookies?.[csrfCookieName];
}

export function csrfConfiguration() {
  return {
    header: 'X-CSRF-Token',
    cookie: csrfCookieName,
    secure: config.auth.secureCookies
  };
}
