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

  if (!name || !phone || !email || !address || !city) {
    toast(t('fill_all'));
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
  const pay = getDefaultPay();
  const radio = pay === 'card' ? $('pay2') : $('pay1');
  if (radio) radio.checked = true;
}

// Re-render the summary only (never touches the form fields being filled in)
window.addEventListener('am:langchange', renderCheckout);
