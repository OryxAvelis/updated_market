/** Secure password-reset confirmation. The one-time token never leaves memory. */
(function initResetPasswordPage() {
  'use strict';

  const AUTH_SESSION_LOCK = 'am-market-auth-session-v1';
  const AUTH_STATE_CHANNEL = 'am-market-auth-state-v1';

  function consumeFragmentToken() {
    const fragment = location.hash.startsWith('#') ? location.hash.slice(1) : '';
    let token = null;
    if (fragment) {
      const params = new URLSearchParams(fragment);
      token = params.get('token');
      history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    }
    return typeof token === 'string' && token.length >= 32 && token.length <= 256 ? token : null;
  }

  // Run before the document body or any third-party resource is loaded.
  let resetToken = consumeFragmentToken();

  const $ = (id) => document.getElementById(id);
  const RESET_COPY = {
    en: {
      eyebrow: 'Secure account recovery',
      title: 'Choose a new password',
      subtitle: 'Choose a strong password that you do not use on another website.',
      newPassword: 'New password',
      confirmPassword: 'Confirm new password',
      passwordPlaceholder: 'New password',
      confirmPlaceholder: 'Confirm password',
      passwordRule: 'Use 12–128 characters.',
      showPassword: 'Show password',
      hidePassword: 'Hide password',
      submit: 'Change password',
      pending: 'Changing password…',
      tooShort: 'Use at least 12 characters.',
      mismatch: 'The passwords do not match.',
      invalidLink: 'This reset link is missing, invalid or expired. Request a new link from the sign-in page.',
      resetFailed: 'The password could not be changed. Request a new reset link and try again.',
      networkError: 'The server could not be reached. Check your connection and try again.',
      rateLimited: 'Too many attempts. Please wait before trying again.',
      success: 'Your password has been changed. All previous sessions were signed out.',
      continueSignin: 'Continue to sign in'
    },
    fr: {
      eyebrow: 'Récupération sécurisée du compte',
      title: 'Choisissez un nouveau mot de passe',
      subtitle: 'Choisissez un mot de passe fort que vous n’utilisez sur aucun autre site.',
      newPassword: 'Nouveau mot de passe',
      confirmPassword: 'Confirmer le nouveau mot de passe',
      passwordPlaceholder: 'Nouveau mot de passe',
      confirmPlaceholder: 'Confirmer le mot de passe',
      passwordRule: 'Utilisez entre 12 et 128 caractères.',
      showPassword: 'Afficher le mot de passe',
      hidePassword: 'Masquer le mot de passe',
      submit: 'Modifier le mot de passe',
      pending: 'Modification en cours…',
      tooShort: 'Utilisez au moins 12 caractères.',
      mismatch: 'Les mots de passe ne correspondent pas.',
      invalidLink: 'Ce lien est absent, invalide ou expiré. Demandez un nouveau lien depuis la page de connexion.',
      resetFailed: 'Le mot de passe n’a pas pu être modifié. Demandez un nouveau lien puis réessayez.',
      networkError: 'Le serveur est inaccessible. Vérifiez votre connexion puis réessayez.',
      rateLimited: 'Trop de tentatives. Patientez avant de réessayer.',
      success: 'Votre mot de passe a été modifié. Toutes les anciennes sessions ont été déconnectées.',
      continueSignin: 'Continuer vers la connexion'
    }
  };

  function currentCopy() {
    return RESET_COPY[typeof getLang === 'function' && getLang() === 'fr' ? 'fr' : 'en'];
  }

  function copy(key) {
    return currentCopy()[key] || RESET_COPY.en[key] || key;
  }

  function applyResetCopy() {
    document.querySelectorAll('[data-reset-copy]').forEach((element) => {
      element.textContent = copy(element.dataset.resetCopy);
    });
    document.querySelectorAll('[data-reset-copy-placeholder]').forEach((element) => {
      element.placeholder = copy(element.dataset.resetCopyPlaceholder);
    });
    document.querySelectorAll('[data-reset-copy-aria]').forEach((element) => {
      const input = $(element.dataset.eye);
      const key = input?.type === 'text' ? 'hidePassword' : element.dataset.resetCopyAria;
      element.setAttribute('aria-label', copy(key));
      element.setAttribute('title', copy(key));
    });
    document.title = `${copy('title')} — AM MARKET`;
    document.querySelectorAll('.field-error[data-reset-error-key]').forEach((element) => {
      element.textContent = copy(element.dataset.resetErrorKey);
    });
    const alert = $('resetAlert');
    if (alert && !alert.hidden) {
      const key = alert.dataset.resetAlertKey;
      if (key) alert.textContent = copy(key);
      else {
        alert.hidden = true;
        alert.textContent = '';
      }
    }
    if ($('resetForm')?.hasAttribute('aria-busy')) {
      $('resetSubmit').querySelector('[data-submit-label]').textContent = copy('pending');
    }
  }

  function showAlert(message, type = 'error', focus = false, messageKey = '') {
    const alert = $('resetAlert');
    alert.textContent = message;
    alert.className = `auth-alert auth-alert--${type}`;
    alert.hidden = false;
    const success = type === 'success';
    alert.setAttribute('role', success ? 'status' : 'alert');
    alert.setAttribute('aria-live', success ? 'polite' : 'assertive');
    if (messageKey) alert.dataset.resetAlertKey = messageKey;
    else delete alert.dataset.resetAlertKey;
    if (focus) requestAnimationFrame(() => alert.focus({ preventScroll: true }));
  }

  function showCopyAlert(key, type = 'error', focus = false) {
    showAlert(copy(key), type, focus, key);
  }

  function setFieldError(inputId, wrapId, errorId, key) {
    const input = $(inputId);
    $(wrapId).classList.add('error');
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', errorId);
    const error = $(errorId);
    error.dataset.resetErrorKey = key;
    error.textContent = copy(key);
  }

  function clearFieldError(inputId, wrapId, errorId) {
    const input = $(inputId);
    $(wrapId).classList.remove('error');
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
    const error = $(errorId);
    error.textContent = '';
    delete error.dataset.resetErrorKey;
  }

  function setPending(pending) {
    const form = $('resetForm');
    form.toggleAttribute('aria-busy', pending);
    Array.from(form.elements).forEach((control) => { control.disabled = pending; });
    $('resetSubmit').querySelector('.auth-spinner').hidden = !pending;
    $('resetSubmit').querySelector('[data-submit-label]').textContent = copy(pending ? 'pending' : 'submit');
  }

  function bindVisibilityButtons() {
    document.querySelectorAll('[data-eye]').forEach((button) => {
      button.addEventListener('click', () => {
        const input = $(button.dataset.eye);
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        button.setAttribute('aria-pressed', String(!showing));
        const icon = button.querySelector('[aria-hidden="true"]');
        icon?.classList.toggle('fa-eye', showing);
        icon?.classList.toggle('fa-eye-slash', !showing);
        const key = showing ? 'showPassword' : 'hidePassword';
        button.setAttribute('aria-label', copy(key));
        button.setAttribute('title', copy(key));
      });
    });
  }

  function resetErrorKey(error) {
    if (error?.code === 'RATE_LIMITED') return 'rateLimited';
    if (error?.code === 'NETWORK_ERROR' || error?.code === 'REQUEST_TIMEOUT') return 'networkError';
    return 'resetFailed';
  }

  function isRejectedToken(error) {
    return ['RESET_TOKEN_INVALID', 'RESET_TOKEN_EXPIRED', 'TOKEN_EXPIRED'].includes(error?.code);
  }

  function exposeSignInRecovery(focus = false) {
    $('resetForm').hidden = true;
    $('resetSignIn').hidden = false;
    if (focus) requestAnimationFrame(() => $('resetSignIn').focus({ preventScroll: true }));
  }

  async function withAuthSessionLock(work) {
    const locks = globalThis.navigator?.locks;
    if (!locks || typeof locks.request !== 'function') {
      const error = new Error('A cross-tab account lock is unavailable.');
      error.code = 'AUTH_LOCK_UNAVAILABLE';
      throw error;
    }
    return locks.request(AUTH_SESSION_LOCK, { mode: 'exclusive' }, work);
  }

  function broadcastPasswordReset() {
    if (typeof globalThis.BroadcastChannel !== 'function') return false;
    let channel;
    try {
      channel = new globalThis.BroadcastChannel(AUTH_STATE_CHANNEL);
      channel.postMessage({ version: 1, type: 'session-invalidated', reason: 'password-reset' });
      globalThis.setTimeout(() => {
        try { channel.close(); } catch { /* Best effort. */ }
      }, 0);
      return true;
    } catch (error) {
      try { channel?.close(); } catch { /* Best effort. */ }
      console.warn('[AM MARKET password reset] Could not notify other tabs', error);
      return false;
    }
  }

  async function submitReset(event) {
    event.preventDefault();
    if (!resetToken || $('resetForm').hasAttribute('aria-busy')) return;
    clearFieldError('newPassword', 'newPasswordWrap', 'newPasswordError');
    clearFieldError('confirmPassword', 'confirmPasswordWrap', 'confirmPasswordError');
    const password = $('newPassword').value;
    const confirmation = $('confirmPassword').value;
    let firstInvalid = null;
    if (password.length < 12 || password.length > 128) {
      setFieldError('newPassword', 'newPasswordWrap', 'newPasswordError', 'tooShort');
      firstInvalid ||= $('newPassword');
    }
    if (confirmation !== password) {
      setFieldError('confirmPassword', 'confirmPasswordWrap', 'confirmPasswordError', 'mismatch');
      firstInvalid ||= $('confirmPassword');
    }
    if (firstInvalid) { firstInvalid.focus(); return; }

    setPending(true);
    try {
      await withAuthSessionLock(() => StoreAPI.auth.confirmPasswordReset({ token: resetToken, newPassword: password }));
      broadcastPasswordReset();
      resetToken = null;
      $('resetForm').reset();
      $('resetForm').hidden = true;
      $('resetSignIn').hidden = false;
      showCopyAlert('success', 'success', true);
    } catch (error) {
      if (isRejectedToken(error)) resetToken = null;
      showCopyAlert(resetErrorKey(error), 'error', Boolean(resetToken));
      if (!resetToken) exposeSignInRecovery(true);
    } finally {
      setPending(false);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyResetCopy();
    bindVisibilityButtons();
    $('newPassword').addEventListener('input', () => clearFieldError('newPassword', 'newPasswordWrap', 'newPasswordError'));
    $('confirmPassword').addEventListener('input', () => clearFieldError('confirmPassword', 'confirmPasswordWrap', 'confirmPasswordError'));
    $('resetForm').addEventListener('submit', submitReset);
    if (!resetToken) {
      exposeSignInRecovery(true);
      showCopyAlert('invalidLink', 'error');
    } else {
      StoreAPI.bootstrap().catch(() => { /* Submit reports actionable connection errors. */ });
    }
  });

  window.addEventListener('am:langchange', applyResetCopy);
})();
