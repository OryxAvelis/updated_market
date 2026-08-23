/**
 * AM MARKET secure storefront authentication UI.
 * Authentication is cookie-based through StoreAPI. Only the two anonymous
 * shopping keys are considered for a post-authentication merge.
 */
(function initLoginPage() {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PRODUCT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
  const AUTH_COPY = {
    en: {
      secureAccount: 'Secure account sessions',
      passwordPlaceholder: 'Password (12–128 characters)',
      passwordRule: 'Use 12–128 characters.',
      forgotTitle: 'Reset your password',
      forgotSubtitle: 'Enter your account email. If an account exists, we will send a secure reset link.',
      forgotBrandTitle: 'Account recovery',
      forgotBrandText: 'We use a short-lived, one-time link so your password stays private.',
      sendReset: 'Send reset link',
      passwordTooShort: 'Use at least 12 characters.',
      emailInvalid: 'Enter a valid email address.',
      nameInvalid: 'Enter at least 2 characters.',
      genericError: 'We could not complete that request. Please try again.',
      networkError: 'The server could not be reached. Check your connection and try again.',
      invalidCredentials: 'The email or password is incorrect.',
      emailExists: 'An account already exists for this email address.',
      rateLimited: 'Too many attempts. Please wait before trying again.',
      loginSuccess: 'Signed in securely. Taking you to the store…',
      registerSuccess: 'Your account is ready. Taking you to the store…',
      mergeWarning: 'You are signed in. Some guest items could not be synchronized and remain saved in this browser.',
      resetSent: 'If an account exists for that email, a secure reset link will be sent shortly.',
      pending: 'Please wait…'
    },
    fr: {
      secureAccount: 'Sessions de compte sécurisées',
      passwordPlaceholder: 'Mot de passe (12 à 128 caractères)',
      passwordRule: 'Utilisez entre 12 et 128 caractères.',
      forgotTitle: 'Réinitialiser votre mot de passe',
      forgotSubtitle: 'Saisissez l’adresse email du compte. Si le compte existe, nous enverrons un lien sécurisé.',
      forgotBrandTitle: 'Récupération du compte',
      forgotBrandText: 'Nous utilisons un lien temporaire à usage unique afin de protéger votre mot de passe.',
      sendReset: 'Envoyer le lien',
      passwordTooShort: 'Utilisez au moins 12 caractères.',
      emailInvalid: 'Saisissez une adresse email valide.',
      nameInvalid: 'Saisissez au moins 2 caractères.',
      genericError: 'Impossible de terminer cette demande. Veuillez réessayer.',
      networkError: 'Le serveur est inaccessible. Vérifiez votre connexion puis réessayez.',
      invalidCredentials: 'L’adresse email ou le mot de passe est incorrect.',
      emailExists: 'Un compte existe déjà pour cette adresse email.',
      rateLimited: 'Trop de tentatives. Patientez avant de réessayer.',
      loginSuccess: 'Connexion sécurisée réussie. Redirection vers la boutique…',
      registerSuccess: 'Votre compte est prêt. Redirection vers la boutique…',
      mergeWarning: 'Vous êtes connecté. Certains articles invités n’ont pas pu être synchronisés et restent enregistrés dans ce navigateur.',
      resetSent: 'Si un compte correspond à cette adresse, un lien sécurisé sera envoyé sous peu.',
      pending: 'Veuillez patienter…'
    }
  };

  const fieldMap = {
    email: { input: 'loginEmail', wrap: 'loginEmailWrap', error: 'loginEmailError', key: 'emailInvalid' },
    password: { input: 'loginPass', wrap: 'loginPassWrap', error: 'loginPassError', key: 'passwordTooShort' },
    displayName: { input: 'suName', wrap: 'suNameWrap', error: 'suNameError', key: 'nameInvalid' },
    signupEmail: { input: 'suEmail', wrap: 'suEmailWrap', error: 'suEmailError', key: 'emailInvalid' },
    signupPassword: { input: 'suPass', wrap: 'suPassWrap', error: 'suPassError', key: 'passwordTooShort' },
    forgotEmail: { input: 'forgotEmail', wrap: 'forgotEmailWrap', error: 'forgotEmailError', key: 'emailInvalid' }
  };

  let currentMode = 'login';
  let authBusy = false;

  function safeNextPage() {
    const candidate = new URLSearchParams(location.search).get('next') || '';
    return /^(?:index|all-categories|categories|product|cart|checkout|wishlist|orders|settings|help)\.html(?:\?[A-Za-z0-9._~!$&'()*+,;=:@%?-]*)?$/.test(candidate)
      ? candidate
      : 'index.html';
  }

  function currentCopy() {
    return AUTH_COPY[typeof getLang === 'function' && getLang() === 'fr' ? 'fr' : 'en'];
  }

  function copy(key) {
    return currentCopy()[key] || AUTH_COPY.en[key] || key;
  }

  function applyLocalCopy(root = document) {
    root.querySelectorAll('[data-auth-copy]').forEach((element) => {
      element.textContent = copy(element.dataset.authCopy);
    });
    root.querySelectorAll('[data-auth-copy-placeholder]').forEach((element) => {
      element.placeholder = copy(element.dataset.authCopyPlaceholder);
    });
  }

  function setBrand(mode) {
    const brand = mode === 'signup'
      ? { title: t('brand_signup_title'), text: t('brand_signup_text') }
      : mode === 'forgot'
        ? { title: copy('forgotBrandTitle'), text: copy('forgotBrandText') }
        : { title: t('brand_login_title'), text: t('brand_login_text') };
    const title = $('brandTitle');
    const text = $('brandText');
    title.textContent = brand.title;
    text.textContent = brand.text;
    [title, text].forEach((element) => {
      element.classList.remove('swap');
      void element.offsetWidth;
      element.classList.add('swap');
    });
  }

  function hideAlert() {
    const alert = $('authAlert');
    alert.hidden = true;
    alert.textContent = '';
    alert.className = 'auth-alert';
    alert.setAttribute('role', 'alert');
    alert.setAttribute('aria-live', 'assertive');
  }

  function showAlert(message, type = 'error', focus = false) {
    const alert = $('authAlert');
    alert.textContent = message;
    alert.className = `auth-alert auth-alert--${type}`;
    alert.hidden = false;
    const polite = type === 'success' || type === 'warning';
    alert.setAttribute('role', polite ? 'status' : 'alert');
    alert.setAttribute('aria-live', polite ? 'polite' : 'assertive');
    if (focus) requestAnimationFrame(() => alert.focus({ preventScroll: true }));
  }

  function showMode(mode, backwards = false) {
    if (authBusy || !['login', 'signup', 'forgot'].includes(mode)) return;
    currentMode = mode;
    hideAlert();
    document.querySelectorAll('[data-auth-panel]').forEach((panel) => {
      const selected = panel.dataset.authPanel === mode;
      panel.hidden = !selected;
      panel.setAttribute('aria-hidden', String(!selected));
      panel.classList.remove('anim', 'anim-back');
      if (selected) {
        void panel.offsetWidth;
        panel.classList.add(backwards ? 'anim-back' : 'anim');
      }
    });
    setBrand(mode);
    const panel = document.querySelector(`[data-auth-panel="${mode}"]`);
    requestAnimationFrame(() => panel?.querySelector('input, h2')?.focus({ preventScroll: true }));
  }

  function setFieldError(config, key = config.key, message = '') {
    const input = $(config.input);
    const wrap = $(config.wrap);
    const error = $(config.error);
    wrap.classList.add('error');
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', config.error);
    error.dataset.authErrorKey = key;
    error.textContent = message || copy(key);
  }

  function clearFieldError(config) {
    const input = $(config.input);
    $(config.wrap).classList.remove('error');
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
    const error = $(config.error);
    error.textContent = '';
    delete error.dataset.authErrorKey;
  }

  function clearFormErrors(form) {
    Object.values(fieldMap).forEach((config) => {
      if (form.contains($(config.input))) clearFieldError(config);
    });
  }

  function isValidEmail(value) {
    return value.length <= 254 && EMAIL_PATTERN.test(value);
  }

  function setPending(form, pending) {
    authBusy = pending;
    form.toggleAttribute('aria-busy', pending);
    Array.from(form.elements).forEach((control) => { control.disabled = pending; });
    const submit = form.querySelector('[type="submit"]');
    const spinner = submit?.querySelector('.auth-spinner');
    if (spinner) spinner.hidden = !pending;
    const label = submit?.querySelector('[data-submit-label]');
    if (label) {
      if (pending) label.textContent = copy('pending');
      else {
        if (typeof applyI18n === 'function') applyI18n(submit);
        applyLocalCopy(submit);
      }
    }
  }

  function errorMessage(error) {
    const keyByCode = {
      INVALID_CREDENTIALS: 'invalidCredentials',
      EMAIL_ALREADY_REGISTERED: 'emailExists',
      RATE_LIMITED: 'rateLimited',
      NETWORK_ERROR: 'networkError',
      REQUEST_TIMEOUT: 'networkError'
    };
    return copy(keyByCode[error?.code] || 'genericError');
  }

  function applyServerFieldErrors(error, serverFields) {
    const issues = [];
    if (Array.isArray(error?.fields)) issues.push(...error.fields);
    else if (error?.fields && typeof error.fields === 'object') {
      Object.entries(error.fields).forEach(([path, message]) => issues.push({ path, message }));
    }
    if (Array.isArray(error?.details)) issues.push(...error.details);
    let firstInput = null;
    issues.forEach((issue) => {
      const path = String(issue.path || '').split('.').pop();
      const config = serverFields[path];
      if (!config) return;
      setFieldError(config);
      firstInput ||= $(config.input);
    });
    firstInput?.focus({ preventScroll: true });
  }

  function guestCart() {
    let raw;
    try { raw = localStorage.getItem('am_cart'); } catch { return { present: false, valid: false, items: [] }; }
    if (raw == null) return { present: false, valid: true, items: [] };
    try {
      const value = JSON.parse(raw);
      if (!Array.isArray(value)) return { present: true, valid: false, items: [] };
      const quantities = new Map();
      value.forEach((item) => {
        const productId = String(item?.id ?? '').trim();
        if (!PRODUCT_ID_PATTERN.test(productId)) return;
        const quantity = Math.min(99, Math.max(1, Math.floor(Number(item.qty) || 1)));
        quantities.set(productId, Math.min(99, (quantities.get(productId) || 0) + quantity));
      });
      return {
        present: true,
        valid: true,
        items: Array.from(quantities, ([productId, quantity]) => ({ productId, quantity })).slice(0, 100)
      };
    } catch {
      return { present: true, valid: false, items: [] };
    }
  }

  function guestWishlist() {
    let raw;
    try { raw = localStorage.getItem('am_wish'); } catch { return { present: false, valid: false, items: [] }; }
    if (raw == null) return { present: false, valid: true, items: [] };
    try {
      const value = JSON.parse(raw);
      if (!Array.isArray(value)) return { present: true, valid: false, items: [] };
      const items = [...new Set(value.map((id) => String(id ?? '').trim()).filter((id) => PRODUCT_ID_PATTERN.test(id)))].slice(0, 100);
      return { present: true, valid: true, items };
    } catch {
      return { present: true, valid: false, items: [] };
    }
  }

  async function mergeGuestShopping() {
    const cart = guestCart();
    const wish = guestWishlist();
    const jobs = [];
    let failures = Number(cart.present && !cart.valid) + Number(wish.present && !wish.valid);

    if (cart.present && cart.valid) {
      jobs.push(StoreAPI.cart.mergeGuest({ items: cart.items })
        .then(() => { localStorage.removeItem('am_cart'); })
        .catch(() => { failures += 1; }));
    }
    if (wish.present && wish.valid) {
      jobs.push(StoreAPI.wishlist.mergeGuest({ items: wish.items })
        .then(() => { localStorage.removeItem('am_wish'); })
        .catch(() => { failures += 1; }));
    }

    await Promise.all(jobs);
    return failures;
  }

  async function completeAuthentication(kind) {
    const failures = await mergeGuestShopping();
    if (failures) showAlert(copy('mergeWarning'), 'warning', true);
    else showAlert(copy(kind === 'register' ? 'registerSuccess' : 'loginSuccess'), 'success', true);
    globalThis.setTimeout(() => location.replace(safeNextPage()), failures ? 1600 : 700);
  }

  async function submitLogin(event) {
    event.preventDefault();
    if (authBusy) return;
    const form = event.currentTarget;
    clearFormErrors(form);
    hideAlert();
    const email = $('loginEmail').value.trim();
    const password = $('loginPass').value;
    let firstInvalid = null;
    if (!isValidEmail(email)) { setFieldError(fieldMap.email); firstInvalid ||= $('loginEmail'); }
    if (password.length < 12 || password.length > 128) { setFieldError(fieldMap.password); firstInvalid ||= $('loginPass'); }
    if (firstInvalid) { firstInvalid.focus(); return; }

    setPending(form, true);
    let completed = false;
    try {
      await StoreAPI.auth.login({ email, password });
      await completeAuthentication('login');
      completed = true;
    } catch (error) {
      showAlert(errorMessage(error), 'error', true);
      applyServerFieldErrors(error, { email: fieldMap.email, password: fieldMap.password });
      $('loginPass').value = '';
    } finally {
      if (!completed) setPending(form, false);
    }
  }

  async function submitSignup(event) {
    event.preventDefault();
    if (authBusy) return;
    const form = event.currentTarget;
    clearFormErrors(form);
    hideAlert();
    const displayName = $('suName').value.trim();
    const email = $('suEmail').value.trim();
    const password = $('suPass').value;
    let firstInvalid = null;
    if (displayName.length < 2 || displayName.length > 100) { setFieldError(fieldMap.displayName); firstInvalid ||= $('suName'); }
    if (!isValidEmail(email)) { setFieldError(fieldMap.signupEmail); firstInvalid ||= $('suEmail'); }
    if (password.length < 12 || password.length > 128) { setFieldError(fieldMap.signupPassword); firstInvalid ||= $('suPass'); }
    if (firstInvalid) { firstInvalid.focus(); return; }

    setPending(form, true);
    let completed = false;
    try {
      await StoreAPI.auth.register({ displayName, email, password, language: getLang() });
      await completeAuthentication('register');
      completed = true;
    } catch (error) {
      showAlert(errorMessage(error), 'error', true);
      applyServerFieldErrors(error, {
        displayName: fieldMap.displayName,
        email: fieldMap.signupEmail,
        password: fieldMap.signupPassword
      });
      if (error?.code === 'EMAIL_ALREADY_REGISTERED') {
        setFieldError(fieldMap.signupEmail, 'emailExists');
        $('suEmail').focus();
      }
      $('suPass').value = '';
    } finally {
      if (!completed) setPending(form, false);
    }
  }

  async function submitForgot(event) {
    event.preventDefault();
    if (authBusy) return;
    const form = event.currentTarget;
    clearFormErrors(form);
    hideAlert();
    const email = $('forgotEmail').value.trim();
    if (!isValidEmail(email)) {
      setFieldError(fieldMap.forgotEmail);
      $('forgotEmail').focus();
      return;
    }

    setPending(form, true);
    try {
      await StoreAPI.auth.requestPasswordReset({ email });
      showAlert(copy('resetSent'), 'success', true);
    } catch (error) {
      showAlert(errorMessage(error), 'error', true);
      applyServerFieldErrors(error, { email: fieldMap.forgotEmail });
    } finally {
      setPending(form, false);
    }
  }

  function bindPasswordVisibility() {
    document.querySelectorAll('[data-eye]').forEach((button) => {
      button.addEventListener('click', () => {
        const input = $(button.dataset.eye);
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        button.setAttribute('aria-pressed', String(!showing));
        button.querySelector('[aria-hidden="true"]').textContent = showing ? '◉' : '◎';
        const label = t(showing ? 'show_pass' : 'hide_pass');
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
      });
    });
  }

  function bindErrorClearing() {
    Object.values(fieldMap).forEach((config) => {
      $(config.input)?.addEventListener('input', () => clearFieldError(config));
    });
  }

  function syncLocalizedState() {
    applyLocalCopy();
    setBrand(currentMode);
    document.querySelectorAll('.field-error[data-auth-error-key]').forEach((error) => {
      error.textContent = copy(error.dataset.authErrorKey);
    });
    document.querySelectorAll('[data-eye]').forEach((button) => {
      const input = $(button.dataset.eye);
      const label = t(input.type === 'text' ? 'hide_pass' : 'show_pass');
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyLocalCopy();
    setBrand('login');
    bindPasswordVisibility();
    bindErrorClearing();
    $('toSignup').addEventListener('click', () => showMode('signup'));
    $('toLogin').addEventListener('click', () => showMode('login', true));
    $('toForgot').addEventListener('click', () => {
      if (!$('forgotEmail').value) $('forgotEmail').value = $('loginEmail').value.trim();
      showMode('forgot');
    });
    $('forgotToLogin').addEventListener('click', () => showMode('login', true));
    $('loginForm').addEventListener('submit', submitLogin);
    $('signupForm').addEventListener('submit', submitSignup);
    $('forgotForm').addEventListener('submit', submitForgot);

    StoreAPI.bootstrap()
      .then((session) => { if (session?.authenticated) location.replace(safeNextPage()); })
      .catch(() => { /* Submit handlers provide actionable connection errors. */ });
  });

  window.addEventListener('am:langchange', syncLocalizedState);
})();
