/**
 * AM MARKET — cart.js (cart.html)
 * Cart lines with quantity steppers, removal and order summary.
 * Cart state lives in localStorage (see core.js) and is shared with all pages.
 */

async function renderCart() {
  const box = $('cartItems');
  const summaryCol = $('summaryCol');
  const count = cart.reduce((s, i) => s + i.qty, 0);
  $('cartLabel').textContent = `(${count})`;

  if (cart.length === 0) {
    // Empty cart: full-width centered state, same style as orders/wishlist
    // empty pages — the order summary stays hidden until there are items.
    box.className = 'col-12';
    summaryCol.style.display = 'none';
    box.innerHTML = `<div class="text-center py-5"><i class="fa-solid fa-cart-shopping fa-3x text-muted mb-3"></i><h5>${t('cart_empty')}</h5><a class="btn btn-orange mt-2" href="categories.html">${t('continue_shopping')}</a></div>`;
    return;
  }

  box.className = 'col-lg-8';
  summaryCol.style.display = '';
  box.innerHTML = `<div class="text-center py-5 text-muted"><div class="spinner-border spinner-border-sm text-warning" role="status"></div><div class="mt-2 small">${t('loading')}</div></div>`;

  // Product info comes from the cart snapshot, cache, or API (core.js)
  const items = await getCartItems();

  box.innerHTML = items.map(({ id, qty, product: p }) => `
    <div class="cart-item">
      <img src="${p.image_url || ''}" alt="" onerror="this.onerror=null;this.src='img/placeholder.svg'">
      <div class="flex-grow-1">
        <div class="fw-semibold mb-1">${escapeHtml(p.name)}</div>
        <div class="text-muted small mb-2">${t('each', { p: formatPrice(p.price) })}</div>
        <div class="d-flex align-items-center gap-3">
          <div class="qty-box" aria-label="Quantity">
            <button type="button" class="q-minus" data-id="${id}" aria-label="-">−</button>
            <input type="number" value="${qty}" min="1" class="q-val" data-id="${id}" aria-label="Quantity">
            <button type="button" class="q-plus" data-id="${id}" aria-label="+">+</button>
          </div>
          <strong>${formatPrice(parseFloat(p.price) * qty)}</strong>
          <button class="btn btn-sm btn-outline-danger ms-auto rmv" data-id="${id}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    </div>
  `).join('');

  box.querySelectorAll('.q-minus').forEach(b => b.onclick = () => {
    const it = cart.find(i => i.id === b.dataset.id);
    if (it) updateQty(b.dataset.id, it.qty - 1);
  });
  box.querySelectorAll('.q-plus').forEach(b => b.onclick = () => {
    const it = cart.find(i => i.id === b.dataset.id);
    if (it) updateQty(b.dataset.id, it.qty + 1);
  });
  box.querySelectorAll('.q-val').forEach(inp => {
    inp.onchange = () => updateQty(inp.dataset.id, +inp.value || 1);
  });
  box.querySelectorAll('.rmv').forEach(b => b.onclick = () => removeCart(b.dataset.id));

  updateSummary(itemsSubtotal(items));
  $('goCheckout').disabled = false;
}

function updateQty(id, qty) {
  id = String(id);
  if (qty <= 0) cart = cart.filter(i => i.id !== id);
  else {
    const item = cart.find(i => i.id === id);
    if (item) item.qty = qty;
  }
  saveCart();
  renderCart();
}

function removeCart(id) {
  cart = cart.filter(i => i.id !== String(id));
  saveCart();
  renderCart();
  toast(t('removed'));
}

function updateSummary(sub) {
  const fee = deliveryFee(sub);
  $('subTotal').textContent = formatPrice(sub);
  $('delivFee').textContent = fee === 0 ? t('free') : formatPrice(fee);
  $('grandTotal').textContent = formatPrice(sub + fee);
}

document.addEventListener('DOMContentLoaded', () => {
  renderCart();
  $('goCheckout').onclick = () => { location.href = 'checkout.html'; };
});

window.addEventListener('am:langchange', renderCart);
