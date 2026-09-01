import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const loginScriptUrl = new URL('../../../js/login.js', import.meta.url);
const loginHtmlUrl = new URL('../../../login.html', import.meta.url);

describe('customer login production experience', () => {
  it('keeps real sign-in, registration, and account recovery visible', async () => {
    const html = await readFile(loginHtmlUrl, 'utf8');

    expect(html).toContain('id="loginForm"');
    expect(html).toContain('id="signupForm"');
    expect(html).toContain('id="forgotForm"');
    expect(html).toContain('id="toSignup"');
    expect(html).toContain('id="toForgot"');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain('autocomplete="new-password"');
    expect(html).toMatch(/id="loginPass"[^>]*required maxlength="128"/);
    expect(html).not.toMatch(/id="loginPass"[^>]*minlength="12"/);
    expect(html.match(/v=20260901-motion-polish/g)).toHaveLength(4);

    expect(html).not.toContain('demoLoginNotice');
    expect(html).not.toMatch(/local demo|any non-empty email|no real customer account/i);
  });

  it('always submits customer credentials through the real authentication routes', async () => {
    const source = await readFile(loginScriptUrl, 'utf8');

    expect(source).toContain('StoreAPI.auth.login({ email, password })');
    expect(source).toContain('StoreAPI.auth.register({ displayName, email, password, language: getLang() })');
    expect(source).toContain('StoreAPI.auth.requestPasswordReset({ email })');
    expect(source).toContain("if (!password.length || password.length > 128)");
    expect(source).toContain('if (password.length < 12 || password.length > 128)');
    expect(source).not.toContain('StoreAPI.auth.demoLogin');
    expect(source).not.toContain('localDemoLoginEnabled');
    expect(source).not.toContain('applyLocalDemoCapability');
    expect(source).not.toContain('applyLocalDemoPresentation');
    expect(source).not.toMatch(/demo account|local demo|démo locale/i);
  });

  it('guides an existing customer back to sign-in without retrying registration', async () => {
    const source = await readFile(loginScriptUrl, 'utf8');

    expect(source).toContain("error?.code === 'EMAIL_ALREADY_REGISTERED'");
    expect(source).toContain("$('loginEmail').value = email");
    expect(source).toContain("showMode('login', true)");
    expect(source).toContain("showCopyAlert('emailExistsSignIn', 'warning', true)");
  });

  it('keeps authentication available when the browser does not expose Web Locks', async () => {
    const source = await readFile(loginScriptUrl, 'utf8');

    expect(source).toContain("if (!locks || typeof locks.request !== 'function') return work()");
    expect(source).toContain("if (!locks || typeof locks.request !== 'function') return mergeGuestCart()");
    expect(source).not.toContain('AUTH_LOCK_UNAVAILABLE');
  });
});
