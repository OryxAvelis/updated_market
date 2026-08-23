/**
 * AM MARKET — settings.js (settings.html)
 * Profile (guest-friendly), appearance (dark/light), language,
 * default payment, delivery defaults and local data management.
 * All values persist in localStorage and are shared with every page.
 */

function initSettings() {
  // ---------- Profile ----------
  const u = getProfile();
  $('setName').value = u && u.name ? u.name : '';
  $('setEmail').value = u && u.email ? u.email : '';
  const refreshProfileUI = () => {
    const logged = !!getUser();
    $('logoutBtn').style.display = logged ? '' : 'none';
    $('loginHintBtn').style.display = logged ? 'none' : '';
    $('guestProfileNote').hidden = logged;
    $('guestProfileNote').style.display = logged ? 'none' : '';
  };
  refreshProfileUI();

  $('saveProfile').onclick = () => {
    const name = $('setName').value.trim();
    const email = $('setEmail').value.trim();
    const validEmail = !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    ['setName', 'setEmail'].forEach(id => {
      $(id).classList.remove('is-invalid');
      $(id).removeAttribute('aria-invalid');
      $(id).removeAttribute('aria-describedby');
    });
    if (!name || !validEmail) {
      if (!name) $('setName').classList.add('is-invalid');
      if (!validEmail) $('setEmail').classList.add('is-invalid');
      $('profileError').textContent = t('set_profile_error');
      $('profileError').dataset.errorKey = 'set_profile_error';
      ['setName', 'setEmail'].forEach(id => {
        if ($(id).classList.contains('is-invalid')) {
          $(id).setAttribute('aria-invalid', 'true');
          $(id).setAttribute('aria-describedby', 'profileError');
        }
      });
      (!name ? $('setName') : $('setEmail')).focus();
      return;
    }
    $('profileError').textContent = '';
    delete $('profileError').dataset.errorKey;
    const storageKey = getUser() ? 'am_user' : 'am_profile';
    localStorage.setItem(storageKey, JSON.stringify({ name, email }));
    renderAccountPanel();
    updateAccountUI();
    refreshProfileUI();
    toast(t('set_saved'));
  };

  $('logoutBtn').onclick = () => {
    localStorage.removeItem('am_user');
    sessionStorage.removeItem('am_user');
    renderAccountPanel();
    updateAccountUI();
    refreshProfileUI();
    const profile = getProfile();
    $('setName').value = profile.name || '';
    $('setEmail').value = profile.email || '';
    toast(t('logged_out'));
  };

  // ---------- Appearance (dark / light) ----------
  const themeInputs = document.querySelectorAll('input[name="theme"]');
  const syncThemeOpts = () => {
    const cur = getTheme();
    themeInputs.forEach(r => r.checked = r.value === cur);
  };
  syncThemeOpts();
  themeInputs.forEach(r => r.addEventListener('change', () => {
    if (r.checked) { setTheme(r.value); toast(t('set_saved')); }
  }));

  // ---------- Language ----------
  const langInputs = document.querySelectorAll('input[name="lang"]');
  langInputs.forEach(r => r.checked = r.value === getLang());
  langInputs.forEach(r => r.addEventListener('change', () => {
    if (r.checked) setLang(r.value); // applyI18n + am:langchange re-render this page
  }));

  // ---------- Default payment ----------
  const payInputs = document.querySelectorAll('input[name="pay"]');
  const curPay = getDefaultPay();
  payInputs.forEach(r => r.checked = r.value === curPay);
  payInputs.forEach(r => r.addEventListener('change', () => {
    if (r.checked) { setDefaultPay(r.value); toast(t('set_saved')); }
  }));

  // ---------- Delivery defaults ----------
  const d = getDeliveryInfo();
  $('dName').value = d.name || '';
  $('dPhone').value = d.phone || '';
  $('dCity').value = d.city || '';
  $('dAddress').value = d.address || '';
  $('dEmail').value = d.email || '';
  $('dQuartier').value = d.quartier || '';

  ['setName', 'setEmail'].forEach(id => $(id).addEventListener('input', () => {
    $(id).classList.remove('is-invalid');
    $(id).removeAttribute('aria-invalid');
    $(id).removeAttribute('aria-describedby');
    $('profileError').textContent = '';
    delete $('profileError').dataset.errorKey;
  }));
  ['dName', 'dPhone', 'dEmail', 'dCity', 'dQuartier', 'dAddress'].forEach(id => $(id).addEventListener('input', () => {
    $(id).classList.remove('is-invalid');
    $(id).removeAttribute('aria-invalid');
    $(id).removeAttribute('aria-describedby');
    $('deliveryError').textContent = '';
    delete $('deliveryError').dataset.errorKey;
  }));

  $('saveDelivery').onclick = () => {
    const values = {
      name: $('dName').value.trim(),
      phone: $('dPhone').value.trim(),
      email: $('dEmail').value.trim(),
      city: $('dCity').value.trim(),
      quartier: $('dQuartier').value.trim(),
      address: $('dAddress').value.trim()
    };
    const checks = [
      ['dName', values.name.length >= 2],
      ['dPhone', isValidMoroccanPhone(values.phone)],
      ['dEmail', !values.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)],
      ['dCity', values.city.length >= 2],
      ['dQuartier', values.quartier.length >= 2],
      ['dAddress', values.address.length >= 4]
    ];
    checks.forEach(([id, valid]) => {
      const input = $(id);
      input.classList.toggle('is-invalid', !valid);
      if (valid) {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      } else {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', 'deliveryError');
      }
    });
    const firstInvalid = checks.find(([, valid]) => !valid);
    if (firstInvalid) {
      $('deliveryError').textContent = t('set_delivery_error');
      $('deliveryError').dataset.errorKey = 'set_delivery_error';
      $(firstInvalid[0]).focus();
      return;
    }
    $('deliveryError').textContent = '';
    delete $('deliveryError').dataset.errorKey;
    saveDeliveryInfo({
      ...values
    });
    toast(t('set_saved'));
  };

  // ---------- Data management ----------
  const clearData = (keys, msg) => {
    const snapshot = Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]));
    const sessionUser = keys.includes('am_user') ? sessionStorage.getItem('am_user') : null;
    keys.forEach(k => localStorage.removeItem(k));
    if (keys.includes('am_user')) sessionStorage.removeItem('am_user');
    loadState();
    updateBadges();
    renderNotifMenu();
    toast(msg, t('undo'), () => {
      Object.entries(snapshot).forEach(([key, value]) => {
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      });
      if (sessionUser != null) sessionStorage.setItem('am_user', sessionUser);
      loadState();
      updateBadges();
      renderNotifMenu();
      toast(t('data_restored'));
      setTimeout(() => location.reload(), 450);
    });
  };
  $('clearCartBtn').onclick = () => clearData([LS.cart], t('removed'));
  $('clearWishBtn').onclick = () => clearData([LS.wish], t('removed'));
  $('clearOrdersBtn').onclick = () => clearData([LS.orders], t('removed'));
  $('clearAllBtn').onclick = () => {
    clearData([LS.cart, LS.wish, LS.orders, LS.recent, 'am_user', 'am_profile', 'am_delivery', 'am_pay'], t('set_reset_done'));
    $('setName').value = '';
    $('setEmail').value = '';
    ['dName', 'dPhone', 'dEmail', 'dCity', 'dQuartier', 'dAddress'].forEach(id => { $(id).value = ''; });
    renderAccountPanel();
    updateAccountUI();
    payInputs.forEach(r => { r.checked = r.value === 'cod'; });
    refreshProfileUI();
  };
}

document.addEventListener('DOMContentLoaded', initSettings);

// Language switch from this page: re-translate static text (option cards keep state)
window.addEventListener('am:langchange', () => {
  const langInputs = document.querySelectorAll('input[name="lang"]');
  langInputs.forEach(r => r.checked = r.value === getLang());
  document.querySelectorAll('.set-form-error[data-error-key]').forEach(error => {
    error.textContent = t(error.dataset.errorKey);
  });
});
