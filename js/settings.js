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
    originalEmail: ''
  };

  const byId = (id) => document.getElementById(id);
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function setError(id, message = '') {
    const target = byId(id);
    if (target) target.textContent = message;
  }

  function apiMessage(error, fallback) {
    if (error && typeof error.message === 'string' && error.message.trim()) return error.message;
    return fallback;
  }

  function markInvalid(input, errorId, invalid) {
    if (!input) return;
    input.classList.toggle('is-invalid', invalid);
    if (invalid) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', errorId);
    } else {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
  }

  function clearValidation(form, errorId) {
    form?.querySelectorAll('.is-invalid').forEach((input) => markInvalid(input, errorId, false));
    setError(errorId);
  }

  async function withBusy(button, work) {
    if (!button || button.disabled) return undefined;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      return await work();
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
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
    savedAddresses = state.addresses.slice();
    renderAccountPanel();
    updateAccountUI();
  }

  function clearClientAccountState(preserveGuestCommerce = false) {
    state.user = null;
    state.preferences = null;
    state.addresses = [];
    state.editingAddressId = null;
    currentUser = null;
    currentPreferences = null;
    savedAddresses = [];
    if (!preserveGuestCommerce) {
      cart = [];
      wishlist = [];
      orders = [];
    }
    accountNotifications = [];
    authenticatedRecent = [];
    authenticatedSearches = [];
    localStorage.removeItem('am_user');
    localStorage.removeItem('am_profile');
    localStorage.removeItem('am_delivery');
    sessionStorage.removeItem('am_user');
    updateBadges();
    renderNotifMenu();
    renderAccountPanel();
    updateAccountUI();
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

  function showLoadError(error) {
    byId('settingsLoading').hidden = true;
    byId('settingsGuest').hidden = true;
    byId('settingsAccount').hidden = true;
    const alert = byId('settingsLoadError');
    alert.textContent = apiMessage(error, 'Your settings could not be loaded. Please refresh and try again.');
    alert.hidden = false;
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
    localStorage.setItem('am_theme', preferences.theme);
    localStorage.setItem('am_pay', preferences.defaultPayment);
    document.documentElement.setAttribute('data-theme', preferences.theme);
    document.documentElement.setAttribute('data-bs-theme', preferences.theme);
    if (getLang() !== preferences.language) setLang(preferences.language, { persist: false });
    else localStorage.setItem('am_lang', preferences.language);
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function addressAction(label, action, id, className = 'btn btn-sm btn-outline-secondary') {
    const button = element('button', className, label);
    button.type = 'button';
    button.dataset.addressAction = action;
    button.dataset.addressId = id;
    return button;
  }

  function renderAddresses() {
    const list = byId('addressList');
    setError('addressListError');
    list.replaceChildren();
    if (!state.addresses.length) {
      const empty = element('div', 'address-empty');
      empty.append(element('i', 'fa-regular fa-map'), element('p', '', 'No saved addresses yet. Add one to make checkout faster.'));
      empty.querySelector('i').setAttribute('aria-hidden', 'true');
      list.append(empty);
      return;
    }

    state.addresses.forEach((address) => {
      const card = element('article', 'saved-address');
      const heading = element('div', 'saved-address-heading');
      const title = element('div', 'saved-address-title');
      title.append(element('strong', '', address.label));
      if (address.isDefault) title.append(element('span', 'default-badge', 'Default'));
      heading.append(title);

      const actions = element('div', 'saved-address-actions');
      actions.append(addressAction('Edit', 'edit', address.id));
      if (!address.isDefault) actions.append(addressAction('Set default', 'default', address.id, 'btn btn-sm btn-outline-orange'));
      actions.append(addressAction('Remove', 'remove', address.id, 'btn btn-sm btn-outline-danger'));
      heading.append(actions);
      card.append(heading);

      card.append(element('p', 'saved-address-recipient', `${address.recipientName} · ${address.phone}`));
      card.append(element('p', 'saved-address-lines', [address.addressLine1, address.addressLine2, address.district, address.city, address.postalCode].filter(Boolean).join(', ')));
      if (address.email) card.append(element('p', 'saved-address-meta', address.email));
      if (address.deliveryInstructions) card.append(element('p', 'saved-address-meta', `Instructions: ${address.deliveryInstructions}`));
      list.append(card);
    });
  }

  function hideAddressForm() {
    state.editingAddressId = null;
    byId('addressForm').hidden = true;
    byId('addressForm').reset();
    byId('addressDefault').disabled = false;
    clearValidation(byId('addressForm'), 'addressError');
  }

  function openAddressForm(address = null) {
    state.editingAddressId = address?.id || null;
    const form = byId('addressForm');
    form.reset();
    clearValidation(form, 'addressError');
    byId('addressFormTitle').textContent = address ? 'Edit delivery address' : 'Add a delivery address';
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
    const payload = await StoreAPI.addresses.list();
    state.addresses = payload.addresses || [];
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
      setError('addressError', 'Complete every required field and use a Moroccan phone number in +212 format.');
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
          ? 'Enter your current password to change your email.'
          : 'Enter a valid name, email and Moroccan phone number.');
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
        toast('Your profile is already up to date.');
        return;
      }

      await withBusy(byId('saveProfile'), async () => {
        try {
          const payload = await StoreAPI.profile.update(changes);
          state.user = payload.user;
          state.originalEmail = state.user.email.toLowerCase();
          byId('profilePassword').value = '';
          fillProfile();
          syncCoreAccountState();
          toast('Profile updated securely.');
        } catch (error) {
          setError('profileError', apiMessage(error, 'Your profile could not be updated.'));
        }
      });
    });

    byId('logoutBtn').addEventListener('click', async () => {
      await withBusy(byId('logoutBtn'), async () => {
        try {
          await StoreAPI.auth.logout();
          clearClientAccountState();
          location.replace('index.html');
        } catch (error) {
          setError('profileError', apiMessage(error, 'You could not be signed out.'));
        }
      });
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
        setError('passwordError', newPassword.length < 12 ? 'Your new password must contain at least 12 characters.' : 'The new passwords do not match.');
        byId(firstInvalid[0]).focus();
        return;
      }

      await withBusy(byId('changePasswordBtn'), async () => {
        try {
          await StoreAPI.auth.changePassword({ currentPassword, newPassword });
          event.currentTarget.reset();
          toast('Password changed. Other signed-in sessions were closed.');
        } catch (error) {
          setError('passwordError', apiMessage(error, 'Your password could not be changed.'));
        }
      });
    });
  }

  function registerPreferenceAction() {
    byId('savePreferencesBtn').addEventListener('click', async () => {
      setError('preferencesError');
      const input = {
        language: checkedValue('lang'),
        theme: checkedValue('theme'),
        defaultPayment: checkedValue('pay'),
        orderNotifications: byId('prefOrderNotifications').checked,
        lowStockNotifications: byId('prefLowStockNotifications').checked,
        personalizationEnabled: byId('prefPersonalization').checked
      };
      await withBusy(byId('savePreferencesBtn'), async () => {
        try {
          const payload = await StoreAPI.preferences.update(input);
          state.preferences = payload.preferences;
          currentPreferences = { ...state.preferences };
          applyPreferencesToForm();
          applyPreferenceEffects(state.preferences);
          toast('Preferences saved to your account.');
        } catch (error) {
          setError('preferencesError', apiMessage(error, 'Your preferences could not be saved.'));
          applyPreferencesToForm();
        }
      });
    });
  }

  function registerAddressActions() {
    byId('newAddressBtn').addEventListener('click', () => openAddressForm());
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
          if (state.editingAddressId) await StoreAPI.addresses.update(state.editingAddressId, input);
          else await StoreAPI.addresses.create(input);
          await reloadAddresses();
          hideAddressForm();
          toast('Address saved to your account.');
        } catch (error) {
          setError('addressError', apiMessage(error, 'The address could not be saved.'));
        }
      });
    });

    byId('addressList').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-address-action]');
      if (!button) return;
      const address = state.addresses.find((item) => item.id === button.dataset.addressId);
      if (!address) return;
      const action = button.dataset.addressAction;
      if (action === 'edit') {
        openAddressForm(address);
        return;
      }
      if (action === 'remove' && !window.confirm(`Remove the saved address “${address.label}”?`)) return;

      await withBusy(button, async () => {
        try {
          if (action === 'default') await StoreAPI.addresses.setDefault(address.id);
          if (action === 'remove') await StoreAPI.addresses.remove(address.id);
          await reloadAddresses();
          if (state.editingAddressId === address.id) hideAddressForm();
          toast(action === 'remove' ? 'Address removed.' : 'Default address updated.');
        } catch (error) {
          setError('addressListError', apiMessage(error, 'The address could not be updated.'));
        }
      });
    });
  }

  async function clearCartData() {
    await StoreAPI.cart.clear();
    cart = [];
    updateBadges();
  }

  async function clearWishlistData() {
    const payload = await StoreAPI.wishlist.get();
    for (const item of payload.items || []) await StoreAPI.wishlist.removeItem(item.productId);
    wishlist = [];
    updateBadges();
  }

  async function clearRecentData() {
    await StoreAPI.recent.clear();
    authenticatedRecent = [];
  }

  async function clearSearchData() {
    await StoreAPI.search.clearHistory();
    authenticatedSearches = [];
  }

  function registerDataActions() {
    const actions = [
      ['clearCartBtn', 'your cart', clearCartData],
      ['clearWishBtn', 'your wishlist', clearWishlistData],
      ['clearRecentBtn', 'your recently viewed products', clearRecentData],
      ['clearSearchBtn', 'your search history', clearSearchData]
    ];
    actions.forEach(([buttonId, label, action]) => {
      byId(buttonId).addEventListener('click', async () => {
        setError('dataError');
        if (!window.confirm(`Clear ${label} from your account?`)) return;
        await withBusy(byId(buttonId), async () => {
          try {
            await action();
            toast(`${label.charAt(0).toUpperCase()}${label.slice(1)} cleared.`);
          } catch (error) {
            setError('dataError', apiMessage(error, `Could not clear ${label}.`));
          }
        });
      });
    });

    byId('clearActivityBtn').addEventListener('click', async () => {
      setError('dataError');
      if (!window.confirm('Clear your cart, wishlist, recently viewed products and search history? Your orders will remain available.')) return;
      await withBusy(byId('clearActivityBtn'), async () => {
        try {
          await clearCartData();
          await clearWishlistData();
          await Promise.all([clearRecentData(), clearSearchData()]);
          toast('Shopping activity cleared from your account.');
        } catch (error) {
          setError('dataError', apiMessage(error, 'Some account activity could not be cleared. Refresh to see the current state.'));
        }
      });
    });
  }

  function registerAccountActions() {
    async function closeAccount(action, button) {
      setError('accountError');
      const password = byId('accountPassword').value;
      if (!password) {
        markInvalid(byId('accountPassword'), 'accountError', true);
        setError('accountError', 'Enter your current password to continue.');
        byId('accountPassword').focus();
        return;
      }
      if (action === 'delete' && byId('deleteConfirmation').value !== 'DELETE') {
        markInvalid(byId('deleteConfirmation'), 'accountError', true);
        setError('accountError', 'Type DELETE exactly to confirm permanent deletion.');
        byId('deleteConfirmation').focus();
        return;
      }
      const confirmation = action === 'delete'
        ? 'Permanently delete and anonymize this account? This cannot be undone.'
        : 'Deactivate this account? You will be signed out and will not be able to sign in again.';
      if (!window.confirm(confirmation)) return;

      await withBusy(button, async () => {
        try {
          await StoreAPI.profile.deactivate({ password, action });
          clearClientAccountState();
          window.location.assign(`login.html?account=${action === 'delete' ? 'deleted' : 'deactivated'}`);
        } catch (error) {
          setError('accountError', apiMessage(error, 'The account action could not be completed.'));
        }
      });
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
    if (!window.StoreAPI) {
      showLoadError(new Error('The secure account service is unavailable.'));
      return;
    }
    try {
      const session = await StoreAPI.auth.session();
      if (!session.authenticated) {
        clearClientAccountState(true);
        showGuest();
        return;
      }

      const [profilePayload, preferencePayload, addressPayload] = await Promise.all([
        StoreAPI.profile.get(),
        StoreAPI.preferences.get(),
        StoreAPI.addresses.list()
      ]);
      state.user = profilePayload.user || session.user;
      state.preferences = preferencePayload.preferences || session.user.preferences;
      state.addresses = addressPayload.addresses || [];
      syncCoreAccountState();
      fillProfile();
      applyPreferencesToForm();
      renderAddresses();
      registerProfileActions();
      registerPasswordAction();
      registerPreferenceAction();
      registerAddressActions();
      registerDataActions();
      registerAccountActions();
      registerInputCleanup();
      showAccount();
    } catch (error) {
      if (error?.status === 401) {
        clearClientAccountState(true);
        showGuest();
      } else {
        showLoadError(error);
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    whenStoreReady(initSettings);
  });
})();
