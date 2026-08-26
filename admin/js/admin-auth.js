/**
 * AM MARKET administrator authentication client.
 *
 * Identity is established only by the server. The session token stays in a
 * secure HTTP-only cookie and the CSRF token remains closure-scoped.
 */
(() => {
  'use strict';

  const API_BASE_URL = '/api/v1/admin';
  const AUTH_BASE_URL = '/api/v1/admin/auth';
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

  function safePath(path) {
    const value = String(path || '');
    if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
      throw new AdminAuthError('The administrator request path is invalid.', {
        code: 'INVALID_REQUEST_PATH'
      });
    }
    return value;
  }

  async function requestFrom(baseUrl, path, { method = 'GET', body, retryCsrf = true } = {}) {
    const requestPath = safePath(path);
    const requestMethod = String(method || 'GET').toUpperCase();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (requestMethod !== 'GET' && requestMethod !== 'HEAD' && csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }
      const response = await fetch(`${baseUrl}${requestPath}`, {
        method: requestMethod,
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
        if (retryCsrf && error.code === 'ADMIN_CSRF_INVALID' && requestMethod !== 'GET' && requestMethod !== 'HEAD') {
          await bootstrap(true);
          return requestFrom(baseUrl, requestPath, { method: requestMethod, body, retryCsrf: false });
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

  function request(path, options) {
    return requestFrom(API_BASE_URL, path, options);
  }

  function authRequest(path, options) {
    return requestFrom(AUTH_BASE_URL, path, options);
  }

  async function bootstrap(force = false) {
    if (force) bootstrapPromise = null;
    if (!bootstrapPromise) {
      bootstrapPromise = authRequest('/session', { retryCsrf: false })
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
      const payload = await authRequest('/login', {
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
      await authRequest('/logout', { method: 'POST' });
    } finally {
      session = null;
    }
  }

  window.AdminAuth = Object.freeze({
    AdminAuthError,
    login,
    getSession,
    isAuthenticated: async () => Boolean(await getSession()),
    logout,
    request
  });
})();
