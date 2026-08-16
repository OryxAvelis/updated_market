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
    buyer: { name, phone, email, address, city },
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
  toast(t('order_ok'));
  setTimeout(() => { location.href = 'orders.html'; }, 900);
}

document.addEventListener('DOMContentLoaded', () => {
  renderCheckout();
  $('placeOrder')?.addEventListener('click', placeOrder);
});

// Re-render the summary only (never touches the form fields being filled in)
window.addEventListener('am:langchange', renderCheckout);
