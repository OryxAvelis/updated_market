/**
 * AM MARKET — cart.js (cart.html)
 * Renders cart items, quantity controls, remove, and order summary.
 */

async function renderCart() {
  const container = $('cartItems');
  const summaryCol = $('summaryCol');
  const label = $('cartLabel');

  if (!cart.length) {
    container.innerHTML = `
      <div class="cart-empty">
        <i class="fa-solid fa-cart-shopping"></i>
        <h5 data-i18n="cart_empty">Your cart is empty</h5>
        <p class="mb-3" data-i18n="cart_empty_sub">Add some products to get started</p>
        <a href="index.html" class="btn btn-orange px-4">
          <i class="fa-solid fa-store me-2"></i>
          <span data-i18n="continue_shopping">Continue Shopping</span>
        </a>
      </div>`;
    summaryCol.style.display = 'none';
    if (label) label.textContent = '(0)';
    applyI18n();
    return;
  }

  const items = await getCartItems();
  const sub = itemsSubtotal(items);
  const fee = deliveryFee(sub);

  if (label) label.textContent = `(${cart.reduce((s, i) => s + i.qty, 0)})`;

  container.innerHTML = items.map(({ id, qty, product: p }) => {
    const lineTotal = (parseFloat(p.price) || 0) * qty;
    const img = p.image_url || 'img/placeholder.svg';
    return `
      <div class="cart-item" data-id="${id}">
        <img src="${escapeHtml(img)}" alt="${escapeHtml(p.name)}" loading="lazy"
             onerror="this.src='img/placeholder.svg'">
        <div class="ci-info">
          <div class="ci-name">${escapeHtml(p.name)}</div>
          <div class="ci-unit">${formatPrice(p.price)} ${t('unit')}</div>
          <div class="ci-actions">
            <div class="qty-box">
              <button type="button" class="qty-minus" data-id="${id}" aria-label="Decrease">−</button>
              <input type="text" value="${qty}" readonly>
              <button type="button" class="qty-plus" data-id="${id}" aria-label="Increase">+</button>
            </div>
            <span class="ci-price">${formatPrice(lineTotal)}</span>
          </div>
        </div>
        <button type="button" class="ci-remove" data-id="${id}" title="Remove" aria-label="Remove">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>`;
  }).join('');

  summaryCol.style.display = '';
  $('subTotal').textContent = formatPrice(sub);
  $('delivFee').textContent = fee === 0 ? t('free') : formatPrice(fee);
  $('grandTotal').textContent = formatPrice(sub + fee);
  $('goCheckout').disabled = false;

  applyI18n();
  bindCartEvents();
}

function bindCartEvents() {
  document.querySelectorAll('.qty-minus').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      const item = cart.find(i => i.id === id);
      if (!item) return;
      if (item.qty <= 1) {
        cart = cart.filter(i => i.id !== id);
      } else {
        item.qty--;
      }
      saveCart();
      renderCart();
    };
  });

  document.querySelectorAll('.qty-plus').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      const item = cart.find(i => i.id === id);
      if (!item) return;
      item.qty++;
      saveCart();
      renderCart();
    };
  });

  document.querySelectorAll('.ci-remove').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      cart = cart.filter(i => i.id !== id);
      saveCart();
      toast(t('removed'));
      renderCart();
    };
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderCart();
  $('goCheckout')?.addEventListener('click', () => {
    if (cart.length) location.href = 'checkout.html';
  });
});