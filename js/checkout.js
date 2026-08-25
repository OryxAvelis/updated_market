/** AM MARKET — server-authoritative authenticated and guest checkout. */

let checkoutReady = false;
let checkoutSubmitting = false;
let checkoutItems = [];
let checkoutAddressId = null;
let checkoutIdempotencyKey = null;
let checkoutCartSnapshot = null;
let checkoutConfirmed = false;
let checkoutErrorState = { key: '', message: '', retry: false, retryDisabled: false };
let savedAddressLoadFailed = false;
let checkoutSessionExpired = false;
let checkoutRedirectStarted = false;
let checkoutAddressRequestSequence = 0;
let checkoutCartRequestSequence = 0;
let checkoutMode = 'guest';
let checkoutConfirmedOrder = null;
let checkoutGuestAccess = null;
let checkoutPageInitialized = false;

const GUEST_CHECKOUT_ATTEMPT_KEY = 'am_guest_checkout_attempt_v1';
const GUEST_ORDER_ACCESS_KEY = 'am_guest_order_access_v1';

const checkoutCopy = (en, fr) => getLang() === 'fr' ? fr : en;
const CHECKOUT_FIELDS = [
  { id: 'cPhone', key: 'phone_required', valid: isValidMoroccanPhone },
  { id: 'cName', key: 'name_required', valid: value => value.length >= 2 },
  { id: 'cCity', key: 'city_required', valid: value => value.length > 0 },
  { id: 'cQuartier', key: 'quartier_required', valid: value => value.length >= 2 },
  { id: 'cAddress', key: 'address_required', valid: value => value.length >= 4 }
];

function stableCheckoutJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableCheckoutJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableCheckoutJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function guestCheckoutSignature(input) {
  if (!globalThis.crypto?.subtle || typeof globalThis.TextEncoder !== 'function') {
    throw Object.assign(new Error('Secure guest checkout storage is unavailable.'), { code: 'GUEST_CHECKOUT_STORAGE_UNAVAILABLE' });
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new globalThis.TextEncoder().encode(stableCheckoutJson(input)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function validGuestAttempt(value) {
  return Boolean(value && value.version === 2 &&
    typeof value.signature === 'string' && /^[a-f0-9]{64}$/.test(value.signature) &&
    typeof value.idempotencyKey === 'string' && value.idempotencyKey.length >= 8 && value.idempotencyKey.length <= 128 &&
    typeof value.guestOrderToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.guestOrderToken) &&
    typeof value.expiresAt === 'string' && Date.parse(value.expiresAt) > Date.now() + 5000);
}

function readGuestStorage(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; }
}

function writeGuestStorage(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeGuestStorage(key) {
  try { sessionStorage.removeItem(key); } catch { /* Best effort after a completed request. */ }
}

async function prepareGuestCheckoutAttempt(input) {
  const signature = await guestCheckoutSignature(input);
  const stored = readGuestStorage(GUEST_CHECKOUT_ATTEMPT_KEY);
  if (validGuestAttempt(stored) && stored.signature === signature) return stored;
  const issued = await StoreAPI.guestOrders.issueAccess();
  const serverAccess = issued?.access;
  const attempt = {
    version: 2,
    signature,
    idempotencyKey: String(serverAccess?.idempotencyKey || ''),
    guestOrderToken: String(serverAccess?.token || ''),
    expiresAt: String(serverAccess?.expiresAt || '')
  };
  if (!validGuestAttempt(attempt)) {
    throw Object.assign(new Error('The server did not issue valid guest checkout access.'), { code: 'INVALID_RESPONSE' });
  }
  if (!writeGuestStorage(GUEST_CHECKOUT_ATTEMPT_KEY, attempt)) {
    throw Object.assign(new Error('Secure guest checkout storage is unavailable.'), { code: 'GUEST_CHECKOUT_STORAGE_UNAVAILABLE' });
  }
  return attempt;
}

function persistGuestOrderAccess(orderId, guestOrderToken, expiresAt) {
  const access = {
    version: 2,
    orderId: String(orderId || ''),
    guestOrderToken: String(guestOrderToken || ''),
    expiresAt: String(expiresAt || '')
  };
  if (!access.orderId || !/^[A-Za-z0-9_-]{43}$/.test(access.guestOrderToken) ||
      !Number.isFinite(Date.parse(access.expiresAt)) || !writeGuestStorage(GUEST_ORDER_ACCESS_KEY, access)) {
    return null;
  }
  return access;
}

function readGuestOrderAccess() {
  const value = readGuestStorage(GUEST_ORDER_ACCESS_KEY);
  const expiryMs = Date.parse(String(value?.expiresAt || ''));
  if (!value || value.version !== 2 || !String(value.orderId || '').trim() ||
      !/^[A-Za-z0-9_-]{43}$/.test(String(value.guestOrderToken || '')) ||
      !Number.isFinite(expiryMs) || expiryMs <= Date.now()) return null;
  return {
    version: 2,
    orderId: String(value.orderId),
    guestOrderToken: String(value.guestOrderToken),
    expiresAt: String(value.expiresAt)
  };
}

function showCheckoutError(message = '', { key = '', retry = false, retryDisabled = false } = {}) {
  const box = $('checkoutError');
  if (!box) return;
  const copy = $('checkoutErrorText');
  const retryButton = $('checkoutRetry');
  checkoutErrorState = { key, message, retry, retryDisabled };
  if (copy) copy.textContent = message;
  if (retryButton) {
    retryButton.hidden = !retry;
    retryButton.disabled = retryDisabled;
  }
  box.hidden = !message;
}

function savedAddressErrorMessage() {
  return checkoutCopy(
    'Saved addresses could not be loaded. Enter a new address below or try again.',
    'Impossible de charger vos adresses enregistrées. Saisissez une nouvelle adresse ci-dessous ou réessayez.'
  );
}

function checkoutRuntimeErrorKey(error) {
  if (error?.code === 'GUEST_CHECKOUT_STORAGE_UNAVAILABLE' || error?.code === 'CRYPTO_UNAVAILABLE') return 'guest_checkout_storage_error';
  if (error?.code === 'GUEST_CHECKOUT_ACCESS_INVALID') return 'guest_checkout_access_error';
  if (['IDEMPOTENCY_KEY_REUSED', 'GUEST_ORDER_TOKEN_REUSED', 'GUEST_ORDER_CONFLICT', 'GUEST_CHECKOUT_CREDENTIALS_REUSED'].includes(error?.code)) return 'guest_checkout_conflict';
  if (error?.code === 'CART_SYNC_FAILED') return 'api_error';
  if (['CART_CHANGED', 'CART_EMPTY', 'CART_NOT_FOUND'].includes(error?.code)) return 'checkout_cart_changed';
  if (error?.code === 'ADDRESS_NOT_FOUND') return 'checkout_address_missing';
  if (error?.code === 'AUTH_REQUIRED') return 'checkout_session_expired';
  return 'api_error';
}

function showSavedAddressError(message = '') {
  const box = $('savedAddressError');
  const copy = $('savedAddressErrorText');
  if (!box || !copy) return;
  copy.textContent = message;
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
  const guestDelivery = checkoutMode === 'guest' ? getDeliveryInfo() : {};
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
    cName: guestDelivery.name || profile.displayName || profile.name || '',
    cPhone: formatPhoneInput(guestDelivery.phone || profile.phone || ''),
    cEmail: guestDelivery.email || profile.email || '',
    cAddress: guestDelivery.address || '',
    cCity: guestDelivery.city || '',
    cQuartier: guestDelivery.quartier || '',
    cNote: guestDelivery.instructions || ''
  };
  Object.entries(values).forEach(([id, value]) => { if ($(id)) $(id).value = value || ''; });
  const locked = Boolean(address);
  ['cName', 'cPhone', 'cEmail', 'cQuartier', 'cAddress', 'cNote'].forEach(id => { if ($(id)) $(id).readOnly = locked; });
  if ($('cCity')) $('cCity').disabled = locked;
  CHECKOUT_FIELDS.forEach(({ id }) => clearFieldError($(id)));
  clearFieldError($('cEmail'));
}

function renderAddressChooser({ preserveForm = false } = {}) {
  const group = $('savedAddressGroup');
  const select = $('savedAddressSelect');
  if (!group || !select) return;
  if (checkoutMode === 'guest') {
    group.hidden = true;
    return;
  }
  group.hidden = false;
  const sorted = [...savedAddresses].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  select.innerHTML = `${sorted.map(address => `<option value="${escapeHtml(address.id)}">${escapeHtml(address.label)} — ${escapeHtml(address.addressLine1)}, ${escapeHtml(address.city)}${address.isDefault ? ` (${checkoutCopy('default', 'par défaut')})` : ''}</option>`).join('')}
    <option value="new">${checkoutCopy('Use a new address', 'Utiliser une nouvelle adresse')}</option>`;
  const usingNewAddress = checkoutAddressId === 'new';
  const selected = sorted.find(address => address.id === checkoutAddressId);
  const preferred = usingNewAddress ? null : (selected || sorted.find(address => address.isDefault) || sorted[0]);
  checkoutAddressId = usingNewAddress ? 'new' : (preferred?.id || 'new');
  select.value = checkoutAddressId;
  if (!preserveForm) fillAddressForm(preferred || null);
  select.onchange = () => {
    checkoutAddressId = select.value;
    fillAddressForm(savedAddresses.find(address => address.id === checkoutAddressId) || null);
  };
}

async function loadSavedAddresses({ fromRetry = false } = {}) {
  const requestSequence = ++checkoutAddressRequestSequence;
  const authContext = captureAuthenticatedRequest();
  const group = $('savedAddressGroup');
  const retry = $('savedAddressRetry');
  group?.setAttribute('aria-busy', 'true');
  if (retry) retry.disabled = true;
  try {
    const payload = await StoreAPI.addresses.list();
    if (checkoutSessionExpired || requestSequence !== checkoutAddressRequestSequence ||
        !isAuthenticatedRequestCurrent(authContext)) return;
    savedAddresses = payload.addresses || [];
    savedAddressLoadFailed = false;
    showSavedAddressError();
  } catch (error) {
    if (handleStoreUnauthorized(error)) return;
    if (checkoutSessionExpired || requestSequence !== checkoutAddressRequestSequence ||
        !isAuthenticatedRequestCurrent(authContext)) return;
    savedAddresses = [];
    checkoutAddressId = 'new';
    savedAddressLoadFailed = true;
    showSavedAddressError(savedAddressErrorMessage());
  } finally {
    if (checkoutSessionExpired || requestSequence !== checkoutAddressRequestSequence) return;
    renderAddressChooser({ preserveForm: fromRetry && checkoutAddressId === 'new' });
    group?.removeAttribute('aria-busy');
    if (retry) retry.disabled = false;
    if (fromRetry && savedAddressLoadFailed) retry?.focus({ preventScroll: true });
  }
}

function renderCheckoutLoading() {
  const items = $('coItems');
  if (items) {
    items.innerHTML = '<div class="co-summary-skeleton" aria-hidden="true"><span class="skeleton-block skeleton-line"></span><span class="skeleton-block skeleton-line short"></span></div>'
      + `<span class="visually-hidden">${t('loading')}</span>`;
  }
  if ($('coSub')) $('coSub').textContent = '—';
  if ($('coFee')) $('coFee').textContent = '—';
  if ($('coTotal')) $('coTotal').textContent = '—';
}

function renderCheckoutSummary(serverCart = checkoutCartSnapshot) {
  if (!serverCart) return;
  checkoutItems = serverCart.items || [];
  const unavailable = checkoutItems.filter(item => !item.verified || !item.isAvailable || item.quantityAvailable === false);
  const guestLimitExceeded = checkoutMode === 'guest' && checkoutItems.length > 100;
  const availabilityKey = unavailable.some(item => !item.verified) ? 'checkout_unverified' : 'checkout_unavailable';
  $('coItems').innerHTML = `${guestLimitExceeded ? `<div class="alert alert-danger small co-availability-alert" role="alert">${t('guest_checkout_item_limit')} <a class="alert-link" href="cart.html">${t('review_cart')}</a></div>` : ''}${unavailable.length ? `<div class="alert alert-danger small co-availability-alert" role="alert">${t(availabilityKey)} <a class="alert-link" href="cart.html">${t('review_cart')}</a></div>` : ''}${checkoutItems.map(item => `
    <div class="co-line-item d-flex justify-content-between small mb-2">
      <span class="co-line-name">${escapeHtml(item.name)} × ${item.quantity}${(!item.verified || !item.isAvailable || item.quantityAvailable === false)
        ? ` · ${t(!item.verified ? 'item_unverified' : item.quantityAvailable === false ? 'quantity_unavailable' : 'out_stock', { n: item.stockQuantity })}`
        : ''}</span>
      <span class="co-line-price">${formatPrice(Number(item.unitPrice) * item.quantity)}</span>
    </div>`).join('')}`;
  $('coSub').textContent = formatPrice(serverCart.subtotal);
  $('coFee').textContent = Number(serverCart.deliveryFee) === 0 ? t('free') : formatPrice(serverCart.deliveryFee);
  $('coTotal').textContent = formatPrice(serverCart.total);
  checkoutReady = Boolean(serverCart.checkoutReady) && !guestLimitExceeded;
}

function renderCheckoutSubmit() {
  const button = $('placeOrder');
  if (!button) return;
  button.disabled = checkoutConfirmed || checkoutSubmitting || !checkoutReady;
  button.classList.toggle('is-loading', checkoutSubmitting);
  button.classList.toggle('is-success', checkoutConfirmed);
  if (checkoutConfirmed) {
    button.innerHTML = `<i class="fa-solid fa-check" aria-hidden="true"></i><span>${t('order_confirmed')}</span>`;
  } else if (checkoutSubmitting) {
    button.innerHTML = `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span><span>${t('placing_order')}</span>`;
  } else {
    button.innerHTML = `<i class="fa-solid fa-bag-shopping me-1" aria-hidden="true"></i><span>${t('place_order')}</span>`;
  }
}

async function guestCartForCheckout() {
  const detailed = await getCartItems();
  const items = detailed.map(({ id, qty, product }) => {
    const verified = product.load_failed !== true;
    const isAvailable = product.is_available !== false;
    const quantityAvailable = !Number.isInteger(product.stock_quantity) || qty <= product.stock_quantity;
    return {
      productId: String(id),
      name: product.name || t('product_crumb'),
      imageUrl: product.image_url || null,
      unitPrice: Number(product.price) || 0,
      quantity: qty,
      verified,
      isAvailable,
      quantityAvailable,
      stockQuantity: Number.isInteger(product.stock_quantity) ? product.stock_quantity : null
    };
  });
  const available = detailed.filter(({ qty, product }) => product.load_failed !== true &&
    product.is_available !== false && (!Number.isInteger(product.stock_quantity) || qty <= product.stock_quantity));
  const subtotal = itemsSubtotal(available);
  const fee = deliveryFee(subtotal);
  return {
    items,
    subtotal,
    deliveryFee: fee,
    total: subtotal + fee,
    checkoutReady: items.length > 0 && available.length === items.length
  };
}

async function renderCheckout({ fromRetry = false } = {}) {
  const requestSequence = ++checkoutCartRequestSequence;
  const authenticated = checkoutMode === 'authenticated' && Boolean(getUser());
  const authContext = authenticated ? captureAuthenticatedRequest() : null;
  checkoutReady = false;
  const summary = $('checkoutSummary');
  summary?.setAttribute('aria-busy', 'true');
  renderCheckoutLoading();
  renderCheckoutSubmit();
  if (fromRetry) showCheckoutError(t('loading'), { key: 'loading', retry: true, retryDisabled: true });
  else showCheckoutError();
  try {
    const payload = authenticated ? await StoreAPI.cart.get() : null;
    if (checkoutSessionExpired || requestSequence !== checkoutCartRequestSequence ||
        (authenticated && !isAuthenticatedRequestCurrent(authContext))) return false;
    const serverCart = authenticated ? payload.cart : await guestCartForCheckout();
    if (checkoutSessionExpired || requestSequence !== checkoutCartRequestSequence ||
        (authenticated && !isAuthenticatedRequestCurrent(authContext))) return false;
    if (authenticated) {
      cart = cartFromApi(payload);
      updateBadges();
    }
    checkoutCartSnapshot = serverCart;
    if (!(serverCart.items || []).length) {
      location.replace('cart.html');
      return true;
    }
    renderCheckoutSummary(serverCart);
    showCheckoutError();
    if (fromRetry) $('orderSummaryHeading')?.focus({ preventScroll: true });
    return true;
  } catch (error) {
    if (authenticated && handleStoreUnauthorized(error)) return false;
    if (checkoutSessionExpired || requestSequence !== checkoutCartRequestSequence ||
        (authenticated && !isAuthenticatedRequestCurrent(authContext))) return false;
    checkoutCartSnapshot = null;
    checkoutItems = [];
    $('coItems').innerHTML = '';
    showCheckoutError(t('api_error'), { key: 'api_error', retry: true });
    if (fromRetry) $('checkoutRetry')?.focus({ preventScroll: true });
    return false;
  } finally {
    if (checkoutSessionExpired || requestSequence !== checkoutCartRequestSequence) return;
    summary?.removeAttribute('aria-busy');
    renderCheckoutSubmit();
  }
}

function checkoutDeliveryPayload() {
  return {
    recipientName: $('cName').value.trim(),
    phone: `+212${normalizeMoroccanPhone($('cPhone').value)}`,
    email: $('cEmail').value.trim() || null,
    addressLine1: $('cAddress').value.trim(),
    addressLine2: null,
    district: $('cQuartier').value.trim(),
    city: $('cCity').value.trim(),
    postalCode: null,
    country: 'MA',
    deliveryInstructions: $('cNote').value.trim() || null
  };
}

function newAddressPayload() {
  const delivery = checkoutDeliveryPayload();
  return {
    label: checkoutCopy('Checkout address', 'Adresse de livraison'),
    recipientName: delivery.recipientName,
    phone: delivery.phone,
    email: delivery.email,
    addressLine1: delivery.addressLine1,
    addressLine2: delivery.addressLine2,
    district: delivery.district,
    city: delivery.city,
    postalCode: delivery.postalCode,
    deliveryInstructions: delivery.deliveryInstructions,
    isDefault: !savedAddressLoadFailed && savedAddresses.length === 0
  };
}

function normalizedAddressField(value) {
  return String(value ?? '').trim();
}

function addressesMatch(left, right) {
  if (!left || !right) return false;
  return normalizedAddressField(left.recipientName) === normalizedAddressField(right.recipientName) &&
    normalizeMoroccanPhone(left.phone) === normalizeMoroccanPhone(right.phone) &&
    normalizedAddressField(left.email).toLocaleLowerCase() === normalizedAddressField(right.email).toLocaleLowerCase() &&
    normalizedAddressField(left.addressLine1) === normalizedAddressField(right.addressLine1) &&
    normalizedAddressField(left.addressLine2) === normalizedAddressField(right.addressLine2) &&
    normalizedAddressField(left.district) === normalizedAddressField(right.district) &&
    normalizedAddressField(left.city) === normalizedAddressField(right.city) &&
    normalizedAddressField(left.postalCode) === normalizedAddressField(right.postalCode) &&
    normalizedAddressField(left.deliveryInstructions) === normalizedAddressField(right.deliveryInstructions);
}

function findMatchingSavedAddress(input) {
  return savedAddresses.find(address => addressesMatch(address, input)) || null;
}

async function resolveCheckoutAddress(authContext, input = newAddressPayload()) {
  const existing = findMatchingSavedAddress(input);
  if (existing) return existing.id;

  try {
    const created = await StoreAPI.addresses.create(input);
    assertAuthenticatedRequestCurrent(authContext);
    const address = created.address;
    savedAddresses = [...savedAddresses.filter(item => String(item.id) !== String(address.id)), address];
    return address.id;
  } catch (createError) {
    if (Number(createError?.status) === 401) throw createError;
    try {
      const payload = await StoreAPI.addresses.list();
      assertAuthenticatedRequestCurrent(authContext);
      savedAddresses = payload.addresses || [];
      savedAddressLoadFailed = false;
      showSavedAddressError();
      const reconciled = findMatchingSavedAddress(input);
      if (reconciled) return reconciled.id;
    } catch (reconcileError) {
      if (Number(reconcileError?.status) === 401) throw reconcileError;
      console.error('Checkout address reconciliation failed', reconcileError);
    }
    throw createError;
  }
}

function guestOrderInput() {
  return {
    items: cart.map(item => ({ productId: String(item.id), quantity: Number(item.qty) }))
      .sort((left, right) => left.productId.localeCompare(right.productId)),
    delivery: checkoutDeliveryPayload(),
    paymentMethod: document.querySelector('input[name="pay"]:checked')?.value || 'cod',
    note: $('cNote').value.trim() || null
  };
}

function guestOrderStatusLabel(status) {
  const normalized = String(status || 'confirmed').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const key = `status_${normalized}`;
  const translated = t(key);
  return translated === key ? (normalized || t('order_confirmed')) : translated;
}

function guestAccessExpiryLabel(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(getLang() === 'fr' ? 'fr-MA' : 'en-MA', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function setCheckoutConfirmationStep() {
  document.querySelectorAll('.co-step').forEach((step, index) => {
    step.classList.toggle('active', index === 2);
    step.classList.toggle('completed', index < 2);
    if (index === 2) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  });
}

function renderGuestConfirmation(order, access, { focus = true, persist = true } = {}) {
  if (!order || !access?.guestOrderToken) return false;
  checkoutConfirmed = true;
  checkoutConfirmedOrder = order;
  checkoutGuestAccess = {
    orderId: String(order.id),
    guestOrderToken: access.guestOrderToken,
    expiresAt: access.expiresAt || order.accessExpiresAt || ''
  };
  if (persist) persistGuestOrderAccess(order.id, access.guestOrderToken, checkoutGuestAccess.expiresAt);
  const form = $('checkoutForm');
  if (form) form.hidden = true;
  if ($('guestCheckoutContext')) $('guestCheckoutContext').hidden = true;
  const confirmation = $('checkoutConfirmation');
  if (confirmation) confirmation.hidden = false;
  if ($('guestOrderReference')) $('guestOrderReference').textContent = order.orderNumber || order.id;
  if ($('guestOrderStatus')) $('guestOrderStatus').textContent = guestOrderStatusLabel(order.status);
  if ($('guestOrderTotal')) $('guestOrderTotal').textContent = formatPrice(order.total);
  if ($('guestOrderAccessExpiry')) {
    $('guestOrderAccessExpiry').textContent = guestAccessExpiryLabel(checkoutGuestAccess.expiresAt);
  }
  if ($('guestTrackingMessage')) {
    $('guestTrackingMessage').textContent = t('guest_tracking_updated', {
      status: guestOrderStatusLabel(order.status)
    });
  }
  const refresh = $('guestTrackingRefresh');
  if (refresh) refresh.onclick = refreshGuestTracking;
  setCheckoutConfirmationStep();
  if (focus) requestAnimationFrame(() => confirmation?.focus({ preventScroll: true }));
  return true;
}

async function refreshGuestTracking() {
  const access = checkoutGuestAccess;
  const button = $('guestTrackingRefresh');
  if (!access || !button) return;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    const result = await StoreAPI.guestOrders.tracking(access.orderId, {
      guestOrderToken: access.guestOrderToken
    });
    const status = guestOrderStatusLabel(result.status);
    if ($('guestOrderStatus')) $('guestOrderStatus').textContent = status;
    if ($('guestTrackingMessage')) $('guestTrackingMessage').textContent = t('guest_tracking_updated', { status });
    if (checkoutConfirmedOrder) checkoutConfirmedOrder.status = result.status;
  } catch {
    if ($('guestTrackingMessage')) $('guestTrackingMessage').textContent = t('guest_tracking_refresh_error');
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

async function loadPersistedGuestOrder() {
  const access = readGuestOrderAccess();
  if (!access || cart.length) return null;
  const result = await StoreAPI.guestOrders.get(access.orderId, {
    guestOrderToken: access.guestOrderToken
  });
  return result?.order ? { order: result.order, access } : null;
}

async function restoreGuestConfirmation() {
  try {
    const restored = await loadPersistedGuestOrder();
    return restored ? renderGuestConfirmation(restored.order, restored.access, { persist: false }) : false;
  } catch {
    return false;
  }
}

async function submitGuestOrder(input) {
  const attempt = await prepareGuestCheckoutAttempt(input);
  let result;
  try {
    result = await StoreAPI.guestOrders.create(input, {
      idempotencyKey: attempt.idempotencyKey,
      guestOrderToken: attempt.guestOrderToken
    });
  } catch (error) {
    if (error?.code === 'GUEST_CHECKOUT_ACCESS_INVALID') removeGuestStorage(GUEST_CHECKOUT_ATTEMPT_KEY);
    throw error;
  }
  if (!result?.order?.id) {
    throw Object.assign(new Error('The guest checkout response did not include an order.'), { code: 'INVALID_RESPONSE' });
  }

  const access = {
    orderId: String(result.order.id),
    guestOrderToken: attempt.guestOrderToken,
    expiresAt: result.order.accessExpiresAt || attempt.expiresAt
  };
  persistGuestOrderAccess(access.orderId, access.guestOrderToken, access.expiresAt);
  const delivery = input.delivery;
  try {
    saveDeliveryInfo({
      name: delivery.recipientName,
      phone: delivery.phone,
      email: delivery.email || '',
      address: delivery.addressLine1,
      city: delivery.city,
      quartier: delivery.district,
      instructions: delivery.deliveryInstructions || ''
    });
  } catch (storageError) {
    console.warn('[AM MARKET checkout] Delivery details could not be remembered after the guest order completed.', storageError);
  }

  cart = [];
  try {
    await saveCart();
  } catch (storageError) {
    console.warn('[AM MARKET checkout] The completed guest cart could not be cleared normally.', storageError);
    try { localStorage.removeItem('am_cart'); } catch { /* The in-memory cart is still cleared after success. */ }
    updateBadges();
  }
  if (typeof broadcastStoreGuestCommerceChanged === 'function') broadcastStoreGuestCommerceChanged();
  removeGuestStorage(GUEST_CHECKOUT_ATTEMPT_KEY);
  return { order: result.order, access };
}

function setCheckoutPending(pending) {
  checkoutSubmitting = pending;
  if (pending) checkoutConfirmed = false;
  const form = $('checkoutForm');
  form?.toggleAttribute('aria-busy', pending);
  renderCheckoutSubmit();
}

async function placeOrder(event) {
  event.preventDefault();
  if (checkoutConfirmed || checkoutSubmitting || !checkoutReady || !validateCheckout()) return;
  showCheckoutError();
  setCheckoutPending(true);
  const authenticated = checkoutMode === 'authenticated' && Boolean(getUser());
  const authContext = authenticated ? captureAuthenticatedRequest() : null;
  try {
    const paymentMethod = document.querySelector('input[name="pay"]:checked')?.value || 'cod';
    let result;
    if (authenticated) {
      await waitForStoreMutations();
      if (checkoutSessionExpired || !isAuthenticatedRequestCurrent(authContext)) return;
      let addressId = checkoutAddressId;
      if (addressId === 'new') {
        addressId = await resolveCheckoutAddress(authContext);
        if (checkoutSessionExpired || !isAuthenticatedRequestCurrent(authContext)) return;
        checkoutAddressId = addressId;
        renderAddressChooser();
      }
      checkoutIdempotencyKey ||= StoreAPI.createIdempotencyKey();
      result = await StoreAPI.orders.create({
        addressId,
        paymentMethod,
        note: $('cNote').value.trim() || null
      }, { idempotencyKey: checkoutIdempotencyKey });
      if (checkoutSessionExpired || !isAuthenticatedRequestCurrent(authContext)) return;
      cart = [];
      updateBadges();
    } else {
      const input = guestOrderInput();
      const guestResult = await submitGuestOrder(input);
      result = { order: guestResult.order };
      renderGuestConfirmation(guestResult.order, guestResult.access, { persist: false });
    }
    checkoutSubmitting = false;
    checkoutConfirmed = true;
    $('checkoutForm')?.removeAttribute('aria-busy');
    renderCheckoutSubmit();
    setCheckoutConfirmationStep();
    toast(t('order_ok'));
    if (authenticated) setTimeout(() => { location.href = `orders.html?placed=${encodeURIComponent(result.order.id)}`; }, 650);
  } catch (error) {
    if (authenticated && handleStoreUnauthorized(error)) return;
    if (checkoutSessionExpired || (authenticated && !isAuthenticatedRequestCurrent(authContext))) return;
    const errorKey = checkoutRuntimeErrorKey(error);
    if (error?.code === 'IDEMPOTENCY_KEY_REUSED') checkoutIdempotencyKey = null;
    let recoverySucceeded = true;
    if (authenticated && ['CART_CHANGED', 'CART_EMPTY', 'CART_NOT_FOUND', 'CART_SYNC_FAILED'].includes(error?.code)) {
      recoverySucceeded = await renderCheckout();
    }
    if (checkoutSessionExpired) return;
    if (!recoverySucceeded) {
      setCheckoutPending(false);
      return;
    }
    showCheckoutError(t(errorKey), { key: errorKey });
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

function expireCheckoutPage() {
  if (checkoutMode === 'guest') return;
  if (checkoutSessionExpired) return;
  checkoutSessionExpired = true;
  checkoutAddressRequestSequence += 1;
  checkoutCartRequestSequence += 1;
  checkoutReady = false;
  checkoutSubmitting = false;
  checkoutConfirmed = false;
  checkoutItems = [];
  checkoutCartSnapshot = null;
  checkoutAddressId = 'new';
  checkoutIdempotencyKey = null;
  savedAddresses = [];
  savedAddressLoadFailed = false;

  const addressSelect = $('savedAddressSelect');
  if (addressSelect) addressSelect.replaceChildren();
  if ($('savedAddressGroup')) $('savedAddressGroup').hidden = true;
  showSavedAddressError();
  CHECKOUT_FIELDS.forEach(({ id }) => {
    const input = $(id);
    if (input) input.value = '';
  });
  if ($('cEmail')) $('cEmail').value = '';
  if ($('cNote')) $('cNote').value = '';
  const form = $('checkoutForm');
  form?.removeAttribute('aria-busy');
  form?.querySelectorAll('input, select, textarea, button').forEach(control => { control.disabled = true; });
  if ($('coItems')) $('coItems').replaceChildren();
  if ($('coSub')) $('coSub').textContent = '—';
  if ($('coFee')) $('coFee').textContent = '—';
  if ($('coTotal')) $('coTotal').textContent = '—';
  $('checkoutSummary')?.removeAttribute('aria-busy');
  showCheckoutError(t('checkout_session_expired'), { key: 'checkout_session_expired' });
  renderCheckoutSubmit();

  if (!checkoutRedirectStarted) {
    checkoutRedirectStarted = true;
    location.replace('login.html?next=checkout.html');
  }
}

async function initCheckout() {
  checkoutMode = getUser() ? 'authenticated' : 'guest';
  if ($('guestCheckoutContext')) $('guestCheckoutContext').hidden = checkoutMode !== 'guest';
  localizeCheckoutDynamicCopy();
  if (checkoutMode === 'authenticated') {
    $('savedAddressRetry')?.addEventListener('click', () => loadSavedAddresses({ fromRetry: true }));
    await loadSavedAddresses();
    if (checkoutSessionExpired) return;
  } else {
    checkoutAddressId = 'new';
    savedAddresses = [];
    if ($('savedAddressGroup')) $('savedAddressGroup').hidden = true;
    showSavedAddressError();
    fillAddressForm(null);
    if (await restoreGuestConfirmation()) return;
  }
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
  $('checkoutRetry')?.addEventListener('click', () => renderCheckout({ fromRetry: true }));
  checkoutPageInitialized = true;
  await renderCheckout();
}

document.addEventListener('DOMContentLoaded', () => whenStoreReady(initCheckout));
window.addEventListener('am:langchange', () => {
  localizeCheckoutDynamicCopy();
  if (checkoutSessionExpired) {
    showCheckoutError(t('checkout_session_expired'), { key: 'checkout_session_expired' });
    return;
  }
  if (checkoutMode === 'guest' && checkoutConfirmedOrder && checkoutGuestAccess) {
    renderGuestConfirmation(checkoutConfirmedOrder, checkoutGuestAccess, { focus: false, persist: false });
    return;
  }
  if (savedAddressLoadFailed) showSavedAddressError(savedAddressErrorMessage());
  document.querySelectorAll('.co-field-error[data-error-key]').forEach(error => { error.textContent = t(error.dataset.errorKey); });
  renderAddressChooser({ preserveForm: true });
  if (checkoutCartSnapshot) renderCheckoutSummary(checkoutCartSnapshot);
  else if ($('checkoutSummary')?.getAttribute('aria-busy') === 'true') renderCheckoutLoading();
  if (checkoutErrorState.key) {
    showCheckoutError(t(checkoutErrorState.key), {
      key: checkoutErrorState.key,
      retry: checkoutErrorState.retry,
      retryDisabled: checkoutErrorState.retryDisabled
    });
  }
  renderCheckoutSubmit();
});

window.addEventListener('am:session-expired', expireCheckoutPage);
window.addEventListener('am:guest-commerce-changed', () => {
  if (!checkoutPageInitialized || checkoutMode !== 'guest' || checkoutSubmitting || checkoutConfirmed) return;
  renderCheckout();
});
