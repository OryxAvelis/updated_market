import { config } from '../config.js';

export const csrfCookieName = config.auth.secureCookies ? '__Host-am_csrf' : 'am_csrf';

const baseCookie = Object.freeze({
  secure: config.auth.secureCookies,
  sameSite: 'lax',
  path: '/'
});

export function setSessionCookie(res, token) {
  res.cookie(config.auth.cookieName, token, {
    ...baseCookie,
    httpOnly: true,
    maxAge: config.auth.sessionTtlMs,
    priority: 'high'
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(config.auth.cookieName, {
    ...baseCookie,
    httpOnly: true,
    priority: 'high'
  });
}

export function setCsrfCookie(res, token) {
  res.cookie(csrfCookieName, token, {
    ...baseCookie,
    httpOnly: false,
    maxAge: config.auth.sessionTtlMs,
    priority: 'high'
  });
}

export function clearCsrfCookie(res) {
  res.clearCookie(csrfCookieName, {
    ...baseCookie,
    httpOnly: false,
    priority: 'high'
  });
}
