/**
 * AM MARKET admin authentication adapter.
 * Frontend-only prototype: this is not secure authentication.
 */
(() => {
  'use strict';

  const SESSION_KEY = 'am_admin_session';

  // DEMO ONLY — frontend prototype, no backend, replace before any real deployment
  const DEMO_EMAIL = 'AMMarkets@gmail.com';
  const DEMO_PASSWORD = 'ammarkets_adminal';

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function createSession() {
    const session = {
      version: 1,
      email: DEMO_EMAIL,
      createdAt: new Date().toISOString()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function getSession() {
    try {
      const session = JSON.parse(localStorage.getItem(SESSION_KEY));
      const valid = session
        && session.version === 1
        && normalizeEmail(session.email) === normalizeEmail(DEMO_EMAIL)
        && !Number.isNaN(Date.parse(session.createdAt));
      if (valid) return session;
    } catch { /* invalid prototype session is cleared below */ }
    localStorage.removeItem(SESSION_KEY);
    return null;
  }

  function login(email, password) {
    const valid = normalizeEmail(email) === normalizeEmail(DEMO_EMAIL)
      && String(password || '') === DEMO_PASSWORD;
    if (!valid) return { ok: false, session: null };
    return { ok: true, session: createSession() };
  }

  function isAuthenticated() {
    return Boolean(getSession());
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
  }

  window.AdminAuth = Object.freeze({
    SESSION_KEY,
    login,
    getSession,
    isAuthenticated,
    logout
  });
})();
