import { config } from '../config.js';
import { forbidden } from '../http/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireTrustedOrigin(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (!origin || !config.allowedOrigins.has(origin)) {
    return next(forbidden('ORIGIN_REJECTED', 'The request origin is not allowed.'));
  }
  return next();
}
