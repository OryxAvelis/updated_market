/**
 * AM MARKET — checkout.js (checkout.html)
 * Delivery form + order summary. Placing an order writes it to localStorage
 * (shared state, see core.js) and redirects to orders.html.
 */

async function renderCheckout() {
  if (cart.length === 0) { location.replace('cart.html'); return; }

  const items = await getCartItems();
  const sub = itemsSubtotal(items);
  const fee = deliveryFee(sub);

  $('coItems').innerHTML = items.map(({ qty, product: p }) => `
    <div class="d-flex justify-content-between small mb-2">
      <span>${escapeHtml(p.name)} × ${qty}</span>
      <span>${formatPrice(parseFloat(p.price) * qty)}</span>
    </div>
  `).join('');

  $('coSub').textContent = formatPrice(sub);
  $('coFee').textContent = fee === 0 ? t('free') : formatPrice(fee);
  $('coTotal').textContent = formatPrice(sub + fee);
}

const CHECKOUT_FIELDS = [
  { id: 'cPhone', key: 'phone_required', valid: value => /^(?:0?[5-7])\d{8}$/.test(value.replace(/\D/g, '')) },
  { id: 'cName', key: 'name_required', valid: value => value.length >= 2 },
  { id: 'cCity', key: 'city_required', valid: value => value.length > 0 },
  { id: 'cQuartier', key: 'quartier_required', valid: value => value.length >= 2 },
  { id: 'cAddress', key: 'address_required', valid: value => value.length >= 4 }
];

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

function setFieldError(input, message) {
  const error = fieldErrorElement(input);
  error.textContent = message;
  input.classList.add('is-invalid');
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', error.id);
}

function clearFieldError(input) {
  const error = input.closest('.col-md-6, .col-12')?.querySelector(`.co-field-error[data-for="${input.id}"]`);
  if (error) error.textContent = '';
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
      setFieldError(input, t(key));
      if (!firstInvalid) firstInvalid = input;
    }
  });

  const email = $('cEmail');
  clearFieldError(email);
  if (email.value.trim() && !email.validity.valid) {
    setFieldError(email, t('email_invalid'));
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
  if (!validateCheckout()) return;

  const name = $('cName').value.trim();
  const phone = $('cPhone').value.trim();
  const email = $('cEmail').value.trim();
  const address = $('cAddress').value.trim();
  const city = $('cCity').value.trim();
  const quartier = $('cQuartier')?.value.trim() || '';
  const note = $('cNote')?.value.trim() || '';
  const payment = document.querySelector('input[name="pay"]:checked')?.value || 'Cash on Delivery';

  const items = cart.map(c => {
    const p = productCache[c.id] || { name: c.name || 'Product', price: c.price || 0, image_url: c.image_url || '' };
    return {
      id: c.id,
      name: p.name || c.name,
      price: parseFloat(p.price ?? c.price) || 0,
      qty: c.qty,
      image_url: p.image_url || c.image_url || ''
    };
  });

  const sub = items.reduce((s, i) => s + i.price * i.qty, 0);
  const fee = deliveryFee(sub);

  orders.unshift({
    id: 'AM' + Date.now().toString().slice(-6),
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

  toast(t('order_ok'));
  setTimeout(() => { location.href = 'orders.html'; }, 900);
}

document.addEventListener('DOMContentLoaded', () => {
  prefillCheckout();
  renderCheckout();
  $('checkoutForm')?.addEventListener('submit', placeOrder);

  CHECKOUT_FIELDS.forEach(({ id }) => {
    const input = $(id);
    input?.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => clearFieldError(input));
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
  const u = getUser();
  const fill = (id, v) => { if (v && !$(id).value) $(id).value = v; };
  fill('cName', d.name || (u && u.name) || '');
  fill('cPhone', d.phone || '');
  fill('cEmail', d.email || (u && u.email) || '');
  fill('cAddress', d.address || '');
  fill('cCity', d.city || '');
  fill('cQuartier', d.quartier || '');

  // Default payment method from settings
  const pay = getDefaultPay();
  const radio = pay === 'card' ? $('pay2') : $('pay1');
  if (radio) radio.checked = true;
}

// Re-render the summary only (never touches the form fields being filled in)
window.addEventListener('am:langchange', renderCheckout);
