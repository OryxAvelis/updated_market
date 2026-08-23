/**
 * Orders admin page.
 * Status edits intentionally update only order.status in the browser-local am_orders array.
 */
(() => {
  'use strict';

  Object.assign(I18N.en, {
    title_admin_orders: 'Orders — AM MARKET Admin',
    admin_orders_kicker: 'Local order operations',
    admin_orders_title: 'Orders',
    admin_orders_intro: 'Review browser-local orders and update their local workflow status.',
    admin_local_only: 'Local only',
    admin_orders_search_label: 'Search orders',
    admin_orders_search_placeholder: 'Order, customer, phone or email',
    admin_orders_filter_label: 'Status',
    admin_orders_all_statuses: 'All statuses',
    admin_status_processing: 'Processing',
    admin_status_confirmed: 'Confirmed',
    admin_status_preparing: 'Preparing',
    admin_status_shipping: 'Shipping',
    admin_status_delivered: 'Delivered',
    admin_clear_filters: 'Clear filters',
    admin_orders_local_note: 'Status changes are stored in this browser only and are not sent to a server.',
    admin_orders_loading: 'Loading local orders…',
    admin_orders_table_caption: 'Local order list',
    admin_orders_col_order: 'Order',
    admin_orders_col_customer: 'Customer',
    admin_orders_col_date: 'Date',
    admin_orders_col_items: 'Items',
    admin_orders_col_total: 'Total',
    admin_orders_col_status: 'Status',
    admin_actions: 'Actions',
    admin_orders_detail_kicker: 'Order detail',
    admin_close: 'Close',
    admin_orders_new_status: 'New status',
    admin_cancel: 'Cancel',
    admin_orders_update_status: 'Update local status',
    admin_orders_count: '{shown} of {total} orders',
    admin_orders_empty_title: 'No local orders yet',
    admin_orders_empty_text: 'Orders placed through the storefront will appear here.',
    admin_orders_filtered_title: 'No matching orders',
    admin_orders_filtered_text: 'Try another search or status filter.',
    admin_orders_error_title: 'Orders could not be loaded',
    admin_orders_error_text: 'The browser-local order data is unavailable or invalid.',
    admin_retry: 'Retry',
    admin_view_details: 'View details',
    admin_orders_item_count: '{count} item(s)',
    admin_orders_customer_unknown: 'Customer name unavailable',
    admin_orders_payment_unavailable: 'Payment not recorded',
    admin_orders_detail_date: 'Placed',
    admin_orders_detail_payment: 'Payment',
    admin_orders_detail_status: 'Current status',
    admin_orders_contact_title: 'Buyer and delivery details',
    admin_orders_items_title: 'Items',
    admin_orders_totals_title: 'Totals',
    admin_orders_name: 'Name',
    admin_orders_phone: 'Phone',
    admin_orders_email: 'Email',
    admin_orders_address: 'Address',
    admin_orders_city: 'City',
    admin_orders_district: 'District',
    admin_orders_note: 'Note',
    admin_orders_no_contact: 'No buyer details were recorded for this order.',
    admin_orders_no_items: 'No item details were recorded.',
    admin_orders_quantity: 'Quantity',
    admin_orders_subtotal: 'Subtotal',
    admin_orders_delivery: 'Delivery',
    admin_orders_total: 'Total',
    admin_orders_free: 'Free',
    admin_orders_status_required: 'Choose one of the supported order statuses.',
    admin_orders_current_unsupported: 'Current: {status} — choose a supported status',
    admin_orders_status_changed: 'Order {id} status changed locally to {status}.',
    admin_orders_status_failed: 'The local status change could not be stored.',
    admin_orders_status_unchanged: 'Order {id} already has this status.',
    admin_orders_missing: 'This order is no longer available.',
    admin_not_available: 'Not available'
  });

  Object.assign(I18N.fr, {
    title_admin_orders: 'Commandes — Administration AM MARKET',
    admin_orders_kicker: 'Gestion locale des commandes',
    admin_orders_title: 'Commandes',
    admin_orders_intro: 'Consultez les commandes enregistrées dans ce navigateur et modifiez leur état local.',
    admin_local_only: 'Local uniquement',
    admin_orders_search_label: 'Rechercher des commandes',
    admin_orders_search_placeholder: 'Commande, client, téléphone ou e-mail',
    admin_orders_filter_label: 'État',
    admin_orders_all_statuses: 'Tous les états',
    admin_status_processing: 'En traitement',
    admin_status_confirmed: 'Confirmée',
    admin_status_preparing: 'En préparation',
    admin_status_shipping: 'En livraison',
    admin_status_delivered: 'Livrée',
    admin_clear_filters: 'Effacer les filtres',
    admin_orders_local_note: 'Les changements d’état sont stockés uniquement dans ce navigateur et ne sont envoyés à aucun serveur.',
    admin_orders_loading: 'Chargement des commandes locales…',
    admin_orders_table_caption: 'Liste locale des commandes',
    admin_orders_col_order: 'Commande',
    admin_orders_col_customer: 'Client',
    admin_orders_col_date: 'Date',
    admin_orders_col_items: 'Articles',
    admin_orders_col_total: 'Total',
    admin_orders_col_status: 'État',
    admin_actions: 'Actions',
    admin_orders_detail_kicker: 'Détail de la commande',
    admin_close: 'Fermer',
    admin_orders_new_status: 'Nouvel état',
    admin_cancel: 'Annuler',
    admin_orders_update_status: 'Mettre à jour localement',
    admin_orders_count: '{shown} commande(s) sur {total}',
    admin_orders_empty_title: 'Aucune commande locale',
    admin_orders_empty_text: 'Les commandes passées depuis la boutique apparaîtront ici.',
    admin_orders_filtered_title: 'Aucune commande correspondante',
    admin_orders_filtered_text: 'Essayez une autre recherche ou un autre filtre d’état.',
    admin_orders_error_title: 'Impossible de charger les commandes',
    admin_orders_error_text: 'Les données locales de commande sont indisponibles ou invalides.',
    admin_retry: 'Réessayer',
    admin_view_details: 'Voir le détail',
    admin_orders_item_count: '{count} article(s)',
    admin_orders_customer_unknown: 'Nom du client indisponible',
    admin_orders_payment_unavailable: 'Paiement non renseigné',
    admin_orders_detail_date: 'Passée le',
    admin_orders_detail_payment: 'Paiement',
    admin_orders_detail_status: 'État actuel',
    admin_orders_contact_title: 'Client et livraison',
    admin_orders_items_title: 'Articles',
    admin_orders_totals_title: 'Totaux',
    admin_orders_name: 'Nom',
    admin_orders_phone: 'Téléphone',
    admin_orders_email: 'E-mail',
    admin_orders_address: 'Adresse',
    admin_orders_city: 'Ville',
    admin_orders_district: 'Quartier',
    admin_orders_note: 'Note',
    admin_orders_no_contact: 'Aucune coordonnée client n’a été enregistrée pour cette commande.',
    admin_orders_no_items: 'Aucun détail d’article n’a été enregistré.',
    admin_orders_quantity: 'Quantité',
    admin_orders_subtotal: 'Sous-total',
    admin_orders_delivery: 'Livraison',
    admin_orders_total: 'Total',
    admin_orders_free: 'Gratuite',
    admin_orders_status_required: 'Choisissez l’un des états de commande pris en charge.',
    admin_orders_current_unsupported: 'État actuel : {status} — choisissez un état pris en charge',
    admin_orders_status_changed: 'L’état de la commande {id} a été modifié localement en « {status} ».',
    admin_orders_status_failed: 'Le changement d’état local n’a pas pu être stocké.',
    admin_orders_status_unchanged: 'La commande {id} possède déjà cet état.',
    admin_orders_missing: 'Cette commande n’est plus disponible.',
    admin_not_available: 'Non disponible'
  });

  const STATUSES = ['Processing', 'Confirmed', 'Preparing', 'Shipping', 'Delivered'];
  let sourceOrders = [];
  let activeOrderIndex = -1;
  let initialized = false;

  const byId = id => document.getElementById(id);
  const esc = value => AdminCore.escape(value == null ? '' : String(value));
  const normalized = value => String(value || '').trim().toLowerCase();

  function statusKey(status) {
    const match = STATUSES.find(item => normalized(item) === normalized(status));
    return match ? `admin_status_${match.toLowerCase()}` : '';
  }

  function statusLabel(status) {
    const key = statusKey(status);
    if (key) return t(key);
    return String(status || t('admin_status_processing'));
  }

  function itemCount(order) {
    if (!Array.isArray(order?.items)) return 0;
    return order.items.reduce((sum, item) => sum + Math.max(1, Math.floor(Number(item?.qty) || 1)), 0);
  }

  function orderSearchValue(order) {
    const buyer = order?.buyer && typeof order.buyer === 'object' ? order.buyer : {};
    const items = Array.isArray(order?.items) ? order.items.map(item => item?.name || '').join(' ') : '';
    return normalized([
      order?.id,
      buyer.name,
      buyer.phone,
      buyer.email,
      buyer.address,
      buyer.city,
      buyer.quartier,
      items
    ].filter(Boolean).join(' '));
  }

  function showState(kind, titleKey, textKey, retry = false) {
    const state = byId('adminOrdersState');
    const wrap = byId('adminOrdersTableWrap');
    wrap.hidden = true;
    state.hidden = false;
    AdminCore.state(state, {
      type: kind,
      title: t(titleKey),
      body: t(textKey),
      actionLabel: retry ? t('admin_retry') : '',
      onAction: retry ? loadOrders : null
    });
  }

  function filterOrders() {
    const query = normalized(byId('adminOrderSearch')?.value);
    const status = byId('adminOrderStatus')?.value || 'all';
    return sourceOrders
      .map((order, index) => ({ order, index }))
      .filter(({ order }) => !query || orderSearchValue(order).includes(query))
      .filter(({ order }) => status === 'all' || normalized(order?.status || 'Processing') === normalized(status));
  }

  function renderOrders() {
    const state = byId('adminOrdersState');
    const wrap = byId('adminOrdersTableWrap');
    const body = byId('adminOrdersBody');
    const filtered = filterOrders();

    byId('adminOrdersCount').textContent = t('admin_orders_count', {
      shown: filtered.length,
      total: sourceOrders.length
    });

    if (!sourceOrders.length) {
      showState('empty', 'admin_orders_empty_title', 'admin_orders_empty_text');
      return;
    }
    if (!filtered.length) {
      showState('empty', 'admin_orders_filtered_title', 'admin_orders_filtered_text');
      return;
    }

    body.innerHTML = filtered.map(({ order, index }) => {
      const buyer = order?.buyer && typeof order.buyer === 'object' ? order.buyer : {};
      const contact = [buyer.email, buyer.phone].filter(Boolean).join(' · ');
      const payment = order?.payment || t('admin_orders_payment_unavailable');
      return `<tr>
        <td data-label="${esc(t('admin_orders_col_order'))}">
          <span class="admin-order-id">#${esc(order?.id)}</span>
          <span class="admin-order-payment">${esc(payment)}</span>
        </td>
        <td data-label="${esc(t('admin_orders_col_customer'))}">
          <span class="admin-order-customer-name">${esc(buyer.name || t('admin_orders_customer_unknown'))}</span>
          ${contact ? `<span class="admin-order-customer-meta">${esc(contact)}</span>` : ''}
        </td>
        <td data-label="${esc(t('admin_orders_col_date'))}">${esc(AdminCore.formatDate(order?.date))}</td>
        <td data-label="${esc(t('admin_orders_col_items'))}"><span class="admin-order-items-count">${esc(t('admin_orders_item_count', { count: itemCount(order) }))}</span></td>
        <td data-label="${esc(t('admin_orders_col_total'))}"><strong>${esc(formatPrice(order?.total))}</strong></td>
        <td data-label="${esc(t('admin_orders_col_status'))}"><span class="admin-status-badge">${esc(statusLabel(order?.status))}</span></td>
        <td data-label="${esc(t('admin_actions'))}">
          <button class="admin-button admin-button--secondary admin-order-view" type="button" data-order-index="${index}">
            <i class="fa-regular fa-eye" aria-hidden="true"></i> ${esc(t('admin_view_details'))}
          </button>
        </td>
      </tr>`;
    }).join('');

    state.hidden = true;
    wrap.hidden = false;
    body.querySelectorAll('[data-order-index]').forEach(button => {
      button.addEventListener('click', () => openOrder(Number(button.dataset.orderIndex)));
    });
  }

  function detailRow(labelKey, value) {
    if (value == null || String(value).trim() === '') return '';
    return `<li><span>${esc(t(labelKey))}</span><strong>${esc(value)}</strong></li>`;
  }

  function renderOrderDetail(order) {
    const buyer = order?.buyer && typeof order.buyer === 'object' ? order.buyer : {};
    const items = Array.isArray(order?.items) ? order.items : [];
    const contactRows = [
      detailRow('admin_orders_name', buyer.name),
      detailRow('admin_orders_phone', buyer.phone),
      detailRow('admin_orders_email', buyer.email),
      detailRow('admin_orders_address', buyer.address),
      detailRow('admin_orders_city', buyer.city),
      detailRow('admin_orders_district', buyer.quartier),
      detailRow('admin_orders_note', buyer.note)
    ].join('');

    byId('adminOrderDialogTitle').textContent = `#${order?.id ?? ''}`;
    byId('adminOrderDetail').innerHTML = `
      <dl class="admin-order-detail-summary">
        <div class="admin-order-detail-card"><dt>${esc(t('admin_orders_detail_date'))}</dt><dd>${esc(AdminCore.formatDate(order?.date))}</dd></div>
        <div class="admin-order-detail-card"><dt>${esc(t('admin_orders_detail_payment'))}</dt><dd>${esc(order?.payment || t('admin_orders_payment_unavailable'))}</dd></div>
        <div class="admin-order-detail-card"><dt>${esc(t('admin_orders_detail_status'))}</dt><dd><span class="admin-status-badge">${esc(statusLabel(order?.status))}</span></dd></div>
      </dl>
      <section aria-labelledby="adminOrderContactHeading">
        <h3 id="adminOrderContactHeading" class="admin-order-section-title">${esc(t('admin_orders_contact_title'))}</h3>
        ${contactRows ? `<ul class="admin-order-contact">${contactRows}</ul>` : `<p>${esc(t('admin_orders_no_contact'))}</p>`}
      </section>
      <section aria-labelledby="adminOrderItemsHeading">
        <h3 id="adminOrderItemsHeading" class="admin-order-section-title">${esc(t('admin_orders_items_title'))}</h3>
        ${items.length ? `<ul class="admin-order-item-list">${items.map(item => `
          <li><div><strong>${esc(item?.name || t('admin_not_available'))}</strong><small>${esc(t('admin_orders_quantity'))}: ${esc(item?.qty ?? t('admin_not_available'))}</small></div><strong>${esc(formatPrice((Number(item?.price) || 0) * (Number(item?.qty) || 1)))}</strong></li>`).join('')}</ul>` : `<p>${esc(t('admin_orders_no_items'))}</p>`}
      </section>
      <section aria-labelledby="adminOrderTotalsHeading">
        <h3 id="adminOrderTotalsHeading" class="admin-order-section-title">${esc(t('admin_orders_totals_title'))}</h3>
        <ul class="admin-order-totals">
          <li><span>${esc(t('admin_orders_subtotal'))}</span><strong>${esc(formatPrice(order?.subtotal))}</strong></li>
          <li><span>${esc(t('admin_orders_delivery'))}</span><strong>${order?.delivery === 0 ? esc(t('admin_orders_free')) : esc(formatPrice(order?.delivery))}</strong></li>
          <li><span>${esc(t('admin_orders_total'))}</span><strong>${esc(formatPrice(order?.total))}</strong></li>
        </ul>
      </section>`;
  }

  function prepareStatusControl(order) {
    const select = byId('adminOrderStatusEdit');
    select.querySelector('[data-unsupported-status]')?.remove();
    const current = STATUSES.find(status => normalized(status) === normalized(order?.status || 'Processing'));
    if (current) {
      select.value = current;
    } else {
      const option = document.createElement('option');
      option.value = '';
      option.disabled = true;
      option.selected = true;
      option.dataset.unsupportedStatus = 'true';
      option.textContent = t('admin_orders_current_unsupported', { status: order?.status || t('admin_not_available') });
      select.prepend(option);
    }
    byId('adminOrderStatusError').textContent = '';
  }

  function openOrder(index) {
    const order = sourceOrders[index];
    if (!order) {
      AdminCore.toast(t('admin_orders_missing'), 'error');
      return;
    }
    activeOrderIndex = index;
    renderOrderDetail(order);
    prepareStatusControl(order);
    const dialog = byId('adminOrderDialog');
    if (!dialog.open) dialog.showModal();
  }

  function closeOrder() {
    const dialog = byId('adminOrderDialog');
    if (dialog.open) dialog.close();
    activeOrderIndex = -1;
  }

  async function saveStatus(event) {
    event.preventDefault();
    const select = byId('adminOrderStatusEdit');
    const error = byId('adminOrderStatusError');
    const button = byId('adminOrderStatusSave');
    const nextStatus = select.value;
    const order = sourceOrders[activeOrderIndex];

    error.textContent = '';
    if (!order) {
      error.textContent = t('admin_orders_missing');
      return;
    }
    if (!STATUSES.includes(nextStatus)) {
      error.textContent = t('admin_orders_status_required');
      select.focus();
      return;
    }
    if (normalized(order.status || 'Processing') === normalized(nextStatus)) {
      AdminCore.toast(t('admin_orders_status_unchanged', { id: order.id }));
      closeOrder();
      return;
    }

    const previousStatus = order.status;
    AdminCore.setBusy(button, true);
    try {
      // Deliberately mutate this field only; all unknown order fields remain untouched.
      order.status = nextStatus;
      saveOrders();
      AdminCore.toast(t('admin_orders_status_changed', {
        id: order.id,
        status: statusLabel(nextStatus)
      }), 'success');
      renderOrders();
      closeOrder();
    } catch {
      order.status = previousStatus;
      error.textContent = t('admin_orders_status_failed');
      AdminCore.toast(t('admin_orders_status_failed'), 'error');
    } finally {
      AdminCore.setBusy(button, false);
    }
  }

  function loadOrders() {
    const state = byId('adminOrdersState');
    byId('adminOrdersTableWrap').hidden = true;
    state.hidden = false;
    AdminCore.state(state, { type: 'loading', title: t('admin_orders_loading') });

    queueMicrotask(() => {
      try {
        const stored = AdminCore.readResult(AdminCore.storageKeys.orders, []);
        if (!stored.ok || !Array.isArray(stored.value) || !Array.isArray(orders)) {
          throw new TypeError('am_orders could not be read as an array');
        }
        sourceOrders = orders;
        renderOrders();
      } catch {
        sourceOrders = [];
        byId('adminOrdersCount').textContent = '';
        showState('error', 'admin_orders_error_title', 'admin_orders_error_text', true);
      }
    });
  }

  function init() {
    if (initialized) return;
    initialized = true;
    applyI18n(document);

    byId('adminOrderSearch').addEventListener('input', renderOrders);
    byId('adminOrderStatus').addEventListener('change', renderOrders);
    byId('adminOrdersClear').addEventListener('click', () => {
      byId('adminOrderSearch').value = '';
      byId('adminOrderStatus').value = 'all';
      renderOrders();
      byId('adminOrderSearch').focus();
    });
    byId('adminOrderDialogClose').addEventListener('click', closeOrder);
    byId('adminOrderStatusCancel').addEventListener('click', closeOrder);
    byId('adminOrderStatusForm').addEventListener('submit', saveStatus);
    byId('adminOrderDialog').addEventListener('click', event => {
      if (event.target === byId('adminOrderDialog')) closeOrder();
    });

    loadOrders();
  }

  window.addEventListener('admin:ready', init, { once: true });
  window.addEventListener('am:langchange', () => {
    if (!initialized) return;
    renderOrders();
    if (activeOrderIndex >= 0 && sourceOrders[activeOrderIndex]) {
      renderOrderDetail(sourceOrders[activeOrderIndex]);
      prepareStatusControl(sourceOrders[activeOrderIndex]);
    }
  });
  window.addEventListener('storage', event => {
    if (!initialized || event.key !== 'am_orders') return;
    loadState();
    loadOrders();
  });
})();
