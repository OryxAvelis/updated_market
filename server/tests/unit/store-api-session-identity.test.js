import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const storeApiUrl = new URL('../../../js/store-api.js', import.meta.url);

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', date: new Date().toUTCString() }
  });
}

async function loadStoreApi(responses) {
  const events = new EventTarget();
  const fetch = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('Unexpected request');
    return typeof next === 'function' ? next() : next;
  });
  const window = {
    AbortController,
    clearTimeout,
    crypto: { randomUUID: () => '12345678-1234-4123-8123-123456789abc' },
    dispatchEvent: events.dispatchEvent.bind(events),
    fetch,
    setTimeout
  };
  const context = {
    AbortController,
    CustomEvent,
    DOMException,
    Headers,
    Response,
    URLSearchParams,
    clearTimeout,
    console,
    setTimeout,
    window
  };
  context.globalThis = context;
  const source = await readFile(storeApiUrl, 'utf8');
  vm.runInNewContext(source, context, { filename: 'js/store-api.js' });
  return { api: window.StoreAPI, events, fetch };
}

const session = (id, csrfToken) => jsonResponse({
  authenticated: true,
  user: { id, email: `${id}@example.test` },
  csrfToken
});

const csrfFailure = () => jsonResponse({
  error: { code: 'CSRF_TOKEN_MISMATCH', message: 'CSRF mismatch.' }
}, 403);

describe('StoreAPI cross-tab session identity guard', () => {
  it('establishes a session identity before the first protected mutation', async () => {
    const responses = [session('user-a', 'csrf-a'), jsonResponse({ preferences: { theme: 'dark' } })];
    const { api, fetch } = await loadStoreApi(responses);

    await expect(api.preferences.update({ theme: 'dark' })).resolves.toMatchObject({
      preferences: { theme: 'dark' }
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/auth/session',
      '/api/v1/me/preferences'
    ]);
  });

  it('fails closed instead of replaying a mutation after the account changes', async () => {
    const responses = [session('user-a', 'csrf-a'), csrfFailure(), session('user-b', 'csrf-b')];
    const { api, events, fetch } = await loadStoreApi(responses);
    const changed = vi.fn();
    events.addEventListener('am:session-changed', changed);

    await expect(api.preferences.update({ theme: 'dark' })).rejects.toMatchObject({
      status: 409,
      code: 'SESSION_CHANGED',
      retryable: false
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(changed).toHaveBeenCalledOnce();
  });

  it('replays once when CSRF rotates but the authenticated user is unchanged', async () => {
    const responses = [
      session('user-a', 'csrf-a'),
      csrfFailure(),
      session('user-a', 'csrf-a2'),
      jsonResponse({ preferences: { theme: 'dark' } })
    ];
    const { api, fetch } = await loadStoreApi(responses);

    await expect(api.preferences.update({ theme: 'dark' })).resolves.toMatchObject({
      preferences: { theme: 'dark' }
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('remembers the user returned by login without an extra session lookup', async () => {
    const responses = [
      jsonResponse({ authenticated: false, csrfToken: 'csrf-guest' }),
      jsonResponse({ user: { id: 'user-a' }, csrfToken: 'csrf-a' }),
      jsonResponse({ preferences: { theme: 'dark' } })
    ];
    const { api, fetch } = await loadStoreApi(responses);

    await api.auth.login({ email: 'a@example.test', password: 'long-enough-password' });
    await api.preferences.update({ theme: 'dark' });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/auth/session',
      '/api/v1/auth/login',
      '/api/v1/me/preferences'
    ]);
  });

  it('posts demo credentials to the demo endpoint and remembers its authenticated user', async () => {
    const responses = [
      jsonResponse({ authenticated: false, csrfToken: 'csrf-guest' }),
      jsonResponse({ user: { id: 'demo-user' }, csrfToken: 'csrf-demo', localDemo: true }),
      jsonResponse({ preferences: { theme: 'dark' } })
    ];
    const { api, fetch } = await loadStoreApi(responses);
    const credentials = { email: 'anything entered', password: 'anything entered' };

    await api.auth.demoLogin(credentials);
    await api.preferences.update({ theme: 'dark' });

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/auth/session',
      '/api/v1/auth/demo-login',
      '/api/v1/me/preferences'
    ]);
    const [, demoOptions] = fetch.mock.calls[1];
    expect(demoOptions.method).toBe('POST');
    expect(JSON.parse(demoOptions.body)).toEqual(credentials);
  });
});
