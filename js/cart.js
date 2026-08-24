/**
 * AM MARKET — cart.js (cart.html)
 * Renders the guest or authenticated cart, quantity controls, remove, and summary.
 */

let cartRenderSequence = 0;

function cartProductAvailable(product, quantity) {
  if (product.is_available === false || product.load_failed) return false;
  return !Number.isInteger(product.stock_quantity) || quantity <= product.stock_quantity;
}

async function renderCart(focusTarget = null) {
  const renderSequence = ++cartRenderSequence;
  const box = $('cartItems');
  const summaryCol = $('summaryCol');
  const label = $('cartLabel');

  if (getAuthenticatedResourceState('cart') === 'error') {
    if (label) label.textContent = '(—)';
    box.className = 'col-12';
    box.removeAttribute('aria-busy');
    box.innerHTML = `<div class="alert alert-warning d-flex flex-wrap align-items-center justify-content-between gap-2" role="alert">
      <span>${escapeHtml(accountRecoveryMessage(['cart']))}</span>
      <button type="button" class="btn btn-sm btn-outline-orange state-action" id="retryAccountCart">${escapeHtml(t('retry'))}</button>
    </div>`;
    if (summaryCol) summaryCol.style.display = 'none';
    $('retryAccountCart')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      const recovered = await retryAuthenticatedResources();
      if (!recovered && button.isConnected) button.disabled = false;
    });
    return;
  }

  const totalQty = cart.reduce((s, i) => s + i.qty, 0);
  if (label) label.textContent = `(${totalQty})`;

  if (cart.length === 0) {
    box.className = 'col-12';
    box.innerHTML = `
      <div class="cart-empty">
        <div class="cart-empty-visual" aria-hidden="true"><i class="fa-solid fa-cart-shopping"></i></div>
        <h2 class="h5">${t('cart_empty')}</h2>
        <p>${t('cart_empty_sub')}</p>
        <div class="cart-empty-actions">
          <a class="btn btn-orange" href="categories.html"><i class="fa-solid fa-bag-shopping me-2"></i>${t('browse_products')}</a>
          <a class="btn btn-outline-orange" href="index.html">${t('continue_shopping')}</a>
        </div>
      </div>`;
    if (summaryCol) summaryCol.style.display = 'none';
    box.removeAttribute('aria-busy');
    const live = $('cartLive');
    if (live) live.textContent = t('cart_empty');
    return;
  }

  box.className = 'col-lg-8';
  box.setAttribute('aria-busy', 'true');
  box.innerHTML = Array.from({ length: Math.min(3, cart.length) }, () => `
    <div class="cart-item cart-item-skeleton" aria-hidden="true">
      <span class="skeleton-block cart-skeleton-img"></span>
      <span class="cart-skeleton-copy">
        <span class="skeleton-block skeleton-line title"></span>
        <span class="skeleton-block skeleton-line short"></span>
      </span>
    </div>`).join('');

  const items = await getCartItems();
  if (renderSequence !== cartRenderSequence) return;
  box.removeAttribute('aria-busy');
  const unavailableItems = items.filter(({ product, qty }) => !cartProductAvailable(product, qty));
  const unverifiedItems = unavailableItems.filter(({ product }) => product.load_failed === true);
  const availableItems = items.filter(({ product, qty }) => cartProductAvailable(product, qty));
  const sub = itemsSubtotal(availableItems);
  const fee = deliveryFee(sub);

  box.innerHTML = items.map(({ id, qty, product: p }) => {
    const line = (parseFloat(p.price) || 0) * qty;
    const imageSrc = safeImageUrl(p.image_url);
    const href = 'product.html?id=' + encodeURIComponent(id);
    const safeHref = escapeHtml(href);
    const catalogAvailable = p.is_available !== false && !p.load_failed;
    const stockInsufficient = Number.isInteger(p.stock_quantity) && qty > p.stock_quantity;
    const available = catalogAvailable && !stockInsufficient;
    const availabilityLabel = p.load_failed
      ? t('item_unverified')
      : stockInsufficient
        ? t('quantity_unavailable', { n: p.stock_quantity })
        : t('out_stock');
    return `
      <div class="cart-item ${available ? '' : 'is-unavailable'}" data-id="${escapeHtml(id)}">
        <a class="ci-img-link" href="${safeHref}">
          <img src="${imageSrc}" alt="${escapeHtml(p.name)}" data-image-fallback="img/placeholder.svg">
        </a>
        <div class="ci-info">
          <a class="ci-name" href="${safeHref}">${escapeHtml(p.name)}</a>
          <div class="ci-unit">${formatPrice(p.price)} ${available ? '' : `· <strong class="ci-stock-out">${availabilityLabel}</strong>`}</div>
          <div class="ci-actions">
            <div class="qty-box">
              <button type="button" class="qty-minus" data-id="${escapeHtml(id)}" aria-label="${escapeHtml(t('decrease_named', { name: p.name }))}" ${catalogAvailable ? '' : 'disabled'}>−</button>
              <input type="text" value="${qty}" readonly aria-label="${escapeHtml(t('quantity_named', { name: p.name }))}">
              <button type="button" class="qty-plus" data-id="${escapeHtml(id)}" aria-label="${escapeHtml(t('increase_named', { name: p.name }))}" ${available ? '' : 'disabled'}>+</button>
            </div>
            <span class="ci-price">${available ? formatPrice(line) : `<s>${formatPrice(line)}</s>`}</span>
          </div>
        </div>
        <button type="button" class="ci-remove" data-id="${escapeHtml(id)}" title="${escapeHtml(t('remove_named_cart', { name: p.name }))}"
                aria-label="${escapeHtml(t('remove_named_cart', { name: p.name }))}">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>`;
  }).join('');

  // Summary
  const remaining = Math.max(0, 200 - sub);
  const freeBar = availableItems.length === 0
    ? ''
    : fee === 0
      ? `<div class="free-deliv-bar unlocked"><i class="fa-solid fa-check me-2"></i>${t('free_delivery_unlocked')}</div>`
      : `<div class="free-deliv-bar">
         <div class="free-deliv-text">${t('free_delivery_progress', { amount: formatPrice(remaining) })}</div>
         <div class="free-deliv-track"><div class="free-deliv-fill" style="width:${Math.min(100, (sub / 200) * 100)}%"></div></div>
       </div>`;

  summaryCol.style.display = '';
  summaryCol.innerHTML = `
    <div class="cart-summary">
      <h2 class="h6">${t('order_summary')}</h2>
      ${unavailableItems.length ? `<div class="cart-availability-note" role="status">${t(unverifiedItems.length ? 'cart_items_need_review' : 'unavailable_cart_notice', { n: unavailableItems.length })}<span class="d-flex flex-wrap gap-2">${unverifiedItems.length ? `<button type="button" id="retryCartItems">${t('retry_cart_items')}</button>` : ''}<button type="button" id="removeUnavailable">${t('remove_unavailable')}</button></span></div>` : ''}
      ${freeBar}
      <div class="sum-row"><span>${t('subtotal')}</span><span>${formatPrice(sub)}</span></div>
      <div class="sum-row"><span>${t('delivery')}</span><span>${fee === 0 ? t('free') : formatPrice(fee)}</span></div>
      <div class="sum-total"><span>${t('total')}</span><span class="text-orange">${formatPrice(sub + fee)}</span></div>
      ${unavailableItems.length
        ? `<button type="button" class="btn-checkout" disabled>${t('resolve_before_checkout')}</button>`
        : `<a href="checkout.html" class="btn-checkout">${t('proceed')} <i class="fa-solid fa-arrow-right"></i></a>`}
      <a href="categories.html" class="cart-continue-link"><i class="fa-solid fa-arrow-left"></i> ${t('continue_shopping')}</a>
    </div>`;

  bindCartActions();
  summaryCol.querySelector('a.btn-checkout')?.addEventListener('click', async event => {
    if (!getUser()) return;
    event.preventDefault();
    const link = event.currentTarget;
    link.setAttribute('aria-disabled', 'true');
    try {
      await waitForStoreMutations();
      location.href = 'checkout.html';
    } catch (error) {
      if (handleStoreUnauthorized(error)) return;
      console.error('Cart synchronization before checkout failed', error);
      toast(t('api_error'));
      renderAccountRecovery();
      link.removeAttribute('aria-disabled');
      link.focus({ preventScroll: true });
    }
  });
  $('removeUnavailable')?.addEventListener('click', async () => {
    const unavailableIds = new Set(unavailableItems.map(item => String(item.id)));
    const removedItems = cart.filter(item => unavailableIds.has(String(item.id))).map(item => ({ ...item }));
    const insertAt = Math.max(0, cart.findIndex(item => unavailableIds.has(String(item.id))));
    cart = cart.filter(item => !unavailableIds.has(String(item.id)));
    saveCart();
    await renderCart();
    $('cartHeading')?.focus({ preventScroll: true });
    toast(t('removed'), t('undo'), async () => {
      const existingIds = new Set(cart.map(item => String(item.id)));
      const restore = removedItems.filter(item => !existingIds.has(String(item.id)));
      cart.splice(Math.min(insertAt, cart.length), 0, ...restore);
      saveCart();
      await renderCart();
      $('removeUnavailable')?.focus({ preventScroll: true });
      toast(t('data_restored'));
    });
  });
  $('retryCartItems')?.addEventListener('click', () => {
    unverifiedItems.forEach(item => { delete productCache[item.id]; });
    renderCart();
  });
  const live = $('cartLive');
  if (live) live.textContent = t('cart_summary_live', { n: totalQty, total: formatPrice(sub + fee) });
  if (focusTarget) {
    requestAnimationFrame(() => {
      const target = [...document.querySelectorAll(`.${focusTarget.action}[data-id]`)]
        .find(button => button.dataset.id === String(focusTarget.id));
      target?.focus({ preventScroll: true });
    });
  }
}

async function removeCartItem(id) {
  id = String(id);
  const index = cart.findIndex(i => i.id === id);
  if (index < 0) return;
  const removedItem = { ...cart[index] };
  const itemName = removedItem.name || t('product_crumb');
  const nextItem = cart[index + 1] || cart[index - 1] || null;
  cart.splice(index, 1);
  saveCart();
  $('cartHeading')?.focus({ preventScroll: true });
  await renderCart(nextItem ? { id: String(nextItem.id), action: 'ci-remove' } : null);
  if (!nextItem) $('cartHeading')?.focus({ preventScroll: true });
  toast(t('removed_from_cart', { name: itemName }), t('undo'), () => {
      if (cart.some(i => i.id === id)) return;
      cart.splice(Math.min(index, cart.length), 0, removedItem);
      saveCart();
      renderCart({ id, action: 'ci-remove' });
      toast(t('restored_cart', { name: itemName }));
    });
}

function setQty(id, qty, focusAction = null) {
  id = String(id);
  const item = cart.find(i => i.id === id);
  if (!item) return;
  if (qty <= 0) { removeCartItem(id); return; }
  item.qty = Math.max(1, Math.min(99, Math.floor(Number(qty) || 1)));
  saveCart();
  renderCart(focusAction ? { id, action: focusAction } : null);
}

function bindCartActions() {
  document.querySelectorAll('.qty-minus').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      const item = cart.find(i => i.id === id);
      if (item) setQty(id, item.qty - 1, 'qty-minus');
    };
  });
  document.querySelectorAll('.qty-plus').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      const item = cart.find(i => i.id === id);
      if (item) setQty(id, item.qty + 1, 'qty-plus');
    };
  });
  document.querySelectorAll('.ci-remove').forEach(btn => {
    btn.onclick = () => setQty(btn.dataset.id, 0);
  });
}

document.addEventListener('DOMContentLoaded', () => whenStoreReady(renderCart));
window.addEventListener('am:langchange', renderCart);
window.addEventListener('am:account-resources-recovered', event => {
  if (!event.detail?.resources?.includes('cart')) return;
  renderCart().then(() => $('cartHeading')?.focus({ preventScroll: true }));
});
window.addEventListener('am:account-resource-error', event => {
  if (event.detail?.resource === 'cart') renderCart();
});
window.addEventListener('am:cart-reconciled', () => {
  renderCart().then(() => $('cartHeading')?.focus({ preventScroll: true }));
});
window.addEventListener('am:session-expired', () => {
  const hadPrivateFocus = $('cartItems')?.contains(document.activeElement) ||
    $('summaryCol')?.contains(document.activeElement);
  renderCart().then(() => {
    if (hadPrivateFocus) $('cartHeading')?.focus({ preventScroll: true });
  });
});
window.addEventListener('am:guest-commerce-changed', () => renderCart());
