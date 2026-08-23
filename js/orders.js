/**
 * AM MARKET — orders.js (orders.html)
 * Order history + status timeline (local demo statuses).
 */

const ORDER_STEPS = ['confirmed', 'preparing', 'shipping', 'delivered'];
const reorderPending = new Set();

function statusIndex(status) {
  const s = String(status || 'Processing').toLowerCase();
  if (s === 'delivered' || s === 'livrée' || s === 'livree') return 3;
  if (s === 'shipping' || s === 'en livraison' || s === 'out for delivery') return 2;
  if (s === 'preparing' || s === 'en préparation' || s === 'en preparation') return 1;
  return 0; // confirmed / processing
}

function timelineHTML(status) {
  const idx = statusIndex(status);
  const labels = [
    t('status_confirmed'),
    t('status_preparing'),
    t('status_shipping'),
    t('status_delivered')
  ];
  return `<div class="order-timeline" role="list" aria-label="${escapeHtml(t('order_progress'))}">
    ${ORDER_STEPS.map((step, i) => `
      <div class="ot-step ${i <= idx ? 'done' : ''} ${i === idx ? 'current' : ''}" role="listitem" ${i === idx ? 'aria-current="step"' : ''}>
        <span class="ot-dot">${i < idx ? '<i class="fa-solid fa-check"></i>' : (i + 1)}</span>
        <span class="ot-label">${labels[i]}</span>
      </div>
      ${i < ORDER_STEPS.length - 1 ? `<div class="ot-line ${i < idx ? 'done' : ''}" aria-hidden="true"></div>` : ''}
    `).join('')}
  </div>`;
}

async function reorder(orderId, button) {
  orderId = String(orderId);
  const o = orders.find(x => String(x.id) === String(orderId));
  if (!o || !o.items || !o.items.length) return;
  if (reorderPending.has(orderId)) return;
  reorderPending.add(orderId);
  if (button) {
    button.disabled = true;
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin me-1"></i> ${t('checking_items')}`;
  }

  const checkedItems = await Promise.all(o.items.map(async item => {
    const snapshot = {
      id: item.id,
      name: item.name,
      price: item.price,
      image_url: item.image_url || '',
      brand_name: item.brand_name || ''
    };
    let product = snapshot;
    try {
      product = await fetchProduct(item.id);
    } catch (error) {
      if (error?.status === 404) product = { ...snapshot, is_available: false };
      // For a transient network error, retain a valid saved order snapshot.
    }
    return { item, product };
  }));

  let added = 0;
  let skipped = 0;
  checkedItems.forEach(({ item, product }) => {
    if (product?.is_available === false) { skipped += 1; return; }
    const id = String(item.id);
    const qty = Math.min(99, Math.max(1, Math.floor(Number(item.qty) || 1)));
    const existing = cart.find(cartItem => cartItem.id === id);
    if (existing) existing.qty = Math.min(99, existing.qty + qty);
    else cart.push({
      id,
      qty,
      name: product.name || item.name,
      price: product.price ?? item.price,
      image_url: product.image_url || item.image_url || '',
      brand_name: product.brand_name || item.brand_name || '',
      is_available: true
    });
    added += 1;
  });

  if (added === 0) {
    reorderPending.delete(orderId);
    if (button) {
      button.disabled = false;
      button.innerHTML = `<i class="fa-solid fa-rotate-right me-1"></i> ${t('reorder')}`;
    }
    toast(t('reorder_none'));
    return;
  }
  saveCart();
  toast(skipped ? t('reorder_partial', { added, skipped }) : t('reorder_ok'));
  setTimeout(() => { location.href = 'cart.html'; }, 800);
}

function renderOrders() {
  const box = $('ordersList');
  if (orders.length === 0) {
    box.innerHTML = `<div class="text-center py-5"><i class="fa-solid fa-box-open fa-3x text-muted mb-3"></i><h2 class="h5">${t('no_orders')}</h2><a class="btn btn-orange mt-2 state-action" href="categories.html">${t('start_shopping')}</a></div>`;
    return;
  }
  const placedId = new URLSearchParams(location.search).get('placed');
  const placedBanner = placedId && orders.some(o => String(o.id) === String(placedId))
    ? `<div class="order-confirmation" role="status"><i class="fa-solid fa-circle-check"></i><span>${t('order_placed_banner', { id: escapeHtml(placedId) })}</span></div>`
    : '';
  box.innerHTML = placedBanner + orders.map(o => {
    const date = new Date(o.date).toLocaleDateString(getLang() === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const names = o.items.map(i => `${i.name} × ${i.qty}`).join(', ') || t('order_details_unavailable');
    const payMap = {
      'Cash on Delivery': t('cod'),
      'Card': t('card_label'),
      'Wafacash': 'Wafacash',
      'CashPlus': 'CashPlus'
    };
    const payLabel = payMap[o.payment] || o.payment || t('cod');
    const pending = reorderPending.has(String(o.id));
    return `<article class="order-card">
      <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
        <div><h2 class="h6 mb-0">${t('order_no', { id: escapeHtml(o.id) })}</h2><div class="small text-muted">${date}</div></div>
        <span class="order-status">${t('status_' + (statusIndex(o.status) === 0 ? 'confirmed' : ORDER_STEPS[statusIndex(o.status)]))}</span>
      </div>
      ${timelineHTML(o.status)}
      <div class="small text-muted mb-2 mt-2">${escapeHtml(names)}</div>
      ${o.buyer && o.buyer.note ? `<div class="small text-muted mb-2"><i class="fa-regular fa-note-sticky me-1"></i>${escapeHtml(o.buyer.note)}</div>` : ''}
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div><strong>${formatPrice(o.total)}</strong> <span class="small text-muted ms-2">${escapeHtml(payLabel)}</span></div>
        ${o.items.length ? `<button type="button" class="btn-reorder" data-id="${escapeHtml(o.id)}" ${pending ? 'disabled' : ''}>
          <i class="fa-solid fa-${pending ? 'spinner fa-spin' : 'rotate-right'} me-1"></i> ${t(pending ? 'checking_items' : 'reorder')}
        </button>` : ''}
      </div>
      <details class="order-details">
        <summary>${t('order_details')}</summary>
        <div class="order-details-grid">
          <div><strong>${t('delivery_contact')}</strong><span>${escapeHtml([o.buyer?.name, o.buyer?.phone, o.buyer?.email].filter(Boolean).join(' · '))}</span><span>${escapeHtml([o.buyer?.address, o.buyer?.quartier, o.buyer?.city].filter(Boolean).join(', '))}</span></div>
          <div class="order-totals"><span>${t('subtotal')} <strong>${formatPrice(o.subtotal)}</strong></span><span>${t('delivery')} <strong>${o.delivery === 0 ? t('free') : formatPrice(o.delivery)}</strong></span><span>${t('total')} <strong>${formatPrice(o.total)}</strong></span></div>
        </div>
      </details>
    </article>`;
  }).join('');

  box.querySelectorAll('.btn-reorder').forEach(btn => {
    btn.onclick = () => reorder(btn.dataset.id, btn);
  });
}

document.addEventListener('DOMContentLoaded', renderOrders);

window.addEventListener('am:langchange', renderOrders);
