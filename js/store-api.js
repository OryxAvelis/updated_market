/**
 * AM MARKET storefront API client.
 *
 * Plain-browser, same-origin client for the MySQL-backed `/api/v1` service.
 * Authentication is carried exclusively by secure HTTP-only cookies. The CSRF
 * token is intentionally kept inside this closure and is never written to Web
 * Storage, cookies, URLs, or the DOM.
 */
(function initStoreAPI(global) {
  'use strict';

  const BASE_URL = '/api/v1';
  const DEFAULT_TIMEOUT_MS = 12_000;
  const LONG_TIMEOUT_MS = 20_000;
  const MIN_TIMEOUT_MS = 1_000;
  const MAX_TIMEOUT_MS = 30_000;
  const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
  const CSRF_ERROR_CODES = new Set(['CSRF_INVALID', 'CSRF_REQUIRED', 'CSRF_TOKEN_MISMATCH']);

  // Deliberately closure-scoped. Do not expose or persist this value.
  let csrfToken = null;
  let bootstrapPromise = null;
  let refreshPromise = null;

  class StoreAPIError extends Error {
    constructor(message, options = {}) {
      super(message || 'The request could not be completed.');
      this.name = 'StoreAPIError';
      this.status = Number(options.status) || 0;
      this.code = options.code || 'REQUEST_FAILED';
      this.fields = options.fields;
      this.details = options.details;
      this.requestId = options.requestId || null;
      this.retryAfter = options.retryAfter ?? null;
      this.retryable = options.retryable ?? (this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500);
      if (options.cause !== undefined) this.cause = options.cause;
    }

    toJSON() {
      return {
        name: this.name,
        message: this.message,
        status: this.status,
        code: this.code,
        fields: this.fields,
        details: this.details,
        requestId: this.requestId,
        retryAfter: this.retryAfter,
        retryable: this.retryable
      };
    }
  }

  function clientError(code, message, details) {
    return new StoreAPIError(message, { code, details, retryable: false });
  }

  function clampTimeout(value, fallback = DEFAULT_TIMEOUT_MS) {
    if (value == null) return fallback;
    const timeout = Math.floor(Number(value));
    if (!Number.isFinite(timeout)) throw clientError('INVALID_TIMEOUT', 'timeoutMs must be a finite number.');
    return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, timeout));
  }

  function encodeSegment(value, label) {
    const segment = String(value ?? '').trim();
    if (!segment) throw clientError('INVALID_ARGUMENT', `${label} is required.`);
    return encodeURIComponent(segment);
  }

  function withQuery(path, query) {
    if (!query || typeof query !== 'object') return path;
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value == null || value === '') return;
      const values = Array.isArray(value) ? value : [value];
      values.forEach((item) => {
        if (item == null || item === '') return;
        params.append(key, item instanceof Date ? item.toISOString() : String(item));
      });
    });
    const suffix = params.toString();
    return suffix ? `${path}?${suffix}` : path;
  }

  function createIdempotencyKey() {
    if (!global.crypto || typeof global.crypto.randomUUID !== 'function') {
      throw clientError('CRYPTO_UNAVAILABLE', 'This browser cannot create a secure idempotency key.');
    }
    return global.crypto.randomUUID();
  }

  function idempotencyKeyFrom(options = {}) {
    if (options.idempotencyKey == null) return createIdempotencyKey();
    const key = String(options.idempotencyKey).trim();
    if (key.length < 8 || key.length > 128) {
      throw clientError('INVALID_IDEMPOTENCY_KEY', 'Idempotency keys must contain between 8 and 128 characters.');
    }
    return key;
  }

  function createBoundedSignal(externalSignal, timeoutMs) {
    const controller = new AbortController();
    let timedOut = false;
    let externalAbortHandler = null;

    if (externalSignal != null && (
      typeof externalSignal !== 'object' ||
      typeof externalSignal.addEventListener !== 'function' ||
      typeof externalSignal.aborted !== 'boolean'
    )) {
      throw clientError('INVALID_ABORT_SIGNAL', 'signal must be an AbortSignal.');
    }

    if (externalSignal) {
      externalAbortHandler = () => controller.abort(externalSignal.reason);
      if (externalSignal.aborted) externalAbortHandler();
      else externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
    }

    const timeoutId = global.setTimeout(() => {
      timedOut = true;
      const reason = typeof DOMException === 'function'
        ? new DOMException('The request timed out.', 'TimeoutError')
        : new Error('The request timed out.');
      controller.abort(reason);
    }, timeoutMs);

    return {
      signal: controller.signal,
      didTimeOut: () => timedOut,
      cleanup() {
        global.clearTimeout(timeoutId);
        if (externalSignal && externalAbortHandler) {
          externalSignal.removeEventListener('abort', externalAbortHandler);
        }
      }
    };
  }

  function captureCsrf(payload) {
    if (!payload || typeof payload !== 'object') return;
    const candidate = payload.csrfToken || payload.csrf_token || payload.data?.csrfToken || payload.data?.csrf_token;
    if (typeof candidate === 'string' && candidate.trim()) csrfToken = candidate.trim();
  }

  function withoutCsrf(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const clean = { ...value };
    delete clean.csrfToken;
    delete clean.csrf_token;
    return clean;
  }

  function normalizeSuccess(payload) {
    captureCsrf(payload);
    if (!payload || typeof payload !== 'object') return payload;

    if (Object.prototype.hasOwnProperty.call(payload, 'data')) {
      const data = withoutCsrf(payload.data);
      if (Object.prototype.hasOwnProperty.call(payload, 'meta')) return { data, meta: payload.meta };
      return data;
    }
    return withoutCsrf(payload);
  }

  async function parseBody(response) {
    if (response.status === 204 || response.status === 205) return null;
    const text = await response.text();
    if (!text) return null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('json')) {
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new StoreAPIError('The server returned invalid JSON.', {
          status: response.status,
          code: 'INVALID_RESPONSE',
          requestId: response.headers.get('x-request-id'),
          retryable: response.status >= 500,
          cause: error
        });
      }
    }
    return text;
  }

  function retryAfterFrom(response) {
    const value = response.headers.get('retry-after');
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds);
    const date = Date.parse(value);
    return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000));
  }

  function responseError(response, payload) {
    const structured = payload && typeof payload === 'object' && payload.error && typeof payload.error === 'object'
      ? payload.error
      : {};
    const fallbackMessage = typeof payload === 'string' && payload.trim()
      ? payload.trim()
      : `Request failed with HTTP ${response.status}.`;
    return new StoreAPIError(structured.message || fallbackMessage, {
      status: response.status,
      code: structured.code || `HTTP_${response.status}`,
      fields: structured.fields,
      details: structured.details,
      requestId: structured.requestId || payload?.requestId || response.headers.get('x-request-id'),
      retryAfter: retryAfterFrom(response)
    });
  }

  async function rawRequest(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const timeoutMs = clampTimeout(options.timeoutMs, options.longTimeout ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
    const bounded = createBoundedSignal(options.signal, timeoutMs);
    try {
      const headers = new Headers({ Accept: 'application/json' });
      let body;

      if (options.body !== undefined) {
        headers.set('Content-Type', 'application/json');
        try {
          body = JSON.stringify(options.body);
        } catch (error) {
          throw new StoreAPIError('The request body could not be serialized.', {
            code: 'CLIENT_SERIALIZATION_ERROR',
            retryable: false,
            cause: error
          });
        }
      }

      if (options.csrf !== false && !SAFE_METHODS.has(method)) {
        if (!csrfToken) await bootstrap({ signal: options.signal, timeoutMs });
        if (!csrfToken) throw clientError('CSRF_TOKEN_MISSING', 'A CSRF token could not be established.');
        headers.set('X-CSRF-Token', csrfToken);
      }
      if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);

      const response = await global.fetch(`${BASE_URL}${path}`, {
        method,
        credentials: 'same-origin',
        headers,
        body,
        signal: bounded.signal,
        cache: options.cache || 'no-store'
      });
      const payload = await parseBody(response);
      if (!response.ok) throw responseError(response, payload);
      return normalizeSuccess(payload);
    } catch (error) {
      if (error instanceof StoreAPIError) throw error;
      if (bounded.didTimeOut()) {
        throw new StoreAPIError('The request timed out. Please try again.', {
          code: 'REQUEST_TIMEOUT',
          retryable: true,
          cause: error
        });
      }
      if (bounded.signal.aborted || options.signal?.aborted || error?.name === 'AbortError') {
        throw new StoreAPIError('The request was cancelled.', {
          code: 'REQUEST_ABORTED',
          retryable: false,
          cause: error
        });
      }
      throw new StoreAPIError('The server could not be reached.', {
        code: 'NETWORK_ERROR',
        retryable: true,
        cause: error
      });
    } finally {
      bounded.cleanup();
    }
  }

  async function bootstrap(options = {}) {
    const load = () => rawRequest('/auth/session', {
      method: 'GET',
      csrf: false,
      cache: 'no-store',
      signal: options.signal,
      timeoutMs: options.timeoutMs
    });

    if (options.force || options.signal) return load();
    if (!bootstrapPromise) {
      bootstrapPromise = load().finally(() => { bootstrapPromise = null; });
    }
    return bootstrapPromise;
  }

  async function refreshCsrf(options = {}) {
    const load = async () => {
      csrfToken = null;
      await rawRequest('/auth/csrf', {
        method: 'GET',
        csrf: false,
        cache: 'no-store',
        signal: options.signal,
        timeoutMs: options.timeoutMs
      });
      if (!csrfToken) throw clientError('CSRF_TOKEN_MISSING', 'The server did not provide a CSRF token.');
    };

    if (options.signal) return load();
    if (!refreshPromise) {
      refreshPromise = load().finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
  }

  async function request(path, options = {}) {
    try {
      return await rawRequest(path, options);
    } catch (error) {
      if (!(error instanceof StoreAPIError) || error.status !== 403 || !CSRF_ERROR_CODES.has(error.code) || options.csrf === false || options.csrfRetried) {
        throw error;
      }

      // Refresh exactly once. Non-retryable operations (notably checkout) fail
      // closed after refresh so UI code can ask the customer to submit again
      // with the same caller-owned Idempotency-Key.
      await refreshCsrf({ signal: options.signal, timeoutMs: options.timeoutMs });
      if (options.retryCsrf === false) throw error;
      return rawRequest(path, { ...options, csrfRetried: true });
    }
  }

  function read(path, query, options = {}) {
    return request(withQuery(path, query), {
      method: 'GET',
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      longTimeout: options.longTimeout,
      cache: options.cache
    });
  }

  function write(method, path, body, options = {}) {
    const idempotencyKey = options.idempotent === false ? undefined : idempotencyKeyFrom(options);
    return request(path, {
      method,
      body,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      longTimeout: options.longTimeout,
      idempotencyKey,
      retryCsrf: options.retryCsrf
    });
  }

  const auth = Object.freeze({
    session: (options) => bootstrap({ ...(options || {}), force: true }),
    register: (input, options) => write('POST', '/auth/register', input, options),
    login: (input, options) => write('POST', '/auth/login', input, options),
    logout: async (options) => {
      try {
        return await write('POST', '/auth/logout', {}, options);
      } finally {
        csrfToken = null;
      }
    },
    requestPasswordReset: (input, options) => write('POST', '/auth/password-reset/request', input, options),
    confirmPasswordReset: (input, options) => write('POST', '/auth/password-reset/confirm', input, options),
    changePassword: (input, options) => write('POST', '/auth/password/change', input, options)
  });

  const profile = Object.freeze({
    get: (options) => read('/me', null, options),
    update: (input, options) => write('PATCH', '/me', input, options),
    deactivate: (input = {}, options) => write('DELETE', '/me', input, { ...(options || {}), retryCsrf: false })
  });

  const preferences = Object.freeze({
    get: (options) => read('/me/preferences', null, options),
    update: (input, options) => write('PATCH', '/me/preferences', input, options)
  });

  const addresses = Object.freeze({
    list: (options) => read('/me/addresses', null, options),
    create: (input, options) => write('POST', '/me/addresses', input, options),
    update: (publicId, input, options) => write('PATCH', `/me/addresses/${encodeSegment(publicId, 'address ID')}`, input, options),
    remove: (publicId, options) => write('DELETE', `/me/addresses/${encodeSegment(publicId, 'address ID')}`, undefined, options),
    setDefault: (publicId, options) => write('PUT', `/me/addresses/${encodeSegment(publicId, 'address ID')}/default`, {}, options)
  });

  const cart = Object.freeze({
    get: (options) => read('/cart', null, options),
    addItem: (input, options) => write('POST', '/cart/items', input, options),
    updateItem: (productId, input, options) => write('PUT', `/cart/items/${encodeSegment(productId, 'product ID')}`, input, options),
    removeItem: (productId, options) => write('DELETE', `/cart/items/${encodeSegment(productId, 'product ID')}`, undefined, options),
    clear: (options) => write('DELETE', '/cart', undefined, { ...(options || {}), retryCsrf: false }),
    mergeGuest: (input, options) => write('POST', '/cart/merge', input, options)
  });

  const wishlist = Object.freeze({
    get: (options) => read('/wishlist', null, options),
    addItem: (input, options) => write('POST', '/wishlist/items', input, options),
    removeItem: (productId, options) => write('DELETE', `/wishlist/items/${encodeSegment(productId, 'product ID')}`, undefined, options),
    mergeGuest: (input, options) => write('POST', '/wishlist/merge', input, options)
  });

  const orders = Object.freeze({
    list: (query, options) => read('/orders', query, options),
    get: (publicId, options) => read(`/orders/${encodeSegment(publicId, 'order ID')}`, null, options),
    create: (input, options = {}) => write('POST', '/orders', input, {
      ...options,
      longTimeout: true,
      retryCsrf: false
    }),
    cancel: (publicId, input = {}, options) => write('POST', `/orders/${encodeSegment(publicId, 'order ID')}/cancel`, input, options),
    tracking: (publicId, options) => read(`/orders/${encodeSegment(publicId, 'order ID')}/tracking`, null, options),
    requestReturn: (publicId, input, options) => write('POST', `/orders/${encodeSegment(publicId, 'order ID')}/returns`, input, options)
  });

  const returns = Object.freeze({
    get: (publicId, options) => read(`/returns/${encodeSegment(publicId, 'return ID')}`, null, options)
  });

  const reviews = Object.freeze({
    listForProduct: (productId, query, options) => read(`/catalog/products/${encodeSegment(productId, 'product ID')}/reviews`, query, options),
    createForProduct: (productId, input, options) => write('POST', `/catalog/products/${encodeSegment(productId, 'product ID')}/reviews`, input, options),
    update: (publicId, input, options) => write('PATCH', `/reviews/${encodeSegment(publicId, 'review ID')}`, input, options),
    remove: (publicId, options) => write('DELETE', `/reviews/${encodeSegment(publicId, 'review ID')}`, undefined, options),
    listMine: (query, options) => read('/me/reviews', query, options)
  });

  const recent = Object.freeze({
    list: (query, options) => read('/me/recently-viewed', query, options),
    record: (input, options) => write('POST', '/me/recently-viewed', input, options),
    clear: (options) => write('DELETE', '/me/recently-viewed', undefined, { ...(options || {}), retryCsrf: false })
  });

  const search = Object.freeze({
    history: (query, options) => read('/me/search-history', query, options),
    record: (input, options) => write('POST', '/me/search-history', input, options),
    clearHistory: (options) => write('DELETE', '/me/search-history', undefined, { ...(options || {}), retryCsrf: false }),
    suggestions: (query, options) => read('/catalog/search/suggestions', { q: query }, options)
  });

  const notifications = Object.freeze({
    list: (query, options) => read('/notifications', query, options),
    markRead: (publicId, options) => write('PATCH', `/notifications/${encodeSegment(publicId, 'notification ID')}/read`, {}, options),
    markAllRead: (options) => write('POST', '/notifications/read-all', {}, options)
  });

  const lowStock = Object.freeze({
    list: (options) => read('/me/low-stock-subscriptions', null, options),
    get: (productId, options) => read(`/me/low-stock-subscriptions/${encodeSegment(productId, 'product ID')}`, null, options),
    subscribe: (productId, options) => write('POST', '/me/low-stock-subscriptions', { productId: String(productId) }, options),
    unsubscribe: (productId, options) => write('DELETE', `/me/low-stock-subscriptions/${encodeSegment(productId, 'product ID')}`, undefined, options)
  });

  const recommendations = Object.freeze({
    list: (query, options) => read('/me/recommendations', query, options)
  });

  const catalog = Object.freeze({
    categories: (query, options) => read('/catalog/categories', query, { ...(options || {}), longTimeout: true }),
    products: (query, options) => read('/catalog/products', query, { ...(options || {}), longTimeout: true }),
    product: (productId, options) => read(`/catalog/products/${encodeSegment(productId, 'product ID')}`, null, { ...(options || {}), longTimeout: true })
  });

  global.StoreAPI = Object.freeze({
    baseUrl: BASE_URL,
    Error: StoreAPIError,
    isError: (value) => value instanceof StoreAPIError,
    createIdempotencyKey,
    bootstrap,
    auth,
    profile,
    preferences,
    addresses,
    cart,
    wishlist,
    orders,
    returns,
    reviews,
    recent,
    search,
    notifications,
    lowStock,
    recommendations,
    catalog
  });
})(window);
