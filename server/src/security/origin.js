import { config } from '../config.js';
import { forbidden } from '../http/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const BACK4APP_HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.b4a\.run$/i;

function dynamicBack4AppOrigin(req, origin) {
  // Back4App's managed CloudFront edge guarantees public HTTPS, but its
  // internal hop reports X-Forwarded-Proto=http. Disabling the redundant
  // application redirect is the deployment's explicit assertion that this
  // managed edge owns HTTPS, so treat that topology as secure here too.
  const managedHttpsEdge = config.isProduction && config.tlsTerminatedByProxy &&
    !config.enforceProxyHttpsRedirect;
  if (!config.back4appDynamicOrigin || typeof origin !== 'string' ||
      (!req.secure && !managedHttpsEdge)) return null;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  const requestHostname = String(req.hostname || '').toLowerCase();
  if (parsed.origin !== origin || parsed.protocol !== 'https:' || parsed.port ||
      !BACK4APP_HOST_PATTERN.test(requestHostname) || parsed.hostname.toLowerCase() !== requestHostname) {
    return null;
  }
  return parsed.origin;
}

export function trustedRequestOrigin(req, origin = req.get('origin')) {
  if (typeof origin !== 'string' || !origin) return null;
  if (config.allowedOrigins.has(origin)) return origin;
  return dynamicBack4AppOrigin(req, origin);
}

export function passwordResetUrlForRequest(req) {
  const currentBack4AppOrigin = dynamicBack4AppOrigin(req, req.get('origin'));
  return currentBack4AppOrigin
    ? `${currentBack4AppOrigin}/reset-password.html`
    : config.auth.resetUrl;
}

export function requireTrustedOrigin(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!trustedRequestOrigin(req)) {
    return next(forbidden('ORIGIN_REJECTED', 'The request origin is not allowed.'));
  }
  return next();
}
