/** AM MARKET — authenticated order history, tracking, cancellation and returns. */

const ORDER_STEPS = ['confirmed', 'preparing', 'shipping', 'delivered'];
let loadedOrders = [];
const orderCopy = (en, fr) => getLang() === 'fr' ? fr : en;

function statusIndex(status) { return ORDER_STEPS.indexOf(String(status || '').toLowerCase()); }

function timelineHTML(order) {
  if (order.status === 'cancelled') {
    return `<div class="order-timeline is-cancelled" role="status"><span class="ot-dot"><i class="fa-solid fa-xmark"></i></span><span class="ot-label">${orderCopy('Cancelled', 'Annulée')}</span></div>`;
  }
  const index = Math.max(0, statusIndex(order.status));
  return `<div class="order-timeline" role="list" aria-label="${escapeHtml(t('order_progress'))}">
    ${ORDER_STEPS.map((step, i) => `<div class="ot-step ${i <= index ? 'done' : ''} ${i === index ? 'current' : ''}" role="listitem" ${i === index ? 'aria-current="step"' : ''}>
      <span class="ot-dot">${i < index ? '<i class="fa-solid fa-check"></i>' : i + 1}</span><span class="ot-label">${t(`status_${step}`)}</span>
    </div>${i < ORDER_STEPS.length - 1 ? `<div class="ot-line ${i < index ? 'done' : ''}" aria-hidden="true"></div>` : ''}`).join('')}
  </div>`;
}

async function reorder(orderId, button) {
  const order = loadedOrders.find(item => item.id === orderId);
  if (!order) return;
  button.disabled = true;
  let added = 0;
  try {
    for (const item of order.items) {
      const product = await fetchProduct(item.productId);
      if (product.is_available === false) continue;
      addToCart(product.id, item.quantity, product, true);
      added += 1;
    }
    await waitForStoreMutations();
    toast(added ? t('reorder_ok') : t('reorder_none'));
    if (added) setTimeout(() => { location.href = 'cart.html'; }, 500);
  } catch (error) {
    toast(error.message || t('api_error'));
    button.disabled = false;
  }
}

async function cancelOrder(orderId, button) {
  if (!window.confirm(orderCopy('Cancel this order?', 'Annuler cette commande ?'))) return;
  button.disabled = true;
  try {
    await StoreAPI.orders.cancel(orderId, { reason: 'changed_mind' });
    toast(orderCopy('Order cancelled.', 'Commande annulée.'));
    await renderOrders();
  } catch (error) {
    toast(error.message || t('api_error'));
    button.disabled = false;
  }
}

async function submitReturn(order, form) {
  const items = order.items.map(item => {
    const input = form.querySelector(`[data-return-item="${CSS.escape(item.id)}"]`);
    const quantity = Number(input?.value || 0);
    return quantity > 0 ? { orderItemId: item.id, quantity } : null;
  }).filter(Boolean);
  if (!items.length) { toast(orderCopy('Choose at least one item.', 'Choisissez au moins un article.')); return; }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await StoreAPI.orders.requestReturn(order.id, {
      reason: form.elements.reason.value,
      details: form.elements.details.value.trim() || null,
      items
    });
    toast(orderCopy(`Return ${result.return.id} requested.`, `Retour ${result.return.id} demandé.`));
    form.closest('details').open = false;
  } catch (error) {
    toast(error.message || t('api_error'));
  } finally {
    button.disabled = false;
  }
}

function returnPanel(order) {
  if (order.status !== 'delivered' || !order.deliveredAt || Date.now() - new Date(order.deliveredAt).getTime() > 7 * 86400000) return '';
  return `<details class="order-details return-request"><summary>${orderCopy('Request a return', 'Demander un retour')}</summary>
    <form data-return-form="${escapeHtml(order.id)}" class="mt-3">
      <label class="form-label">${orderCopy('Reason', 'Motif')}<select class="form-select" name="reason" required>
        <option value="damaged">${orderCopy('Damaged', 'Endommagé')}</option><option value="wrong_item">${orderCopy('Wrong item', 'Mauvais article')}</option>
        <option value="not_as_described">${orderCopy('Not as described', 'Non conforme')}</option><option value="quality">${orderCopy('Quality issue', 'Problème de qualité')}</option><option value="other">${orderCopy('Other', 'Autre')}</option>
      </select></label>
      ${order.items.map(item => `<label class="d-flex justify-content-between align-items-center gap-3 mb-2"><span>${escapeHtml(item.name)}</span>
        <input class="form-control" style="max-width:5rem" type="number" min="0" max="${item.quantity}" value="0" data-return-item="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.name)} quantity"></label>`).join('')}
      <label class="form-label w-100">${orderCopy('Details (optional)', 'Détails (facultatif)')}<textarea class="form-control" name="details" maxlength="1000"></textarea></label>
      <button class="btn btn-orange" type="submit">${orderCopy('Submit return', 'Envoyer la demande')}</button>
    </form></details>`;
}

function orderCard(order) {
  const date = new Date(order.placedAt).toLocaleDateString(getLang() === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const canCancel = ['confirmed', 'preparing'].includes(order.status);
  return `<article class="order-card" data-order-id="${escapeHtml(order.id)}"><div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
    <div><h2 class="h6 mb-0">${escapeHtml(order.orderNumber)}</h2><div class="small text-muted">${date}</div></div><span class="order-status status-${escapeHtml(order.status)}">${escapeHtml(order.status)}</span></div>
    ${timelineHTML(order)}<div class="small text-muted mb-2 mt-2">${order.items.map(item => `${escapeHtml(item.name)} × ${item.quantity}`).join(', ')}</div>
    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2"><strong>${formatPrice(order.total)}</strong><div class="d-flex gap-2 flex-wrap">
      <button type="button" class="btn-reorder" data-reorder="${escapeHtml(order.id)}"><i class="fa-solid fa-rotate-right me-1"></i>${t('reorder')}</button>
      ${canCancel ? `<button type="button" class="btn btn-sm btn-outline-danger" data-cancel="${escapeHtml(order.id)}">${orderCopy('Cancel', 'Annuler')}</button>` : ''}</div></div>
    <details class="order-details"><summary>${t('order_details')}</summary><div class="order-details-grid">
      <div><strong>${t('delivery_contact')}</strong><span>${escapeHtml([order.address.recipientName, order.address.phone, order.address.email].filter(Boolean).join(' · '))}</span><span>${escapeHtml([order.address.addressLine1, order.address.district, order.address.city].filter(Boolean).join(', '))}</span></div>
      <div class="order-totals"><span>${t('subtotal')} <strong>${formatPrice(order.subtotal)}</strong></span><span>${t('delivery')} <strong>${formatPrice(order.deliveryFee)}</strong></span><span>${t('total')} <strong>${formatPrice(order.total)}</strong></span></div></div>
      ${(order.tracking || []).length ? `<ol class="small mt-3">${order.tracking.map(event => `<li><strong>${escapeHtml(event.status || event.code)}</strong> — ${escapeHtml(event.message || '')} <time>${new Date(event.occurredAt).toLocaleString()}</time></li>`).join('')}</ol>` : ''}</details>
    ${returnPanel(order)}</article>`;
}

async function renderOrders() {
  const box = $('ordersList');
  if (!getUser()) {
    box.innerHTML = `<div class="text-center py-5"><i class="fa-solid fa-lock fa-3x text-muted mb-3"></i><h2 class="h5">${orderCopy('Sign in to view your orders', 'Connectez-vous pour voir vos commandes')}</h2><a class="btn btn-orange mt-2" href="login.html">${orderCopy('Sign in', 'Se connecter')}</a></div>`;
    return;
  }
  box.setAttribute('aria-busy', 'true');
  try {
    const result = await StoreAPI.orders.list({ limit: 30 });
    loadedOrders = await Promise.all((result.orders || []).map(item => StoreAPI.orders.get(item.id).then(payload => payload.order)));
    if (!loadedOrders.length) {
      box.innerHTML = `<div class="text-center py-5"><i class="fa-solid fa-box-open fa-3x text-muted mb-3"></i><h2 class="h5">${t('no_orders')}</h2><a class="btn btn-orange mt-2 state-action" href="categories.html">${t('start_shopping')}</a></div>`;
      return;
    }
    const query = new URLSearchParams(location.search);
    const placedId = query.get('placed');
    const confirmation = placedId && loadedOrders.some(order => order.id === placedId)
      ? `<div class="order-confirmation" role="status"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><div><strong>${orderCopy('Order confirmed', 'Commande confirmée')}</strong><span>${orderCopy('Your order was priced and created securely by the server.', 'Votre commande a été calculée et créée de manière sécurisée par le serveur.')}</span></div></div>`
      : '';
    box.innerHTML = confirmation + loadedOrders.map(orderCard).join('');
    box.querySelectorAll('[data-reorder]').forEach(button => button.addEventListener('click', () => reorder(button.dataset.reorder, button)));
    box.querySelectorAll('[data-cancel]').forEach(button => button.addEventListener('click', () => cancelOrder(button.dataset.cancel, button)));
    box.querySelectorAll('[data-return-form]').forEach(form => form.addEventListener('submit', event => {
      event.preventDefault();
      const order = loadedOrders.find(item => item.id === form.dataset.returnForm);
      if (order) submitReturn(order, form);
    }));
    const focusedId = query.get('order') || placedId;
    if (focusedId) {
      const target = [...box.querySelectorAll('[data-order-id]')].find(card => card.dataset.orderId === focusedId);
      target?.classList.add('order-card-highlight');
      target?.scrollIntoView({ behavior: motionBehavior(), block: 'center' });
    }
  } catch (error) {
    box.innerHTML = `<div class="alert alert-danger" role="alert">${escapeHtml(error.message || t('api_error'))}</div>`;
  } finally { box.removeAttribute('aria-busy'); }
}

document.addEventListener('DOMContentLoaded', () => whenStoreReady(renderOrders));
window.addEventListener('am:langchange', renderOrders);
