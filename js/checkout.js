/** AM MARKET — authenticated, server-authoritative checkout. */

let checkoutReady = false;
let checkoutSubmitting = false;
let checkoutItems = [];
let checkoutAddressId = 'new';
let checkoutIdempotencyKey = null;

const checkoutCopy = (en, fr) => getLang() === 'fr' ? fr : en;
const CHECKOUT_FIELDS = [
  { id: 'cPhone', key: 'phone_required', valid: isValidMoroccanPhone },
  { id: 'cName', key: 'name_required', valid: value => value.length >= 2 },
  { id: 'cCity', key: 'city_required', valid: value => value.length > 0 },
  { id: 'cQuartier', key: 'quartier_required', valid: value => value.length >= 2 },
  { id: 'cAddress', key: 'address_required', valid: value => value.length >= 4 }
];

function showCheckoutError(message = '') {
  const box = $('checkoutError');
  if (!box) return;
  box.textContent = message;
  box.hidden = !message;
}

function fieldErrorElement(input) {
  const host = input.closest('.co-phone-group, .co-input-wrap') || input;
  let error = host.parentElement.querySelector(`.co-field-error[data-for="${input.id}"]`);
  if (!error) {
    error = document.createElement('div');
    error.className = 'co-field-error';
    error.dataset.for = input.id;
    error.id = `${input.id}Error`;
    error.setAttribute('role', 'alert');
    host.insertAdjacentElement('afterend', error);
  }
  return error;
}

function setFieldError(input, key) {
  const error = fieldErrorElement(input);
  error.dataset.errorKey = key;
  error.textContent = t(key);
  input.classList.add('is-invalid');
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', error.id);
}

function clearFieldError(input) {
  const error = input.closest('.col-md-6, .col-12')?.querySelector(`.co-field-error[data-for="${input.id}"]`);
  if (error) {
    error.textContent = '';
    delete error.dataset.errorKey;
  }
  input.classList.remove('is-invalid');
  input.removeAttribute('aria-invalid');
  input.removeAttribute('aria-describedby');
}

function validateCheckout() {
  let firstInvalid = null;
  CHECKOUT_FIELDS.forEach(({ id, key, valid }) => {
    const input = $(id);
    const value = input.value.trim();
    clearFieldError(input);
    if (!valid(value)) {
      setFieldError(input, key);
      firstInvalid ||= input;
    }
  });
  const email = $('cEmail');
  clearFieldError(email);
  if (email.value.trim() && !email.validity.valid) {
    setFieldError(email, 'email_invalid');
    firstInvalid ||= email;
  }
  if (firstInvalid) {
    firstInvalid.focus({ preventScroll: true });
    firstInvalid.scrollIntoView({ behavior: motionBehavior(), block: 'center' });
    toast(t('fix_fields'));
    return false;
  }
  return true;
}

function formatPhoneInput(value) {
  const digits = normalizeMoroccanPhone(value);
  return /^[5-7]\d{8}$/.test(digits) ? digits : String(value || '').replace(/^\+212/, '');
}

function fillAddressForm(address) {
  const profile = getProfile();
  const citySelect = $('cCity');
  citySelect?.querySelector('option[data-saved-city]')?.remove();
  if (address?.city && citySelect && ![...citySelect.options].some(option => option.value === address.city)) {
    const option = document.createElement('option');
    option.value = address.city;
    option.textContent = address.city;
    option.dataset.savedCity = 'true';
    citySelect.appendChild(option);
  }
  const values = address ? {
    cName: address.recipientName,
    cPhone: formatPhoneInput(address.phone),
    cEmail: address.email || profile.email,
    cAddress: address.addressLine1,
    cCity: address.city,
    cQuartier: address.district,
    cNote: address.deliveryInstructions || ''
  } : {
    cName: profile.displayName || profile.name || '',
    cPhone: formatPhoneInput(profile.phone || ''),
    cEmail: profile.email || '', cAddress: '', cCity: '', cQuartier: '', cNote: ''
  };
  Object.entries(values).forEach(([id, value]) => { if ($(id)) $(id).value = value || ''; });
  const locked = Boolean(address);
  ['cName', 'cPhone', 'cEmail', 'cQuartier', 'cAddress', 'cNote'].forEach(id => { if ($(id)) $(id).readOnly = locked; });
  if ($('cCity')) $('cCity').disabled = locked;
  CHECKOUT_FIELDS.forEach(({ id }) => clearFieldError($(id)));
  clearFieldError($('cEmail'));
}

function renderAddressChooser() {
  const group = $('savedAddressGroup');
  const select = $('savedAddressSelect');
  if (!group || !select) return;
  group.hidden = false;
  const sorted = [...savedAddresses].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  select.innerHTML = `${sorted.map(address => `<option value="${escapeHtml(address.id)}">${escapeHtml(address.label)} — ${escapeHtml(address.addressLine1)}, ${escapeHtml(address.city)}${address.isDefault ? ` (${checkoutCopy('default', 'par défaut')})` : ''}</option>`).join('')}
    <option value="new">${checkoutCopy('Use a new address', 'Utiliser une nouvelle adresse')}</option>`;
  const selected = sorted.find(address => address.id === checkoutAddressId);
  const preferred = selected || sorted.find(address => address.isDefault) || sorted[0];
  checkoutAddressId = preferred?.id || 'new';
  select.value = checkoutAddressId;
  fillAddressForm(preferred || null);
  select.onchange = () => {
    checkoutAddressId = select.value;
    fillAddressForm(savedAddresses.find(address => address.id === checkoutAddressId) || null);
  };
}

async function renderCheckout() {
  checkoutReady = false;
  const summary = $('checkoutSummary');
  const submit = $('placeOrder');
  summary?.setAttribute('aria-busy', 'true');
  if (submit) submit.disabled = true;
  showCheckoutError();
  try {
    const payload = await StoreAPI.cart.get();
    const serverCart = payload.cart;
    cart = cartFromApi(payload);
    updateBadges();
    checkoutItems = serverCart.items || [];
    if (!checkoutItems.length) {
      location.replace('cart.html');
      return;
    }
    const unavailable = checkoutItems.filter(item => !item.verified || !item.isAvailable || item.quantityAvailable === false);
    $('coItems').innerHTML = `${unavailable.length ? `<div class="alert alert-danger small" role="alert">${t('checkout_unavailable')} <a class="alert-link" href="cart.html">${t('review_cart')}</a></div>` : ''}${checkoutItems.map(item => `
      <div class="co-line-item d-flex justify-content-between small mb-2">
        <span class="co-line-name">${escapeHtml(item.name)} × ${item.quantity}${(!item.verified || !item.isAvailable || item.quantityAvailable === false)
          ? ` · ${t(!item.verified ? 'item_unverified' : item.quantityAvailable === false ? 'quantity_unavailable' : 'out_stock', { n: item.stockQuantity })}`
          : ''}</span>
        <span class="co-line-price">${formatPrice(Number(item.unitPrice) * item.quantity)}</span>
      </div>`).join('')}`;
    $('coSub').textContent = formatPrice(serverCart.subtotal);
    $('coFee').textContent = Number(serverCart.deliveryFee) === 0 ? t('free') : formatPrice(serverCart.deliveryFee);
    $('coTotal').textContent = formatPrice(serverCart.total);
    checkoutReady = Boolean(serverCart.checkoutReady);
  } catch (error) {
    $('coItems').innerHTML = '';
    showCheckoutError(error.message || t('api_error'));
  } finally {
    summary?.removeAttribute('aria-busy');
    if (submit && !checkoutSubmitting) submit.disabled = !checkoutReady;
  }
}

function newAddressPayload() {
  return {
    label: checkoutCopy('Checkout address', 'Adresse de livraison'),
    recipientName: $('cName').value.trim(),
    phone: `+212${normalizeMoroccanPhone($('cPhone').value)}`,
    email: $('cEmail').value.trim() || null,
    addressLine1: $('cAddress').value.trim(),
    district: $('cQuartier').value.trim(),
    city: $('cCity').value.trim(),
    deliveryInstructions: $('cNote').value.trim() || null,
    isDefault: savedAddresses.length === 0
  };
}

function setCheckoutPending(pending) {
  checkoutSubmitting = pending;
  const form = $('checkoutForm');
  const button = $('placeOrder');
  form?.toggleAttribute('aria-busy', pending);
  if (!button) return;
  button.disabled = pending || !checkoutReady;
  button.classList.toggle('is-loading', pending);
  if (pending) button.innerHTML = `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span><span>${t('placing_order')}</span>`;
  else button.innerHTML = `<i class="fa-solid fa-bag-shopping me-1"></i><span>${t('place_order')}</span>`;
}

async function placeOrder(event) {
  event.preventDefault();
  if (checkoutSubmitting || !checkoutReady || !validateCheckout()) return;
  showCheckoutError();
  setCheckoutPending(true);
  try {
    await waitForStoreMutations();
    let addressId = checkoutAddressId;
    if (addressId === 'new') {
      const created = await StoreAPI.addresses.create(newAddressPayload());
      const address = created.address;
      savedAddresses.push(address);
      addressId = address.id;
      checkoutAddressId = addressId;
    }
    checkoutIdempotencyKey ||= StoreAPI.createIdempotencyKey();
    const paymentMethod = document.querySelector('input[name="pay"]:checked')?.value || 'cod';
    const result = await StoreAPI.orders.create({
      addressId,
      paymentMethod,
      note: $('cNote').value.trim() || null
    }, { idempotencyKey: checkoutIdempotencyKey });
    cart = [];
    updateBadges();
    const button = $('placeOrder');
    button.classList.remove('is-loading');
    button.classList.add('is-success');
    button.innerHTML = `<i class="fa-solid fa-check" aria-hidden="true"></i><span>${t('order_confirmed')}</span>`;
    document.querySelectorAll('.co-step').forEach((step, index) => {
      step.classList.toggle('active', index === 2);
      step.classList.toggle('completed', index < 2);
      if (index === 2) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
    toast(t('order_ok'));
    setTimeout(() => { location.href = `orders.html?placed=${encodeURIComponent(result.order.id)}`; }, 650);
  } catch (error) {
    showCheckoutError(error.message || t('api_error'));
    if (['CART_CHANGED', 'CART_EMPTY'].includes(error.code)) await renderCheckout();
    setCheckoutPending(false);
  }
}

function localizeCheckoutDynamicCopy() {
  if ($('savedAddressHeading')) $('savedAddressHeading').textContent = checkoutCopy('Saved address', 'Adresse enregistrée');
  if ($('savedAddressLabel')) $('savedAddressLabel').textContent = checkoutCopy('Choose a delivery address', 'Choisissez une adresse de livraison');
  if ($('manageAddressesLink')) $('manageAddressesLink').textContent = checkoutCopy('Manage saved addresses', 'Gérer les adresses enregistrées');
  if ($('checkoutSecurityNote')) $('checkoutSecurityNote').textContent = checkoutCopy(
    'Prices and availability are rechecked securely by the server before the order is created.',
    'Les prix et la disponibilité sont revérifiés de manière sécurisée par le serveur avant la création de la commande.'
  );
}

async function initCheckout() {
  if (!getUser()) {
    location.replace('login.html?next=checkout.html');
    return;
  }
  localizeCheckoutDynamicCopy();
  try {
    const payload = await StoreAPI.addresses.list();
    savedAddresses = payload.addresses || [];
  } catch (error) {
    showCheckoutError(error.message || t('api_error'));
  }
  renderAddressChooser();
  const preferredPayment = getDefaultPay();
  const radio = $({ cod: 'pay1', card: 'pay2', wafacash: 'pay3', cashplus: 'pay4' }[preferredPayment] || 'pay1');
  if (radio && !radio.disabled) radio.checked = true;
  else $('pay1').checked = true;
  const paymentOptions = document.querySelectorAll('.pay-opt');
  const syncPayment = () => paymentOptions.forEach(option => option.classList.toggle('selected', option.querySelector('input').checked));
  paymentOptions.forEach(option => option.querySelector('input').addEventListener('change', syncPayment));
  syncPayment();
  $('checkoutForm').addEventListener('submit', placeOrder);
  CHECKOUT_FIELDS.forEach(({ id }) => {
    const input = $(id);
    input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => clearFieldError(input));
  });
  $('cEmail').addEventListener('input', () => clearFieldError($('cEmail')));
  $('cPhone').addEventListener('blur', () => {
    const digits = normalizeMoroccanPhone($('cPhone').value);
    if (/^[5-7]\d{8}$/.test(digits)) $('cPhone').value = digits;
  });
  await renderCheckout();
}

document.addEventListener('DOMContentLoaded', () => whenStoreReady(initCheckout));
window.addEventListener('am:langchange', () => {
  localizeCheckoutDynamicCopy();
  document.querySelectorAll('.co-field-error[data-error-key]').forEach(error => { error.textContent = t(error.dataset.errorKey); });
  if (!checkoutSubmitting) renderAddressChooser();
});
