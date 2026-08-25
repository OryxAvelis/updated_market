/** AM MARKET administrator login page. */
(() => {
  'use strict';

  const fieldErrors = { email: '', password: '' };
  let alertKey = '';

  const translate = key => typeof t === 'function' ? t(key) : key;

  function safeNextPage() {
    const requested = new URLSearchParams(location.search).get('next') || 'index.html';
    const allowed = new Set((window.AdminCore?.routes || []).map(route => route.file));
    return allowed.has(requested) ? requested : 'index.html';
  }

  function renderFeedback() {
    Object.entries(fieldErrors).forEach(([field, key]) => {
      const input = document.getElementById(field === 'email' ? 'adminEmail' : 'adminPassword');
      const error = document.querySelector(`[data-admin-field-error="${field}"]`);
      if (error) error.textContent = key ? translate(key) : '';
      input?.classList.toggle('is-invalid', Boolean(key));
      if (key) input?.setAttribute('aria-invalid', 'true');
      else input?.removeAttribute('aria-invalid');
    });

    const alert = document.getElementById('adminLoginAlert');
    const message = alert?.querySelector('[data-admin-login-alert]');
    if (message) message.textContent = alertKey ? translate(alertKey) : '';
    if (alert) alert.hidden = !alertKey;
  }

  function clearField(field) {
    fieldErrors[field] = '';
    if (alertKey) alertKey = '';
    renderFeedback();
  }

  function validate(emailInput, passwordInput) {
    const email = emailInput.value.trim();
    const hasPassword = passwordInput.value.length > 0;
    fieldErrors.email = !email
      ? 'admin_login_email_required'
      : (!emailInput.validity.valid ? 'admin_login_email_invalid' : '');
    fieldErrors.password = hasPassword ? '' : 'admin_login_password_required';
    alertKey = !email && !hasPassword ? 'admin_login_empty_summary' : '';
    renderFeedback();
    const firstInvalid = fieldErrors.email ? emailInput : (fieldErrors.password ? passwordInput : null);
    firstInvalid?.focus();
    return !firstInvalid;
  }

  async function submitLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const emailInput = document.getElementById('adminEmail');
    const passwordInput = document.getElementById('adminPassword');
    const submitButton = document.getElementById('adminLoginSubmit');
    if (!emailInput || !passwordInput || !submitButton || submitButton.disabled) return;
    if (!validate(emailInput, passwordInput)) return;

    form.setAttribute('aria-busy', 'true');
    AdminCore.setBusy(submitButton, true, translate('admin_login_signing_in'));
    const result = await window.AdminAuth.login(emailInput.value.trim(), passwordInput.value);
    passwordInput.value = '';

    if (!result.ok) {
      form.removeAttribute('aria-busy');
      AdminCore.setBusy(submitButton, false);
      alertKey = result.error?.code === 'RATE_LIMITED'
        ? 'admin_login_rate_limited'
        : (['NETWORK_ERROR', 'REQUEST_TIMEOUT'].includes(result.error?.code)
            ? 'admin_login_unavailable'
            : (result.error?.code === 'ADMIN_CSRF_INVALID' ? 'admin_login_retry' : 'admin_login_wrong'));
      fieldErrors.password = '';
      renderFeedback();
      document.getElementById('adminLoginAlert')?.focus();
      return;
    }

    alertKey = '';
    renderFeedback();
    AdminCore.toast(translate('admin_login_success'), 'success');
    setTimeout(() => location.replace(safeNextPage()), 520);
  }

  window.addEventListener('admin:ready', event => {
    if (event.detail?.session) {
      location.replace(safeNextPage());
      return;
    }
    const form = document.getElementById('adminLoginForm');
    const email = document.getElementById('adminEmail');
    const password = document.getElementById('adminPassword');
    form?.addEventListener('submit', submitLogin);
    email?.addEventListener('input', () => clearField('email'));
    password?.addEventListener('input', () => clearField('password'));
    email?.focus({ preventScroll: true });
  });

  window.addEventListener('am:langchange', renderFeedback);
})();
