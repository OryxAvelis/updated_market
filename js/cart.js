/**
 * AM MARKET — cart.js (cart.html)
 * Renders cart from localStorage, quantity controls, remove, order summary.
 */

async function renderCart() {
  const box = $('cartItems');
  const summaryCol = $('summaryCol');
  const label = $('cartLabel');

  const totalQty = cart.reduce((s, i) => s + i.qty, 0);
  if (label) label.textContent = `(${totalQty})`;

  if (cart.length === 0) {
    box.className = 'col-12';
    box.innerHTML = `
      <div class="cart-empty">
        <div class="cart-empty-visual">
          <div class="cart-empty-ring"></div>
          <div class="cart-empty-icon"><i class="fa-solid fa-cart-shopping"></i></div>
        </div>
        <h5>${t('cart_empty')}</h5>
        <p>${t('cart_empty_sub')}</p>
        <div class="cart-empty-actions">
          <a class="btn btn-orange" href="categories.html"><i class="fa-solid fa-bag-shopping me-2"></i>${t('browse_products')}</a>
          <a class="btn btn-outline-orange" href="index.html">${t('continue_shopping')}</a>
        </div>
      </div>`;
    if (summaryCol) summaryCol.style.display = 'none';
    return;
  }

  box.className = 'col-lg-8';
  box.innerHTML = `<div class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm text-warning"></div></div>`;

  const items = await getCartItems();
  const sub = itemsSubtotal(items);
  const fee = deliveryFee(sub);

  box.innerHTML = items.map(({ id, qty, product: p }) => {
    const line = (parseFloat(p.price) || 0) * qty;
    const img = p.image_url || 'img/placeholder.svg';
    const href = 'product.html?id=' + encodeURIComponent(id);
    return `
      <div class="cart-item" data-id="${escapeHtml(id)}">
        <a class="ci-img-link" href="${href}">
          <img src="${img}" alt="${escapeHtml(p.name)}"
               onerror="this.onerror=null;this.src='img/placeholder.svg'">
        </a>
        <div class="ci-info">
          <a class="ci-name" href="${href}">${escapeHtml(p.name)}</a>
          <div class="ci-unit">${formatPrice(p.price)}</div>
          <div class="ci-actions">
            <div class="qty-box">
              <button type="button" class="qty-minus" data-id="${escapeHtml(id)}" aria-label="${escapeHtml(t('decrease_named', { name: p.name }))}">−</button>
              <input type="text" value="${qty}" readonly aria-label="${escapeHtml(t('quantity_named', { name: p.name }))}">
              <button type="button" class="qty-plus" data-id="${escapeHtml(id)}" aria-label="${escapeHtml(t('increase_named', { name: p.name }))}">+</button>
            </div>
            <span class="ci-price">${formatPrice(line)}</span>
          </div>
        </div>
        <button type="button" class="ci-remove" data-id="${escapeHtml(id)}" title="${t('removed')}"
                aria-label="${escapeHtml(t('remove_named_cart', { name: p.name }))}">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>`;
  }).join('');

  // Summary
  const remaining = Math.max(0, 200 - sub);
  const freeBar = fee === 0
    ? `<div class="free-deliv-bar unlocked"><i class="fa-solid fa-check me-2"></i>${t('free_delivery_unlocked')}</div>`
    : `<div class="free-deliv-bar">
         <div class="free-deliv-text">${t('free_delivery_progress', { amount: formatPrice(remaining) })}</div>
         <div class="free-deliv-track"><div class="free-deliv-fill" style="width:${Math.min(100, (sub / 200) * 100)}%"></div></div>
       </div>`;

  summaryCol.style.display = '';
  summaryCol.innerHTML = `
    <div class="cart-summary">
      <h6>${t('order_summary')}</h6>
      ${freeBar}
      <div class="sum-row"><span>${t('subtotal')}</span><span>${formatPrice(sub)}</span></div>
      <div class="sum-row"><span>${t('delivery')}</span><span>${fee === 0 ? t('free') : formatPrice(fee)}</span></div>
      <div class="sum-total"><span>${t('total')}</span><span class="text-orange">${formatPrice(sub + fee)}</span></div>
      <a href="checkout.html" class="btn-checkout">${t('proceed')} <i class="fa-solid fa-arrow-right"></i></a>
      <a href="categories.html" class="cart-continue-link"><i class="fa-solid fa-arrow-left"></i> ${t('continue_shopping')}</a>
    </div>`;

  bindCartActions();
}

function setQty(id, qty) {
  id = String(id);
  const item = cart.find(i => i.id === id);
  if (!item) return;
  if (qty <= 0) {
    cart = cart.filter(i => i.id !== id);
    toast(t('removed'));
  } else {
    item.qty = qty;
  }
  saveCart();
  renderCart();
}

function bindCartActions() {
  document.querySelectorAll('.qty-minus').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      const item = cart.find(i => i.id === id);
      if (item) setQty(id, item.qty - 1);
    };
  });
  document.querySelectorAll('.qty-plus').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      const item = cart.find(i => i.id === id);
      if (item) setQty(id, item.qty + 1);
    };
  });
  document.querySelectorAll('.ci-remove').forEach(btn => {
    btn.onclick = () => setQty(btn.dataset.id, 0);
  });
}

document.addEventListener('DOMContentLoaded', renderCart);
window.addEventListener('am:langchange', renderCart);
