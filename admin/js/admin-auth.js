/**
 * AM MARKET administrator authentication client.
 *
 * Identity is established only by the server. The session token stays in a
 * secure HTTP-only cookie and the CSRF token remains closure-scoped.
 */
(() => {
  'use strict';

  const BASE_URL = '/api/v1/admin/auth';
  const TIMEOUT_MS = 12_000;
  let csrfToken = null;
  let session = null;
  let bootstrapPromise = null;

  class AdminAuthError extends Error {
    constructor(message, { status = 0, code = 'ADMIN_AUTH_FAILED', cause } = {}) {
      super(message || 'The administrator request could not be completed.');
      this.name = 'AdminAuthError';
      this.status = status;
      this.code = code;
      if (cause) this.cause = cause;
    }
  }

  function captureCsrf(payload) {
    if (typeof payload?.csrfToken === 'string' && payload.csrfToken) {
      csrfToken = payload.csrfToken;
    }
  }

  async function parseResponse(response) {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (cause) {
      throw new AdminAuthError('The server returned an invalid response.', {
        status: response.status,
        code: 'INVALID_RESPONSE',
        cause
      });
    }
  }

  async function request(path, { method = 'GET', body, retryCsrf = true } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (method !== 'GET' && method !== 'HEAD' && csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }
      const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        credentials: 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      const payload = await parseResponse(response);
      captureCsrf(payload);

      if (!response.ok) {
        const error = new AdminAuthError(payload?.error?.message || 'The administrator request failed.', {
          status: response.status,
          code: payload?.error?.code || 'ADMIN_AUTH_FAILED'
        });
        if (retryCsrf && error.code === 'ADMIN_CSRF_INVALID' && method !== 'GET' && method !== 'HEAD') {
          await bootstrap(true);
          return request(path, { method, body, retryCsrf: false });
        }
        throw error;
      }
      return payload;
    } catch (error) {
      if (error instanceof AdminAuthError) throw error;
      throw new AdminAuthError(
        error?.name === 'AbortError' ? 'The administrator request timed out.' : 'The administrator service is unavailable.',
        { code: error?.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR', cause: error }
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async function bootstrap(force = false) {
    if (force) bootstrapPromise = null;
    if (!bootstrapPromise) {
      bootstrapPromise = request('/session', { retryCsrf: false })
        .then((payload) => {
          session = payload?.authenticated ? payload.admin : null;
          return session;
        })
        .finally(() => { bootstrapPromise = null; });
    }
    return bootstrapPromise;
  }

  async function getSession() {
    return bootstrap();
  }

  async function login(email, password) {
    try {
      await bootstrap();
      const payload = await request('/login', {
        method: 'POST',
        body: { email: String(email || '').trim(), password: String(password || '') }
      });
      session = payload.admin;
      return { ok: true, session };
    } catch (error) {
      session = null;
      return { ok: false, session: null, error };
    }
  }

  async function logout() {
    try {
      await bootstrap();
      await request('/logout', { method: 'POST' });
    } finally {
      session = null;
    }
  }

  window.AdminAuth = Object.freeze({
    AdminAuthError,
    login,
    getSession,
    isAuthenticated: async () => Boolean(await getSession()),
    logout
  });
})();
