/**
 * AM MARKET — settings.js (settings.html)
 * Profile (guest-friendly), appearance (dark/light), language,
 * default payment, delivery defaults and local data management.
 * All values persist in localStorage and are shared with every page.
 */

function initSettings() {
  // ---------- Profile ----------
  const u = getUser();
  $('setName').value = u && u.name ? u.name : '';
  $('setEmail').value = u && u.email ? u.email : '';
  const refreshProfileUI = () => {
    const logged = !!getUser();
    $('logoutBtn').style.display = logged ? '' : 'none';
    $('loginHintBtn').style.display = logged ? 'none' : '';
  };
  refreshProfileUI();

  $('saveProfile').onclick = () => {
    const name = $('setName').value.trim();
    const email = $('setEmail').value.trim();
    if (!name) { toast(t('set_name_required')); return; }
    localStorage.setItem('am_user', JSON.stringify({ name, email }));
    renderAccountPanel();
    updateAccountUI();
    refreshProfileUI();
    toast(t('set_saved'));
  };

  $('logoutBtn').onclick = () => {
    localStorage.removeItem('am_user');
    renderAccountPanel();
    updateAccountUI();
    refreshProfileUI();
    $('setEmail').value = '';
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

  $('saveDelivery').onclick = () => {
    saveDeliveryInfo({
      name: $('dName').value.trim(),
      phone: $('dPhone').value.trim(),
      city: $('dCity').value.trim(),
      address: $('dAddress').value.trim()
    });
    toast(t('set_saved'));
  };

  // ---------- Data management ----------
  const clearData = (keys, msg) => {
    keys.forEach(k => localStorage.removeItem(k));
    loadState();
    updateBadges();
    renderNotifMenu();
    toast(msg);
  };
  $('clearCartBtn').onclick = () => clearData([LS.cart], t('removed'));
  $('clearWishBtn').onclick = () => clearData([LS.wish], t('removed'));
  $('clearOrdersBtn').onclick = () => clearData([LS.orders], t('removed'));
  $('clearAllBtn').onclick = () => {
    clearData([LS.cart, LS.wish, LS.orders, LS.recent, 'am_user', 'am_delivery', 'am_pay'], t('set_reset_done'));
    $('setName').value = '';
    $('setEmail').value = '';
    refreshProfileUI();
  };
}

document.addEventListener('DOMContentLoaded', initSettings);

// Language switch from this page: re-translate static text (option cards keep state)
window.addEventListener('am:langchange', () => {
  const langInputs = document.querySelectorAll('input[name="lang"]');
  langInputs.forEach(r => r.checked = r.value === getLang());
});
