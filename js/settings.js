/**
 * Authenticated customer settings backed by the same-origin StoreAPI.
 * Passwords and session tokens are never written to browser storage.
 */
(function settingsPage() {
  'use strict';

  const state = {
    user: null,
    preferences: null,
    addresses: [],
    editingAddressId: null,
    originalEmail: '',
    addressReturnFocus: null,
    actionsRegistered: false,
    loading: false,
    preferenceSaving: false,
    preferenceStatusTimer: null,
    authEpoch: 0,
    sections: {
      profile: false,
      preferences: false,
      addresses: false
    }
  };

  const byId = (id) => document.getElementById(id);
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const authSessionLockName = 'am-market-auth-session-v1';
  const errorCodeKeys = {
    ADDRESS_NOT_FOUND: 'settings_error_address_not_found',
    CURRENT_PASSWORD_INVALID: 'settings_error_password_invalid',
    EMAIL_ALREADY_REGISTERED: 'settings_error_email_registered',
    PASSWORD_INVALID: 'settings_error_password_invalid',
    PASSWORD_REQUIRED: 'settings_error_password_required',
    RATE_LIMITED: 'settings_error_rate_limited'
  };

  function setError(id, key = '', vars = {}) {
    const target = byId(id);
    if (!target) return;
    if (!key) {
      target.textContent = '';
      delete target.dataset.messageKey;
      delete target.dataset.messageVars;
      return;
    }
    target.dataset.messageKey = key;
    target.dataset.messageVars = JSON.stringify(vars);
    target.textContent = t(key, vars);
  }

  function apiMessageKey(error, fallbackKey) {
    return errorCodeKeys[error?.code] || fallbackKey;
  }

  function rerenderDynamicMessages() {
    document.querySelectorAll('[data-message-key]').forEach((target) => {
      let vars = {};
      try { vars = JSON.parse(target.dataset.messageVars || '{}'); } catch (_error) { vars = {}; }
      target.textContent = t(target.dataset.messageKey, vars);
    });
  }

  function markInvalid(input, errorId, invalid) {
    if (!input) return;
    if (input.dataset.baseDescribedby === undefined) {
      input.dataset.baseDescribedby = input.getAttribute('aria-describedby') || '';
    }
    const baseDescribedby = input.dataset.baseDescribedby;
    input.classList.toggle('is-invalid', invalid);
    if (invalid) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', [baseDescribedby, errorId].filter(Boolean).join(' '));
    } else {
      input.removeAttribute('aria-invalid');
      if (baseDescribedby) input.setAttribute('aria-describedby', baseDescribedby);
      else input.removeAttribute('aria-describedby');
    }
  }

  function clearValidation(form, errorId) {
    form?.querySelectorAll('.is-invalid').forEach((input) => markInvalid(input, errorId, false));
    setError(errorId);
  }

  async function withBusy(button, work, busyKey = 'settings_working') {
    if (!button || button.disabled) return undefined;
    const originalChildren = Array.from(button.childNodes, (node) => node.cloneNode(true));
    const spinner = element('span', 'spinner-border spinner-border-sm me-1');
    spinner.setAttribute('aria-hidden', 'true');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.replaceChildren(spinner, document.createTextNode(t(busyKey)));
    try {
      return await work();
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.replaceChildren(...originalChildren);
      if (button.dataset.i18n) button.textContent = t(button.dataset.i18n);
      else applyI18n(button);
    }
  }

  async function guardedAuth(promise) {
    const epoch = state.authEpoch;
    const result = await promise;
    if (epoch !== state.authEpoch) {
      throw Object.assign(new Error('Stale authenticated response.'), { code: 'STALE_AUTH_RESPONSE' });
    }
    return result;
  }

  function normalizedPhone(value, required) {
    const text = String(value || '').trim();
    if (!text && !required) return null;
    let digits = text.replace(/\D/g, '');
    if (digits.startsWith('00212')) digits = digits.slice(5);
    else if (digits.startsWith('212')) digits = digits.slice(3);
    if (digits.startsWith('0')) digits = digits.slice(1);
    return /^[5-7]\d{8}$/.test(digits) ? `+212${digits}` : null;
  }

  function checkedValue(name) {
    return document.querySelector(`input[name="${name}"]:checked`)?.value || '';
  }

  function setCheckedValue(name, value) {
    document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
      input.checked = input.value === value;
    });
  }

  function syncCoreAccountState() {
    currentUser = state.user ? { ...state.user, name: state.user.displayName } : null;
    currentPreferences = state.preferences ? { ...state.preferences } : null;
    if (state.sections.addresses) savedAddresses = state.addresses.slice();
    renderAccountPanel();
    updateAccountUI();
  }

  function clearClientAccountState(preserveGuestCommerce = false) {
    state.authEpoch += 1;
    state.user = null;
    state.preferences = null;
    state.preferenceSaving = false;
    if (state.preferenceStatusTimer) clearTimeout(state.preferenceStatusTimer);
    state.preferenceStatusTimer = null;
    state.addresses = [];
    state.editingAddressId = null;
    state.sections.profile = false;
    state.sections.preferences = false;
    state.sections.addresses = false;
    currentUser = null;
    currentPreferences = null;
    savedAddresses = [];
    if (!preserveGuestCommerce) {
      cart = [];
      wishlist = [];
      orders = [];
    }
    resetAuthenticatedCommerceSyncState();
    accountNotifications = [];
    authenticatedRecent = [];
    authenticatedSearches = [];
    Object.keys(authenticatedResourceState).forEach((resource) => {
      authenticatedResourceState[resource] = 'ready';
    });
    accountRecoveryPending = false;
    try {
      localStorage.removeItem('am_user');
      localStorage.removeItem('am_profile');
      localStorage.removeItem('am_delivery');
    } catch (storageError) {
      console.warn('[AM MARKET] Could not clear settings local account state', storageError);
    }
    try {
      sessionStorage.removeItem('am_user');
      sessionStorage.removeItem('am_profile');
    } catch (storageError) {
      console.warn('[AM MARKET] Could not clear settings session account state', storageError);
    }
    updateBadges();
    renderNotifMenu();
    renderAccountPanel();
    updateAccountUI();
    renderAccountRecovery();
  }

  function transitionToGuestAfterAuthFailure() {
    if (currentUser && typeof handleStoreUnauthorized === 'function') {
      handleStoreUnauthorized({ status: 401 });
      return;
    }
    clearClientAccountState(true);
    showGuest();
  }

  function transitionSettingsAfterSharedSignOut() {
    clearClientAccountState(true);
    showGuest();
  }

  function completeClientSignOut(reason = 'logout') {
    const signedOutUserId = state.user?.id || currentUser?.id;
    const transitioned = typeof transitionStoreToSignedOut === 'function'
      ? transitionStoreToSignedOut({ reason, notify: false })
      : false;
    if (!transitioned) clearClientAccountState(true);
    if (typeof broadcastStoreSignedOut === 'function' &&
        broadcastStoreSignedOut(reason, signedOutUserId)) return;
    if (typeof broadcastStoreSessionInvalidated === 'function') {
      broadcastStoreSessionInvalidated(reason, signedOutUserId);
    }
  }

  async function runAuthSessionMutation(work) {
    if (typeof withStoreAuthSessionLock === 'function') return withStoreAuthSessionLock(work);
    const locks = globalThis.navigator?.locks;
    if (!locks || typeof locks.request !== 'function') {
      const error = new Error('A cross-tab account lock is unavailable.');
      error.code = 'AUTH_LOCK_UNAVAILABLE';
      throw error;
    }
    return locks.request(authSessionLockName, { mode: 'exclusive' }, work);
  }

  function showGuest() {
    byId('settingsLoading').hidden = true;
    byId('settingsLoadError').hidden = true;
    byId('settingsAccount').hidden = true;
    byId('settingsGuest').hidden = false;
  }

  function showAccount() {
    byId('settingsLoading').hidden = true;
    byId('settingsGuest').hidden = true;
    byId('settingsLoadError').hidden = true;
    byId('settingsAccount').hidden = false;
  }

  function showLoading() {
    byId('settingsGuest').hidden = true;
    byId('settingsAccount').hidden = true;
    byId('settingsLoadError').hidden = true;
    byId('settingsLoading').hidden = false;
  }

  function showLoadError(error) {
    byId('settingsLoading').hidden = true;
    byId('settingsGuest').hidden = true;
    byId('settingsAccount').hidden = true;
    setError('settingsLoadErrorMessage', apiMessageKey(error, 'settings_load_error'));
    byId('settingsLoadError').hidden = false;
  }

  const sectionRecoveryIds = {
    profile: 'profileLoadRecovery',
    preferences: 'preferencesLoadRecovery',
    addresses: 'addressesLoadRecovery'
  };

  function setSectionRecovery(section, needsRecovery) {
    state.sections[section] = !needsRecovery;
    const recovery = byId(sectionRecoveryIds[section]);
    if (recovery) recovery.hidden = !needsRecovery;
    if (section === 'addresses') byId('newAddressBtn').disabled = needsRecovery;
    if (section === 'preferences') setPreferenceControlsDisabled(needsRecovery);
  }

  function fallbackPreferences(preferences = {}) {
    const payment = ['cod', 'wafacash', 'cashplus'].includes(preferences.defaultPayment)
      ? preferences.defaultPayment
      : 'cod';
    return {
      language: preferences.language === 'fr' ? 'fr' : 'en',
      theme: preferences.theme === 'dark' ? 'dark' : 'light',
      defaultPayment: payment,
      orderNotifications: preferences.orderNotifications !== false,
      lowStockNotifications: preferences.lowStockNotifications !== false,
      personalizationEnabled: preferences.personalizationEnabled !== false
    };
  }

  function handleUnauthorized(error) {
    if (error?.code === 'STALE_AUTH_RESPONSE') return true;
    if (error?.status !== 401) return false;
    if (typeof handleStoreUnauthorized === 'function') handleStoreUnauthorized(error);
    else transitionToGuestAfterAuthFailure();
    return true;
  }

  async function retryProfileSection() {
    await withBusy(byId('retryProfileBtn'), async () => {
      try {
        const payload = await guardedAuth(StoreAPI.profile.get());
        if (!payload?.user) throw Object.assign(new Error(), { code: 'INVALID_RESPONSE' });
        state.user = payload.user;
        fillProfile();
        syncCoreAccountState();
        setSectionRecovery('profile', false);
      } catch (error) {
        if (!handleUnauthorized(error)) setSectionRecovery('profile', true);
      }
    });
  }

  async function retryPreferencesSection() {
    await withBusy(byId('retryPreferencesBtn'), async () => {
      try {
        const payload = await guardedAuth(StoreAPI.preferences.get());
        if (!payload?.preferences) throw Object.assign(new Error(), { code: 'INVALID_RESPONSE' });
        state.preferences = fallbackPreferences(payload.preferences);
        currentPreferences = { ...state.preferences };
        applyPreferencesToForm();
        applyPreferenceEffects(state.preferences);
        setPreferenceSaveStatus();
        setSectionRecovery('preferences', false);
      } catch (error) {
        if (!handleUnauthorized(error)) setSectionRecovery('preferences', true);
      }
    });
  }

  async function retryAddressesSection() {
    await withBusy(byId('retryAddressesBtn'), async () => {
      try {
        await reloadAddresses();
        setSectionRecovery('addresses', false);
      } catch (error) {
        if (!handleUnauthorized(error)) setSectionRecovery('addresses', true);
      }
    });
  }

  function fillProfile() {
    byId('setName').value = state.user.displayName || '';
    byId('setPhone').value = state.user.phone || '';
    byId('setEmail').value = state.user.email || '';
    byId('profilePassword').value = '';
    state.originalEmail = String(state.user.email || '').toLowerCase();
  }

  function applyPreferencesToForm() {
    const preferences = state.preferences;
    setCheckedValue('theme', preferences.theme || 'light');
    setCheckedValue('lang', preferences.language || 'en');
    setCheckedValue('pay', preferences.defaultPayment === 'card' ? 'cod' : (preferences.defaultPayment || 'cod'));
    byId('prefOrderNotifications').checked = Boolean(preferences.orderNotifications);
    byId('prefLowStockNotifications').checked = Boolean(preferences.lowStockNotifications);
    byId('prefPersonalization').checked = Boolean(preferences.personalizationEnabled);
  }

  function applyPreferenceEffects(preferences) {
    const activeLanguage = document.documentElement.lang || getLang();
    localStorage.setItem('am_theme', preferences.theme);
    localStorage.setItem('am_pay', preferences.defaultPayment);
    localStorage.setItem('am_lang', preferences.language);
    document.documentElement.setAttribute('data-theme', preferences.theme);
    document.documentElement.setAttribute('data-bs-theme', preferences.theme);
    if (activeLanguage !== preferences.language) setLang(preferences.language, { persist: false });
  }

  function preferenceControls() {
    return Array.from(document.querySelectorAll('[data-preference-key]'));
  }

  function setPreferenceControlsDisabled(disabled) {
    preferenceControls().forEach((control) => {
      control.disabled = Boolean(disabled);
      control.closest('.set-opt, .preference-switch-row')?.toggleAttribute('aria-busy', Boolean(disabled));
    });
  }

  function setPreferenceSaveStatus(key = 'settings_preferences_auto_save', tone = 'idle') {
    const statuses = Array.from(document.querySelectorAll('.preference-autosave'));
    if (!statuses.length) return;
    if (state.preferenceStatusTimer) {
      clearTimeout(state.preferenceStatusTimer);
      state.preferenceStatusTimer = null;
    }
    statuses.forEach((status) => {
      const icon = status.querySelector('i');
      const message = status.querySelector('span');
      status.dataset.state = tone;
      if (message) {
        message.dataset.i18n = key;
        message.textContent = t(key);
      }
      if (icon) {
        icon.className = tone === 'saving'
          ? 'fa-solid fa-spinner fa-spin'
          : tone === 'saved'
            ? 'fa-solid fa-circle-check'
            : tone === 'error'
              ? 'fa-solid fa-triangle-exclamation'
              : 'fa-solid fa-cloud-arrow-up';
      }
    });
    if (tone === 'saved') {
      state.preferenceStatusTimer = setTimeout(() => {
        setPreferenceSaveStatus();
      }, 2400);
    }
  }

  function preferenceControlValue(control) {
    return control.type === 'checkbox' ? control.checked : control.value;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function addressIdentity(address) {
    return address.label || address.recipientName || address.city || t('settings_saved_address');
  }

  function addressAction(labelKey, action, address, className = 'btn btn-sm btn-outline-secondary') {
    const button = element('button', className, t(labelKey));
    button.type = 'button';
    button.dataset.addressAction = action;
    button.dataset.addressId = address.id;
    button.setAttribute('aria-label', t(`settings_${action}_address_named`, { name: addressIdentity(address) }));
    return button;
  }

  function renderAddresses() {
    const list = byId('addressList');
    list.replaceChildren();
    if (!state.addresses.length) {
      const empty = element('div', 'address-empty');
      empty.append(element('i', 'fa-regular fa-map'), element('p', '', t('settings_addresses_empty')));
      empty.querySelector('i').setAttribute('aria-hidden', 'true');
      list.append(empty);
      return;
    }

    state.addresses.forEach((address) => {
      const card = element('article', 'saved-address');
      card.dataset.addressId = address.id;
      card.setAttribute('aria-label', t('settings_saved_address_named', { name: addressIdentity(address) }));
      const heading = element('div', 'saved-address-heading');
      const title = element('div', 'saved-address-title');
      title.append(element('strong', '', address.label));
      if (address.isDefault) title.append(element('span', 'default-badge', t('settings_default_badge')));
      heading.append(title);

      const actions = element('div', 'saved-address-actions');
      actions.append(addressAction('settings_edit', 'edit', address));
      if (!address.isDefault) actions.append(addressAction('settings_set_default', 'default', address, 'btn btn-sm btn-outline-orange'));
      actions.append(addressAction('settings_remove', 'remove', address, 'btn btn-sm btn-outline-danger'));
      heading.append(actions);
      card.append(heading);

      card.append(element('p', 'saved-address-recipient', `${address.recipientName} · ${address.phone}`));
      card.append(element('p', 'saved-address-lines', [address.addressLine1, address.addressLine2, address.district, address.city, address.postalCode].filter(Boolean).join(', ')));
      if (address.email) card.append(element('p', 'saved-address-meta', address.email));
      if (address.deliveryInstructions) card.append(element('p', 'saved-address-meta', t('settings_instructions_value', { instructions: address.deliveryInstructions })));
      list.append(card);
    });
  }

  function findAddressAction(addressId, action = 'edit') {
    const selector = addressId
      ? `[data-address-id="${CSS.escape(addressId)}"][data-address-action="${action}"]`
      : '';
    return (selector && byId('addressList').querySelector(selector)) || null;
  }

  function focusAddressAction(addressId, action = 'edit') {
    (findAddressAction(addressId, action) || byId('newAddressBtn'))?.focus();
  }

  function updateAddressFormTitle() {
    const title = byId('addressFormTitle');
    if (!title) return;
    const key = state.editingAddressId ? 'settings_edit_delivery_address' : 'settings_add_delivery_address';
    title.dataset.i18n = key;
    title.textContent = t(key);
  }

  function hideAddressForm(options = {}) {
    const returnFocus = options.restoreFocus !== false ? state.addressReturnFocus : null;
    state.editingAddressId = null;
    byId('addressForm').hidden = true;
    byId('addressForm').reset();
    byId('addressDefault').disabled = false;
    clearValidation(byId('addressForm'), 'addressError');
    updateAddressFormTitle();
    state.addressReturnFocus = null;
    if (returnFocus?.isConnected) returnFocus.focus();
    else if (options.restoreFocus !== false) byId('newAddressBtn').focus();
  }

  function openAddressForm(address = null, returnFocus = document.activeElement) {
    state.editingAddressId = address?.id || null;
    state.addressReturnFocus = returnFocus instanceof HTMLElement ? returnFocus : byId('newAddressBtn');
    const form = byId('addressForm');
    form.reset();
    clearValidation(form, 'addressError');
    updateAddressFormTitle();
    byId('addressLabel').value = address?.label || '';
    byId('addressRecipient').value = address?.recipientName || state.user.displayName || '';
    byId('addressPhone').value = address?.phone || state.user.phone || '';
    byId('addressEmail').value = address?.email || state.user.email || '';
    byId('addressLine1').value = address?.addressLine1 || '';
    byId('addressLine2').value = address?.addressLine2 || '';
    byId('addressDistrict').value = address?.district || '';
    byId('addressCity').value = address?.city || '';
    byId('addressPostalCode').value = address?.postalCode || '';
    byId('addressInstructions').value = address?.deliveryInstructions || '';
    byId('addressDefault').checked = address ? address.isDefault : state.addresses.length === 0;
    byId('addressDefault').disabled = Boolean(address?.isDefault);
    form.hidden = false;
    byId('addressLabel').focus();
    form.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  }

  async function reloadAddresses() {
    const payload = await guardedAuth(StoreAPI.addresses.list());
    state.addresses = payload.addresses || [];
    state.sections.addresses = true;
    savedAddresses = state.addresses.slice();
    renderAddresses();
  }

  function addressPayload() {
    const phone = normalizedPhone(byId('addressPhone').value, true);
    const email = byId('addressEmail').value.trim().toLowerCase();
    const payload = {
      label: byId('addressLabel').value.trim(),
      recipientName: byId('addressRecipient').value.trim(),
      phone,
      email: email || null,
      addressLine1: byId('addressLine1').value.trim(),
      addressLine2: byId('addressLine2').value.trim() || null,
      district: byId('addressDistrict').value.trim(),
      city: byId('addressCity').value.trim(),
      postalCode: byId('addressPostalCode').value.trim() || null,
      deliveryInstructions: byId('addressInstructions').value.trim() || null,
      isDefault: byId('addressDefault').checked
    };

    const checks = [
      ['addressLabel', payload.label.length >= 1],
      ['addressRecipient', payload.recipientName.length >= 2],
      ['addressPhone', Boolean(phone)],
      ['addressEmail', !email || emailPattern.test(email)],
      ['addressLine1', payload.addressLine1.length >= 4],
      ['addressDistrict', payload.district.length >= 2],
      ['addressCity', payload.city.length >= 2]
    ];
    checks.forEach(([id, valid]) => markInvalid(byId(id), 'addressError', !valid));
    const firstInvalid = checks.find(([, valid]) => !valid);
    if (firstInvalid) {
      setError('addressError', 'settings_address_validation_error');
      byId(firstInvalid[0]).focus();
      return null;
    }
    return payload;
  }

  function registerProfileActions() {
    byId('profileForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      clearValidation(event.currentTarget, 'profileError');
      const displayName = byId('setName').value.trim();
      const email = byId('setEmail').value.trim().toLowerCase();
      const rawPhone = byId('setPhone').value.trim();
      const phone = normalizedPhone(rawPhone, false);
      const emailChanged = email !== state.originalEmail;
      const currentPassword = byId('profilePassword').value;

      const checks = [
        ['setName', displayName.length >= 2],
        ['setEmail', emailPattern.test(email)],
        ['setPhone', !rawPhone || Boolean(phone)],
        ['profilePassword', !emailChanged || Boolean(currentPassword)]
      ];
      checks.forEach(([id, valid]) => markInvalid(byId(id), 'profileError', !valid));
      const firstInvalid = checks.find(([, valid]) => !valid);
      if (firstInvalid) {
        setError('profileError', emailChanged && !currentPassword
          ? 'settings_profile_password_required_error'
          : 'settings_profile_validation_error');
        byId(firstInvalid[0]).focus();
        return;
      }

      const changes = {};
      if (displayName !== state.user.displayName) changes.displayName = displayName;
      if (emailChanged) {
        changes.email = email;
        changes.currentPassword = currentPassword;
      }
      if ((phone || null) !== (state.user.phone || null)) changes.phone = phone;
      if (!Object.keys(changes).length) {
        toast(t('settings_profile_current'));
        return;
      }

      await withBusy(byId('saveProfile'), async () => {
        try {
          const payload = await guardedAuth(StoreAPI.profile.update(changes));
          state.user = payload.user;
          state.originalEmail = state.user.email.toLowerCase();
          byId('profilePassword').value = '';
          fillProfile();
          syncCoreAccountState();
          toast(t('settings_profile_updated'));
        } catch (error) {
          if (handleUnauthorized(error)) return;
          console.error(error);
          setError('profileError', apiMessageKey(error, 'settings_profile_update_error'));
        }
      }, 'settings_saving_profile');
    });

    byId('logoutBtn').addEventListener('click', async () => {
      await withBusy(byId('logoutBtn'), async () => {
        try {
          const logout = async () => {
            await guardedAuth(StoreAPI.auth.logout());
            completeClientSignOut('logout');
          };
          await runAuthSessionMutation(logout);
          location.replace('index.html');
        } catch (error) {
          if (handleUnauthorized(error)) return;
          console.error(error);
          setError('profileError', apiMessageKey(error, 'settings_logout_error'));
        }
      }, 'settings_signing_out');
    });
  }

  function registerPasswordAction() {
    byId('passwordForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      clearValidation(event.currentTarget, 'passwordError');
      const currentPassword = byId('currentPassword').value;
      const newPassword = byId('newPassword').value;
      const confirmation = byId('confirmPassword').value;
      const checks = [
        ['currentPassword', Boolean(currentPassword)],
        ['newPassword', newPassword.length >= 12 && newPassword.length <= 128],
        ['confirmPassword', confirmation === newPassword && Boolean(confirmation)]
      ];
      checks.forEach(([id, valid]) => markInvalid(byId(id), 'passwordError', !valid));
      const firstInvalid = checks.find(([, valid]) => !valid);
      if (firstInvalid) {
        setError('passwordError', newPassword.length < 12 ? 'settings_password_length_error' : 'settings_password_match_error');
        byId(firstInvalid[0]).focus();
        return;
      }

      await withBusy(byId('changePasswordBtn'), async () => {
        try {
          const changePassword = async () => {
            await guardedAuth(StoreAPI.auth.changePassword({ currentPassword, newPassword }));
            if (typeof broadcastStoreSessionInvalidated === 'function') {
              broadcastStoreSessionInvalidated('password-changed', state.user?.id || currentUser?.id);
            }
          };
          await runAuthSessionMutation(changePassword);
          event.currentTarget.reset();
          toast(t('settings_password_changed'));
        } catch (error) {
          if (handleUnauthorized(error)) return;
          console.error(error);
          setError('passwordError', apiMessageKey(error, 'settings_password_change_error'));
        }
      }, 'settings_updating_password');
    });
  }

  function registerPreferenceAction() {
    preferenceControls().forEach((control) => {
      control.addEventListener('change', async () => {
        if (!state.preferences || !state.sections.preferences || state.preferenceSaving) {
          applyPreferencesToForm();
          return;
        }
        const key = control.dataset.preferenceKey;
        const nextValue = preferenceControlValue(control);
        if (state.preferences[key] === nextValue) return;
        const previous = { ...state.preferences };
        const optimistic = { ...previous, [key]: nextValue };
        state.preferenceSaving = true;
        state.preferences = optimistic;
        currentPreferences = { ...optimistic };
        setError('preferencesError');
        setPreferenceSaveStatus('settings_preferences_saving', 'saving');
        setPreferenceControlsDisabled(true);
        applyPreferenceEffects(optimistic);
        try {
          const payload = await guardedAuth(StoreAPI.preferences.update({ [key]: nextValue }));
          if (!payload?.preferences) throw Object.assign(new Error(), { code: 'INVALID_RESPONSE' });
          state.preferences = fallbackPreferences(payload.preferences);
          currentPreferences = { ...state.preferences };
          applyPreferencesToForm();
          applyPreferenceEffects(state.preferences);
          setPreferenceSaveStatus('settings_preferences_saved_inline', 'saved');
          toast(t('settings_preferences_saved'));
        } catch (error) {
          if (handleUnauthorized(error)) return;
          console.error(error);
          state.preferences = previous;
          currentPreferences = { ...previous };
          applyPreferencesToForm();
          applyPreferenceEffects(previous);
          const messageKey = apiMessageKey(error, 'settings_preferences_error_retry');
          setPreferenceSaveStatus(messageKey, 'error');
          setError('preferencesError', messageKey);
          toast(t(messageKey));
        } finally {
          state.preferenceSaving = false;
          if (state.sections.preferences) setPreferenceControlsDisabled(false);
        }
      });
    });
  }

  function registerAddressActions() {
    byId('newAddressBtn').addEventListener('click', (event) => openAddressForm(null, event.currentTarget));
    byId('cancelAddressBtn').addEventListener('click', hideAddressForm);
    byId('addressForm').addEventListener('input', (event) => {
      if (event.target.matches('input, textarea')) markInvalid(event.target, 'addressError', false);
      setError('addressError');
    });
    byId('addressForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      setError('addressError');
      const input = addressPayload();
      if (!input) return;
      await withBusy(byId('saveAddressBtn'), async () => {
        try {
          const editingId = state.editingAddressId;
          const result = editingId
            ? await guardedAuth(StoreAPI.addresses.update(editingId, input))
            : await guardedAuth(StoreAPI.addresses.create(input));
          const savedAddressId = result?.address?.id || editingId;
          await reloadAddresses();
          hideAddressForm({ restoreFocus: false });
          focusAddressAction(savedAddressId);
          toast(t('settings_address_saved'));
        } catch (error) {
          if (handleUnauthorized(error)) return;
          console.error(error);
          setError('addressError', apiMessageKey(error, 'settings_address_save_error'));
        }
      }, 'settings_saving_address');
    });

    byId('addressList').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-address-action]');
      if (!button) return;
      setError('addressListError');
      const address = state.addresses.find((item) => item.id === button.dataset.addressId);
      if (!address) return;
      const action = button.dataset.addressAction;
      if (action === 'edit') {
        openAddressForm(address, button);
        return;
      }
      if (action === 'remove' && !window.confirm(t('settings_confirm_remove_address', { name: addressIdentity(address) }))) return;

      await withBusy(button, async () => {
        try {
          const oldIndex = state.addresses.findIndex((item) => item.id === address.id);
          if (action === 'default') await guardedAuth(StoreAPI.addresses.setDefault(address.id));
          if (action === 'remove') await guardedAuth(StoreAPI.addresses.remove(address.id));
          await reloadAddresses();
          if (state.editingAddressId === address.id) hideAddressForm();
          if (action === 'remove') {
            const nextAddress = state.addresses[Math.min(oldIndex, Math.max(0, state.addresses.length - 1))];
            focusAddressAction(nextAddress?.id);
          } else {
            focusAddressAction(address.id);
          }
          toast(t(action === 'remove' ? 'settings_address_removed' : 'settings_default_address_updated'));
        } catch (error) {
          if (handleUnauthorized(error)) return;
          console.error(error);
          setError('addressListError', apiMessageKey(error, 'settings_address_update_error'));
        }
      }, action === 'remove' ? 'settings_removing_address' : 'settings_updating_address');
    });
  }

  function incompleteClearError(errors = []) {
    return errors.find((error) => error?.status === 401) || errors.find(Boolean) ||
      Object.assign(new Error(), { code: 'PARTIAL_CLEAR_FAILED' });
  }

  async function clearCartData() {
    let clearError = null;
    try {
      await guardedAuth(StoreAPI.cart.clear());
    } catch (error) {
      clearError = error;
    }

    try {
      cart = adoptAuthenticatedCart(await guardedAuth(StoreAPI.cart.get()));
      updateBadges();
      if (cart.length === 0) return;
    } catch (reconcileError) {
      if (!clearError) {
        cart = adoptAuthenticatedCartState([]);
        updateBadges();
      }
      throw incompleteClearError([clearError, reconcileError]);
    }
    throw incompleteClearError([clearError]);
  }

  async function clearWishlistData() {
    const payload = await guardedAuth(StoreAPI.wishlist.get());
    wishlist = adoptAuthenticatedWishlist(payload);
    updateBadges();
    const targetIds = [...new Set((payload.items || []).map((item) => String(item.productId)))];
    const confirmedRemoved = new Set();
    const failures = [];

    for (const productId of targetIds) {
      try {
        await guardedAuth(StoreAPI.wishlist.removeItem(productId));
        confirmedRemoved.add(productId);
      } catch (error) {
        failures.push(error);
      }
    }

    try {
      const current = await guardedAuth(StoreAPI.wishlist.get());
      wishlist = adoptAuthenticatedWishlist(current);
      updateBadges();
      if (wishlist.length === 0) return;
    } catch (error) {
      wishlist = adoptAuthenticatedWishlistState(
        wishlist.filter((productId) => !confirmedRemoved.has(String(productId)))
      );
      updateBadges();
      failures.push(error);
    }

    throw incompleteClearError(failures);
  }

  async function clearRecentData() {
    let clearError = null;
    try {
      await guardedAuth(StoreAPI.recent.clear());
    } catch (error) {
      clearError = error;
    }
    try {
      const current = await guardedAuth(StoreAPI.recent.list({ limit: 50 }));
      authenticatedRecent = (current.products || []).map((product) => ({
        id: product.id,
        name: product.name,
        price: product.price,
        image_url: product.imageUrl,
        brand_name: product.brand || '',
        is_available: product.isAvailable
      }));
      if (authenticatedRecent.length === 0) return;
    } catch (reconcileError) {
      if (!clearError) authenticatedRecent = [];
      throw incompleteClearError([clearError, reconcileError]);
    }
    throw incompleteClearError([clearError]);
  }

  async function clearSearchData() {
    let clearError = null;
    try {
      await guardedAuth(StoreAPI.search.clearHistory());
    } catch (error) {
      clearError = error;
    }
    try {
      const current = await guardedAuth(StoreAPI.search.history({ limit: 50 }));
      authenticatedSearches = current.searches || [];
      if (authenticatedSearches.length === 0) return;
    } catch (reconcileError) {
      if (!clearError) authenticatedSearches = [];
      throw incompleteClearError([clearError, reconcileError]);
    }
    throw incompleteClearError([clearError]);
  }

  function registerDataActions() {
    const actions = [
      ['clearCartBtn', 'cart', clearCartData],
      ['clearWishBtn', 'wishlist', clearWishlistData],
      ['clearRecentBtn', 'recent', clearRecentData],
      ['clearSearchBtn', 'search', clearSearchData]
    ];
    actions.forEach(([buttonId, dataKey, action]) => {
      byId(buttonId).addEventListener('click', async () => {
        setError('dataError');
        if (!window.confirm(t(`settings_confirm_clear_${dataKey}`))) return;
        await withBusy(byId(buttonId), async () => {
          try {
            await action();
            toast(t(`settings_${dataKey}_cleared`));
          } catch (error) {
            if (handleUnauthorized(error)) return;
            console.error(error);
            setError('dataError', apiMessageKey(error, `settings_clear_${dataKey}_error`));
          }
        }, 'settings_clearing_data');
      });
    });

    byId('clearActivityBtn').addEventListener('click', async () => {
      setError('dataError');
      if (!window.confirm(t('settings_confirm_clear_activity'))) return;
      await withBusy(byId('clearActivityBtn'), async () => {
        const results = await Promise.allSettled([
          clearCartData(),
          clearWishlistData(),
          clearRecentData(),
          clearSearchData()
        ]);
        const failure = results.find((result) => result.status === 'rejected' &&
          (result.reason?.status === 401 || result.reason?.code === 'STALE_AUTH_RESPONSE')) ||
          results.find((result) => result.status === 'rejected');
        if (!failure) {
          toast(t('settings_activity_cleared'));
          return;
        }
        if (handleUnauthorized(failure.reason)) return;
        console.error(failure.reason);
        setError('dataError', apiMessageKey(failure.reason, 'settings_clear_activity_error'));
      }, 'settings_clearing_activity');
    });
  }

  function registerAccountActions() {
    async function closeAccount(action, button) {
      setError('accountError');
      const password = byId('accountPassword').value;
      if (!password) {
        markInvalid(byId('accountPassword'), 'accountError', true);
        setError('accountError', 'settings_account_password_error');
        byId('accountPassword').focus();
        return;
      }
      if (action === 'delete' && byId('deleteConfirmation').value !== 'DELETE') {
        markInvalid(byId('deleteConfirmation'), 'accountError', true);
        setError('accountError', 'settings_delete_confirmation_error');
        byId('deleteConfirmation').focus();
        return;
      }
      const confirmation = action === 'delete'
        ? t('settings_confirm_delete_account')
        : t('settings_confirm_deactivate_account');
      if (!window.confirm(confirmation)) return;

      await withBusy(button, async () => {
        try {
          const closeSession = async () => {
            await guardedAuth(StoreAPI.profile.deactivate({ password, action }));
            completeClientSignOut('account-closed');
          };
          await runAuthSessionMutation(closeSession);
          window.location.assign(`login.html?account=${action === 'delete' ? 'deleted' : 'deactivated'}`);
        } catch (error) {
          if (handleUnauthorized(error)) return;
          console.error(error);
          setError('accountError', apiMessageKey(error, 'settings_account_action_error'));
        }
      }, action === 'delete' ? 'settings_deleting_account' : 'settings_deactivating_account');
    }

    byId('accountPassword').addEventListener('input', () => markInvalid(byId('accountPassword'), 'accountError', false));
    byId('deleteConfirmation').addEventListener('input', () => markInvalid(byId('deleteConfirmation'), 'accountError', false));
    byId('deactivateAccountBtn').addEventListener('click', () => closeAccount('deactivate', byId('deactivateAccountBtn')));
    byId('deleteAccountBtn').addEventListener('click', () => closeAccount('delete', byId('deleteAccountBtn')));
  }

  function registerInputCleanup() {
    document.querySelectorAll('#profileForm input, #passwordForm input').forEach((input) => {
      input.addEventListener('input', () => {
        const errorId = input.closest('form').id === 'profileForm' ? 'profileError' : 'passwordError';
        markInvalid(input, errorId, false);
        setError(errorId);
      });
    });
  }

  async function initSettings() {
    if (state.loading) return;
    state.loading = true;
    showLoading();
    try {
      if (!window.StoreAPI) {
        showLoadError({ code: 'SERVICE_UNAVAILABLE' });
        return;
      }
      const session = await guardedAuth(StoreAPI.auth.session());
      if (!session.authenticated) {
        transitionToGuestAfterAuthFailure();
        return;
      }

      const results = await Promise.allSettled([
        guardedAuth(StoreAPI.profile.get()),
        guardedAuth(StoreAPI.preferences.get()),
        guardedAuth(StoreAPI.addresses.list())
      ]);
      const unauthorized = results.find((result) => result.status === 'rejected' && result.reason?.status === 401);
      if (unauthorized) {
        transitionToGuestAfterAuthFailure();
        return;
      }
      if (results.some((result) => result.status === 'rejected' && result.reason?.code === 'STALE_AUTH_RESPONSE')) return;

      const [profileResult, preferenceResult, addressResult] = results;
      const profileLoaded = profileResult.status === 'fulfilled' && Boolean(profileResult.value?.user);
      const preferencesLoaded = preferenceResult.status === 'fulfilled' && Boolean(preferenceResult.value?.preferences);
      const addressesLoaded = addressResult.status === 'fulfilled' && Array.isArray(addressResult.value?.addresses);

      state.user = profileLoaded ? profileResult.value.user : session.user;
      if (!state.user) throw Object.assign(new Error(), { code: 'INVALID_SESSION' });
      state.preferences = fallbackPreferences(preferencesLoaded
        ? preferenceResult.value.preferences
        : session.user?.preferences);
      state.addresses = addressesLoaded ? addressResult.value.addresses : [];
      state.sections.profile = profileLoaded;
      state.sections.preferences = preferencesLoaded;
      state.sections.addresses = addressesLoaded;
      syncCoreAccountState();
      fillProfile();
      applyPreferencesToForm();
      applyPreferenceEffects(state.preferences);
      setPreferenceSaveStatus();
      if (addressesLoaded) renderAddresses();
      else byId('addressList').replaceChildren();
      if (!state.actionsRegistered) {
        registerProfileActions();
        registerPasswordAction();
        registerPreferenceAction();
        registerAddressActions();
        registerDataActions();
        registerAccountActions();
        registerInputCleanup();
        state.actionsRegistered = true;
      }
      showAccount();
      setSectionRecovery('profile', !profileLoaded);
      setSectionRecovery('preferences', !preferencesLoaded);
      setSectionRecovery('addresses', !addressesLoaded);
    } catch (error) {
      if (error?.code === 'STALE_AUTH_RESPONSE') return;
      if (error?.status === 401) {
        transitionToGuestAfterAuthFailure();
      } else {
        showLoadError(error);
      }
    } finally {
      state.loading = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    byId('retrySettingsBtn').addEventListener('click', () => initSettings());
    byId('retryProfileBtn').addEventListener('click', retryProfileSection);
    byId('retryPreferencesBtn').addEventListener('click', retryPreferencesSection);
    byId('retryAddressesBtn').addEventListener('click', retryAddressesSection);
    window.addEventListener('am:langchange', () => {
      rerenderDynamicMessages();
      if (state.user) {
        const returnAddressId = state.addressReturnFocus?.dataset.addressId;
        const returnAction = state.addressReturnFocus?.dataset.addressAction;
        if (state.sections.addresses) renderAddresses();
        if (returnAddressId && returnAction) {
          state.addressReturnFocus = findAddressAction(returnAddressId, returnAction) || byId('newAddressBtn');
        }
        updateAddressFormTitle();
      }
    });
    whenStoreReady(initSettings);
  });

  window.addEventListener('am:session-expired', transitionSettingsAfterSharedSignOut);
})();
