/**
 * AM MARKET — checkout.js (checkout.html)
 * Delivery form + order summary. Placing an order writes it to localStorage
 * (shared state, see core.js) and redirects to orders.html.
 */

let checkoutReady = false;
let checkoutItems = [];

async function renderCheckout() {
  if (cart.length === 0) { location.replace('cart.html'); return; }
  checkoutReady = false;
  const summary = $('checkoutSummary');
  const submitBtn = $('placeOrder');
  summary?.setAttribute('aria-busy', 'true');
  if (submitBtn) submitBtn.disabled = true;

  const items = await getCartItems();
  if (!items.length) { location.replace('cart.html'); return; }
  const unavailableItems = items.filter(({ product }) => product.is_available === false);
  const hasUnverified = unavailableItems.some(({ product }) => product.load_failed === true);
  checkoutItems = items.filter(({ product }) => product.is_available !== false);
  const sub = itemsSubtotal(checkoutItems);
  const fee = deliveryFee(sub);

  $('coItems').innerHTML = `${unavailableItems.length ? `<div class="alert alert-danger small" role="alert">${t(hasUnverified ? 'checkout_unverified' : 'checkout_unavailable')} <a class="alert-link" href="cart.html">${t('review_cart')}</a></div>` : ''}` + items.map(({ qty, product: p }) => `
    <div class="co-line-item d-flex justify-content-between small mb-2">
      <span class="co-line-name">${escapeHtml(p.name)} × ${qty}${p.is_available === false ? ` · ${t(p.load_failed ? 'item_unverified' : 'out_stock')}` : ''}</span>
      <span class="co-line-price">${formatPrice(parseFloat(p.price) * qty)}</span>
    </div>
  `).join('');

  $('coSub').textContent = formatPrice(sub);
  $('coFee').textContent = fee === 0 ? t('free') : formatPrice(fee);
  $('coTotal').textContent = formatPrice(sub + fee);
  checkoutReady = unavailableItems.length === 0;
  summary?.removeAttribute('aria-busy');
  if (submitBtn && !checkoutSubmitting) submitBtn.disabled = !checkoutReady;
}

const CHECKOUT_FIELDS = [
  { id: 'cPhone', key: 'phone_required', valid: isValidMoroccanPhone },
  { id: 'cName', key: 'name_required', valid: value => value.length >= 2 },
  { id: 'cCity', key: 'city_required', valid: value => value.length > 0 },
  { id: 'cQuartier', key: 'quartier_required', valid: value => value.length >= 2 },
  { id: 'cAddress', key: 'address_required', valid: value => value.length >= 4 }
];

let checkoutSubmitting = false;

function fieldErrorElement(input) {
  const host = input.closest('.co-phone-group, .co-input-wrap') || input;
  let error = host.parentElement.querySelector(`.co-field-error[data-for="${input.id}"]`);
  if (!error) {
    error = document.createElement('div');
    error.className = 'co-field-error';
    error.dataset.for = input.id;
    error.id = input.id + 'Error';
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
  if (error) error.textContent = '';
  if (error) delete error.dataset.errorKey;
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
      if (!firstInvalid) firstInvalid = input;
    }
  });

  const email = $('cEmail');
  clearFieldError(email);
  if (email.value.trim() && !email.validity.valid) {
    setFieldError(email, 'email_invalid');
    if (!firstInvalid) firstInvalid = email;
  }

  if (firstInvalid) {
    firstInvalid.focus({ preventScroll: true });
    firstInvalid.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    toast(t('fix_fields'));
    return false;
  }
  return true;
}

function placeOrder(event) {
  event?.preventDefault();
  if (checkoutSubmitting || !checkoutReady || cart.length === 0 || checkoutItems.length === 0) return;
  if (!validateCheckout()) return;

  checkoutSubmitting = true;
  const form = $('checkoutForm');
  const submitBtn = $('placeOrder');
  form?.setAttribute('aria-busy', 'true');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.classList.add('is-loading');
    submitBtn.innerHTML = `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span><span>${t('placing_order')}</span>`;
  }

  const name = $('cName').value.trim();
  const phoneDigits = normalizeMoroccanPhone($('cPhone').value);
  const phone = `+212 ${phoneDigits.slice(0, 1)} ${phoneDigits.slice(1, 3)} ${phoneDigits.slice(3, 5)} ${phoneDigits.slice(5, 7)} ${phoneDigits.slice(7, 9)}`;
  const email = $('cEmail').value.trim();
  const address = $('cAddress').value.trim();
  const city = $('cCity').value.trim();
  const quartier = $('cQuartier')?.value.trim() || '';
  const note = $('cNote')?.value.trim() || '';
  const payment = document.querySelector('input[name="pay"]:checked')?.value || 'Cash on Delivery';

  const items = checkoutItems.map(({ id, qty, product: p }) => {
    return {
      id,
      name: p.name,
      price: parseFloat(p.price) || 0,
      qty,
      image_url: p.image_url || ''
    };
  });

  const sub = items.reduce((s, i) => s + i.price * i.qty, 0);
  const fee = deliveryFee(sub);

  const orderId = 'AM' + Date.now().toString().slice(-6);
  orders.unshift({
    id: orderId,
    date: new Date().toISOString(),
    buyer: { name, phone, email, address, city, quartier, note },
    payment,
    items,
    subtotal: sub,
    delivery: fee,
    total: sub + fee,
    status: 'Processing'
  });

  saveOrders();
  cart = [];
  saveCart();

  // Remember the delivery details for the next checkout (settings page shows them too)
  saveDeliveryInfo({ name, phone, email, address, city, quartier });

  const steps = document.querySelectorAll('.co-step');
  steps.forEach((step, index) => {
    step.classList.toggle('active', index === 2);
    step.classList.toggle('completed', index < 2);
    if (index === 2) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  });
  if (submitBtn) {
    submitBtn.classList.remove('is-loading');
    submitBtn.classList.add('is-success');
    submitBtn.innerHTML = `<i class="fa-solid fa-check" aria-hidden="true"></i><span>${t('order_confirmed')}</span>`;
  }
  toast(t('order_ok'));
  setTimeout(() => { location.href = `orders.html?placed=${encodeURIComponent(orderId)}`; }, 850);
}

document.addEventListener('DOMContentLoaded', () => {
  prefillCheckout();
  renderCheckout();
  $('checkoutForm')?.addEventListener('submit', placeOrder);

  CHECKOUT_FIELDS.forEach(({ id }) => {
    const input = $(id);
    input?.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => clearFieldError(input));
  });
  $('cPhone')?.addEventListener('blur', () => {
    const digits = normalizeMoroccanPhone($('cPhone').value);
    if (/^[5-7]\d{8}$/.test(digits)) $('cPhone').value = digits;
  });
  $('cEmail')?.addEventListener('input', () => clearFieldError($('cEmail')));

  // Payment option cards: sync the visual selected state with the radio inputs
  const opts = document.querySelectorAll('.pay-opt');
  const syncPayOpts = () => opts.forEach(o =>
    o.classList.toggle('selected', o.querySelector('input').checked));
  opts.forEach(o => o.querySelector('input').addEventListener('change', syncPayOpts));
  syncPayOpts();
});

// Pre-fill the form from saved delivery details (settings) and the user
// profile. Only empty fields are filled so nothing the visitor already
// typed gets overwritten.
function prefillCheckout() {
  const d = getDeliveryInfo();
  const u = getProfile();
  const fill = (id, v) => { if (v && !$(id).value) $(id).value = v; };
  fill('cName', d.name || (u && u.name) || '');
  const savedPhoneDigits = normalizeMoroccanPhone(d.phone || '');
  fill('cPhone', /^[5-7]\d{8}$/.test(savedPhoneDigits) ? savedPhoneDigits : (d.phone || ''));
  fill('cEmail', d.email || (u && u.email) || '');
  fill('cAddress', d.address || '');
  fill('cCity', d.city || '');
  fill('cQuartier', d.quartier || '');

  // Default payment method from settings
  const pay = getDefaultPay();
  const payIds = { cod: 'pay1', card: 'pay2', wafacash: 'pay3', cashplus: 'pay4' };
  const radio = $(payIds[pay] || 'pay1');
  if (radio) radio.checked = true;
}

// Re-render the summary only (never touches the form fields being filled in)
window.addEventListener('am:langchange', () => {
  document.querySelectorAll('.co-field-error[data-error-key]').forEach(error => {
    error.textContent = t(error.dataset.errorKey);
  });
  if (checkoutSubmitting) {
    const submitBtn = $('placeOrder');
    if (submitBtn?.classList.contains('is-success')) {
      submitBtn.innerHTML = `<i class="fa-solid fa-check" aria-hidden="true"></i><span>${t('order_confirmed')}</span>`;
    } else if (submitBtn) {
      submitBtn.innerHTML = `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span><span>${t('placing_order')}</span>`;
    }
    return;
  }
  renderCheckout();
});
