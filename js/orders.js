/**
 * AM MARKET — orders.js (orders.html)
 * Order history, read from localStorage (written by checkout.js).
 */

function renderOrders() {
  const box = $('ordersList');
  if (orders.length === 0) {
    box.innerHTML = `<div class="text-center py-5"><i class="fa-solid fa-box-open fa-3x text-muted mb-3"></i><h5>${t('no_orders')}</h5><a class="btn btn-orange mt-2" href="categories.html">${t('start_shopping')}</a></div>`;
    return;
  }
  box.innerHTML = orders.map(o => {
    const date = new Date(o.date).toLocaleDateString(getLang() === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const names = o.items.map(i => `${i.name} × ${i.qty}`).join(', ');
    const status = (I18N[getLang()] || {})['status_' + String(o.status).toLowerCase()] || o.status;
    const payLabel = o.payment === 'Cash on Delivery' ? t('cod') : t('card_label');
    return `<div class="order-card">
      <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
        <div><strong>${t('order_no', { id: escapeHtml(o.id) })}</strong><div class="small text-muted">${date}</div></div>
        <span class="order-status">${status}</span>
      </div>
      <div class="small text-muted mb-2">${escapeHtml(names)}</div>
      <div class="d-flex justify-content-between"><strong>${formatPrice(o.total)}</strong><span class="small text-muted">${payLabel}</span></div>
    </div>`;
  }).join('');
}

document.addEventListener('DOMContentLoaded', renderOrders);

window.addEventListener('am:langchange', renderOrders);
