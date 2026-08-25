import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const loginUrl = new URL('../../../js/login.js', import.meta.url);
const loginHtmlUrl = new URL('../../../login.html', import.meta.url);

function testElement(overrides = {}) {
  const attributes = new Map();
  const element = {
    hidden: false,
    disabled: false,
    textContent: '',
    value: '',
    type: '',
    autocomplete: '',
    placeholder: '',
    className: '',
    dataset: {},
    elements: [],
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    hasAttribute(name) { return attributes.has(name); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    toggleAttribute(name, force) {
      if (force) attributes.set(name, '');
      else attributes.delete(name);
    },
    contains() { return false; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    focus: vi.fn(),
    addEventListener: vi.fn(),
    ...overrides
  };
  return element;
}

async function loginDemoHarness({ lang = 'en' } = {}) {
  const spinner = testElement({ hidden: true });
  const submitLabel = testElement({ textContent: 'Sign In' });
  const submit = testElement({
    querySelector(selector) {
      if (selector === '.auth-spinner') return spinner;
      if (selector === '[data-submit-label]') return submitLabel;
      return null;
    }
  });
  const email = testElement({ type: 'email', autocomplete: 'email', placeholder: 'Email address' });
  const password = testElement({ type: 'password', autocomplete: 'current-password', placeholder: 'Password' });
  email.setAttribute('data-i18n-ph', 'email_ph');
  password.setAttribute('data-i18n-ph', 'password_ph');
  password.setAttribute('minlength', '12');

  const contained = new Set([email, password]);
  const form = testElement({
    elements: [email, password, submit],
    contains(element) { return contained.has(element); },
    querySelector(selector) { return selector === '[type="submit"]' ? submit : null; }
  });
  const noticeTitle = testElement({ dataset: { authCopy: 'demoNoticeTitle' }, textContent: 'Local demo' });
  const noticeMessage = testElement({
    dataset: { authCopy: 'demoNotice' },
    textContent: 'Any non-empty email and password work in this local demo. No real customer account is authenticated. Do not use real credentials.'
  });
  const notice = testElement({
    hidden: true,
    querySelectorAll(selector) { return selector === '[data-auth-copy]' ? [noticeTitle, noticeMessage] : []; }
  });
  const elements = {
    authAlert: testElement({ hidden: true }),
    brandTitle: testElement(),
    brandText: testElement(),
    checkoutAuthContext: testElement({ hidden: true }),
    continueGuestLink: testElement(),
    authBackLink: testElement(),
    authBackLabel: testElement(),
    demoLoginNotice: notice,
    demoLoginNoticeTitle: noticeTitle,
    demoLoginNoticeMessage: noticeMessage,
    loginForm: form,
    loginEmail: email,
    loginEmailWrap: testElement(),
    loginEmailError: testElement(),
    loginEmailLabel: testElement({ textContent: 'Email address' }),
    loginPass: password,
    loginPassWrap: testElement(),
    loginPassError: testElement(),
    loginPasswordLabel: testElement({ textContent: 'Password' }),
    loginBtn: submit,
    loginSubmitLabel: submitLabel,
    loginRecoveryActions: testElement(),
    loginSignupPrompt: testElement(),
    toSignup: testElement(),
    toLogin: testElement(),
    toForgot: testElement(),
    forgotToLogin: testElement(),
    guestMergePanel: testElement({ hidden: true })
  };
  const login = vi.fn().mockResolvedValue({ user: { id: 'production-user' } });
  const demoLogin = vi.fn().mockResolvedValue({ user: { id: 'demo-user' }, localDemo: true });
  const lockRequest = vi.fn((_name, _options, callback) => callback());
  let language = lang;
  const document = {
    addEventListener() {},
    getElementById(id) { return elements[id] || null; },
    querySelectorAll(selector) {
      if (selector === '[data-auth-panel] form') return [form];
      return [];
    }
  };
  const context = {
    URLSearchParams,
    console,
    document,
    getLang: () => language,
    location: { search: '', replace: vi.fn() },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { locks: { request: lockRequest } },
    requestAnimationFrame: callback => callback(),
    setTimeout: vi.fn(),
    StoreAPI: { auth: { login, demoLogin } },
    t: key => key,
    window: { addEventListener() {} }
  };
  context.globalThis = context;

  const source = await readFile(loginUrl, 'utf8');
  const instrumented = source.replace(/\}\)\(\);\s*$/, `
    globalThis.__loginDemoTest = {
      applyCapability: applyLocalDemoCapability,
      submit: submitLogin,
      syncLocalizedState,
      isEnabled: () => localDemoLoginEnabled
    };
  })();`);
  vm.runInNewContext(instrumented, context, { filename: 'js/login.js' });

  return {
    ...context.__loginDemoTest,
    elements,
    form,
    login,
    demoLogin,
    setLang(value) { language = value; }
  };
}

function submitEvent(form) {
  return { preventDefault: vi.fn(), currentTarget: form };
}

describe('local demo login presentation and routing', () => {
  it('activates only from the exact server session capability and exposes the warning accessibly', async () => {
    const production = await loginDemoHarness();
    production.applyCapability({ localDemoLogin: true, capabilities: { localDemoLogin: 'true' } });
    expect(production.isEnabled()).toBe(false);
    expect(production.elements.demoLoginNotice.hidden).toBe(true);
    expect(production.form.getAttribute('aria-describedby')).toBeNull();
    expect(production.elements.loginEmail.type).toBe('email');
    expect(production.elements.loginPass.getAttribute('minlength')).toBe('12');

    const demo = await loginDemoHarness();
    demo.applyCapability({ capabilities: { localDemoLogin: true } });
    expect(demo.isEnabled()).toBe(true);
    expect(demo.elements.demoLoginNotice.hidden).toBe(false);
    expect(demo.form.getAttribute('aria-describedby')).toBe('demoLoginNotice');
    expect(demo.elements.loginRecoveryActions.hidden).toBe(true);
    expect(demo.elements.loginSignupPrompt.hidden).toBe(true);
    expect(demo.elements.loginEmail.type).toBe('text');
    expect(demo.elements.loginEmail.autocomplete).toBe('off');
    expect(demo.elements.loginPass.autocomplete).toBe('off');
    expect(demo.elements.loginPass.getAttribute('minlength')).toBeNull();
    expect(demo.elements.loginSubmitLabel.textContent).toBe('Open demo');
    expect(demo.elements.demoLoginNoticeTitle.textContent).toBe('Local demo');
  });

  it('accepts arbitrary bounded non-empty demo values and uses only demoLogin', async () => {
    const demo = await loginDemoHarness();
    demo.applyCapability({ capabilities: { localDemoLogin: true } });
    demo.elements.loginEmail.value = '  not an email  ';
    demo.elements.loginPass.value = 'x';

    await demo.submit(submitEvent(demo.form));

    expect(demo.demoLogin).toHaveBeenCalledOnce();
    expect(demo.demoLogin.mock.calls[0][0]).toEqual({ email: 'not an email', password: 'x' });
    expect(demo.login).not.toHaveBeenCalled();
  });

  it('rejects empty and overlong demo values before making a request', async () => {
    const empty = await loginDemoHarness();
    empty.applyCapability({ capabilities: { localDemoLogin: true } });
    empty.elements.loginEmail.value = '   ';
    empty.elements.loginPass.value = '';
    await empty.submit(submitEvent(empty.form));
    expect(empty.demoLogin).not.toHaveBeenCalled();
    expect(empty.elements.loginEmailError.textContent).toBe('Enter any value.');
    expect(empty.elements.loginPassError.textContent).toBe('Enter any value.');
    expect(empty.elements.loginEmail.focus).toHaveBeenCalledOnce();

    const overlong = await loginDemoHarness();
    overlong.applyCapability({ capabilities: { localDemoLogin: true } });
    overlong.elements.loginEmail.value = 'a'.repeat(255);
    overlong.elements.loginPass.value = 'p'.repeat(129);
    await overlong.submit(submitEvent(overlong.form));
    expect(overlong.demoLogin).not.toHaveBeenCalled();
    expect(overlong.elements.loginEmailError.textContent).toBe('Use no more than 254 characters.');
    expect(overlong.elements.loginPassError.textContent).toBe('Use no more than 128 characters.');
  });

  it('retains production validation and the production login endpoint when the capability is absent', async () => {
    const invalid = await loginDemoHarness();
    invalid.elements.loginEmail.value = 'not an email';
    invalid.elements.loginPass.value = 'short';
    await invalid.submit(submitEvent(invalid.form));
    expect(invalid.login).not.toHaveBeenCalled();
    expect(invalid.demoLogin).not.toHaveBeenCalled();
    expect(invalid.elements.loginEmailError.textContent).toBe('Enter a valid email address.');
    expect(invalid.elements.loginPassError.textContent).toBe('Use at least 12 characters.');

    const valid = await loginDemoHarness();
    valid.elements.loginEmail.value = 'person@example.test';
    valid.elements.loginPass.value = 'long-enough-password';
    await valid.submit(submitEvent(valid.form));
    expect(valid.login).toHaveBeenCalledOnce();
    expect(valid.demoLogin).not.toHaveBeenCalled();
  });

  it('maps demo unavailability to localized actionable copy', async () => {
    const demo = await loginDemoHarness();
    demo.applyCapability({ capabilities: { localDemoLogin: true } });
    demo.elements.loginEmail.value = 'anything';
    demo.elements.loginPass.value = 'anything';
    demo.demoLogin.mockRejectedValueOnce(Object.assign(new Error('unavailable'), {
      code: 'LOCAL_DEV_LOGIN_UNAVAILABLE'
    }));

    await demo.submit(submitEvent(demo.form));

    expect(demo.elements.authAlert.textContent).toBe(
      'The local demo account is unavailable. Restart the local demo setup and try again.'
    );
  });

  it('relocalizes the visible warning and demo controls without changing modes', async () => {
    const demo = await loginDemoHarness();
    demo.applyCapability({ capabilities: { localDemoLogin: true } });
    expect(demo.elements.demoLoginNoticeMessage.textContent).toContain('No real customer account is authenticated.');

    demo.setLang('fr');
    demo.syncLocalizedState();

    expect(demo.elements.demoLoginNoticeTitle.textContent).toBe('Démo locale');
    expect(demo.elements.demoLoginNoticeMessage.textContent).toContain('Aucun vrai compte client n’est authentifié.');
    expect(demo.elements.loginEmailLabel.textContent).toBe('Email de démo (tout texte)');
    expect(demo.elements.loginPass.placeholder).toBe('Toute valeur non vide');
    expect(demo.elements.loginSubmitLabel.textContent).toBe('Ouvrir la démo');

    const html = await readFile(loginHtmlUrl, 'utf8');
    expect(html).toContain('id="demoLoginNotice" role="status" aria-live="polite" hidden');
    expect(html).toContain('data-auth-copy="demoNoticeTitle"');
    expect(html).toContain('data-auth-copy="demoNotice"');
    expect(html).not.toContain('<p lang="en">');
    expect(html).not.toContain('<p lang="fr">');
    expect(html.match(/v=20260825-local-demo/g)).toHaveLength(4);
  });
});
