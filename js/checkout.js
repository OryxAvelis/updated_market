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

function placeOrder() {
  const name = $('cName').value.trim();
  const phone = $('cPhone').value.trim();
  const email = $('cEmail').value.trim();
  const address = $('cAddress').value.trim();
  const city = $('cCity').value.trim();
  const note = $('cNote')?.value.trim() || '';
  const payment = document.querySelector('input[name="pay"]:checked')?.value || 'Cash on Delivery';

  const requiredFields = [$('cName'), $('cPhone'), $('cEmail'), $('cAddress'), $('cCity')];
  const invalid = requiredFields.filter(field => !field.checkValidity());
  requiredFields.forEach(field => {
    field.classList.toggle('is-invalid', invalid.includes(field));
    field.setAttribute('aria-invalid', invalid.includes(field) ? 'true' : 'false');
  });
  if (invalid.length) {
    toast(t('fill_all'));
    invalid[0].focus();
    invalid[0].reportValidity();
    return;
  }

  const items = cart.map(c => {
    const p = productCache[c.id] || { name: c.name || 'Product', price: c.price || 0 };
    return { id: c.id, name: p.name, price: parseFloat(p.price), qty: c.qty };
  });

  const sub = items.reduce((s, i) => s + i.price * i.qty, 0);
  const fee = deliveryFee(sub);

  orders.unshift({
    id: 'AM' + Date.now().toString().slice(-6),
    date: new Date().toISOString(),
    buyer: { name, phone, email, address, city, note },
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
  saveDeliveryInfo({ name, phone, email, address, city });

  toast(t('order_ok'));
  setTimeout(() => { location.href = 'orders.html'; }, 900);
}

document.addEventListener('DOMContentLoaded', () => {
  prefillCheckout();
  renderCheckout();
  $('placeOrder')?.addEventListener('click', placeOrder);

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

  // Default payment method from settings
  // Card checkout needs a real payment provider; keep the static demo honest.
  if ($('pay1')) $('pay1').checked = true;
}

document.addEventListener('input', e => {
  if (!e.target.matches('#cName, #cPhone, #cEmail, #cAddress, #cCity')) return;
  if (e.target.checkValidity()) {
    e.target.classList.remove('is-invalid');
    e.target.setAttribute('aria-invalid', 'false');
  }
});

// Re-render the summary only (never touches the form fields being filled in)
window.addEventListener('am:langchange', renderCheckout);
