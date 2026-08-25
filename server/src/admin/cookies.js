import { config } from '../config.js';

export const adminSessionCookieName = config.auth.secureCookies
  ? '__Host-am_admin_session'
  : 'am_admin_session';
export const adminCsrfCookieName = config.auth.secureCookies
  ? '__Host-am_admin_csrf'
  : 'am_admin_csrf';

const baseCookie = Object.freeze({
  secure: config.auth.secureCookies,
  sameSite: 'strict',
  path: '/'
});

export function setAdminSessionCookie(res, token) {
  res.cookie(adminSessionCookieName, token, {
    ...baseCookie,
    httpOnly: true,
    maxAge: config.auth.sessionTtlMs,
    priority: 'high'
  });
}

export function clearAdminSessionCookie(res) {
  res.clearCookie(adminSessionCookieName, {
    ...baseCookie,
    httpOnly: true,
    priority: 'high'
  });
}

export function setAdminCsrfCookie(res, token) {
  res.cookie(adminCsrfCookieName, token, {
    ...baseCookie,
    httpOnly: false,
    maxAge: config.auth.sessionTtlMs,
    priority: 'high'
  });
}

export function clearAdminCsrfCookie(res) {
  res.clearCookie(adminCsrfCookieName, {
    ...baseCookie,
    httpOnly: false,
    priority: 'high'
  });
}
