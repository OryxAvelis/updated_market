/**
 * Customers admin page.
 * Registered accounts and per-order guest identities come from the authenticated
 * directory. Order history is loaded from the exact identity-bound endpoint.
 */
(() => {
  'use strict';

  Object.assign(I18N.en, {
    title_admin_customers: 'Customers — AM MARKET Admin',
    admin_customers_kicker: 'Database customer directory',
    admin_customers_title: 'Customers',
    admin_customers_intro: 'Review registered customer accounts and guest order contacts with their database order history.',
    admin_local_only: 'Live database',
    admin_customers_search_label: 'Search customers',
    admin_customers_search_placeholder: 'Name, email, phone or city',
    admin_clear_search: 'Clear search',
    admin_customers_privacy_note: 'Customer details are shown only to authenticated administrators; missing fields remain blank.',
    admin_customers_loading: 'Loading the database customer directory…',
    admin_customers_load_more: 'Load more customers',
    admin_customers_loading_more: 'Loading…',
    admin_customers_table_caption: 'Customer accounts and guest order contacts from the AM MARKET database',
    admin_customers_col_customer: 'Customer',
    admin_customers_col_contact: 'Contact',
    admin_customers_col_location: 'Location',
    admin_customers_col_orders: 'Orders',
    admin_customers_col_total: 'Order total',
    admin_customers_col_latest: 'Latest order',
    admin_actions: 'Actions',
    admin_customers_detail_kicker: 'Customer detail',
    admin_close: 'Close',
    admin_customers_count: '{shown} of {total} customers',
    admin_customers_empty_title: 'No customer records yet',
    admin_customers_empty_text: 'No registered customer records are available yet.',
    admin_customers_filtered_title: 'No matching customers',
    admin_customers_filtered_text: 'Try another name, contact detail, or city.',
    admin_customers_error_title: 'Customers could not be loaded',
    admin_customers_error_text: 'The authenticated customer service is unavailable. Try again.',
    admin_retry: 'Retry',
    admin_view_details: 'View details',
    admin_customers_name_missing: 'Name not recorded',
    admin_not_available: 'Not available',
    admin_customers_order_count: '{count} order(s)',
    admin_customers_profile_title: 'Customer profile',
    admin_customers_name: 'Name',
    admin_customers_email: 'Email',
    admin_customers_phone: 'Phone',
    admin_customers_address: 'Address',
    admin_customers_city: 'City',
    admin_customers_district: 'District',
    admin_customers_history_title: 'Database order history',
    admin_customers_order: 'Order',
    admin_customers_status: 'Status',
    admin_customers_total: 'Total',
    admin_customers_date: 'Date',
    admin_customers_no_history: 'No order history is available.',
    admin_customers_history_loading: 'Loading this customer’s exact order history…',
    admin_customers_history_error: 'This customer’s order history could not be loaded. Try again.',
    admin_customers_history_limited: 'Showing the latest 200 of {count} orders.',
    admin_status_processing: 'Processing',
    admin_status_confirmed: 'Confirmed',
    admin_status_preparing: 'Preparing',
    admin_status_shipping: 'Shipping',
    admin_status_delivered: 'Delivered',
    admin_status_cancelled: 'Cancelled',
    admin_customers_missing: 'This customer record is no longer available.'
  });

  Object.assign(I18N.fr, {
    title_admin_customers: 'Clients — Administration AM MARKET',
    admin_customers_kicker: 'Répertoire clients de la base',
    admin_customers_title: 'Clients',
    admin_customers_intro: 'Consultez les comptes clients et les contacts des commandes invitées avec leur historique en base.',
    admin_local_only: 'Base en direct',
    admin_customers_search_label: 'Rechercher des clients',
    admin_customers_search_placeholder: 'Nom, e-mail, téléphone ou ville',
    admin_clear_search: 'Effacer la recherche',
    admin_customers_privacy_note: 'Les coordonnées sont visibles uniquement par les administrateurs authentifiés ; les champs manquants restent vides.',
    admin_customers_loading: 'Chargement du répertoire clients de la base…',
    admin_customers_load_more: 'Charger plus de clients',
    admin_customers_loading_more: 'Chargement…',
    admin_customers_table_caption: 'Comptes clients et contacts invités de la base AM MARKET',
    admin_customers_col_customer: 'Client',
    admin_customers_col_contact: 'Contact',
    admin_customers_col_location: 'Localisation',
    admin_customers_col_orders: 'Commandes',
    admin_customers_col_total: 'Total des commandes',
    admin_customers_col_latest: 'Dernière commande',
    admin_actions: 'Actions',
    admin_customers_detail_kicker: 'Détail du client',
    admin_close: 'Fermer',
    admin_customers_count: '{shown} client(s) sur {total}',
    admin_customers_empty_title: 'Aucune fiche client',
    admin_customers_empty_text: 'Aucune fiche client enregistrée n’est disponible.',
    admin_customers_filtered_title: 'Aucun client correspondant',
    admin_customers_filtered_text: 'Essayez un autre nom, contact ou ville.',
    admin_customers_error_title: 'Impossible de charger les clients',
    admin_customers_error_text: 'Le service clients authentifié est indisponible. Réessayez.',
    admin_retry: 'Réessayer',
    admin_view_details: 'Voir le détail',
    admin_customers_name_missing: 'Nom non renseigné',
    admin_not_available: 'Non disponible',
    admin_customers_order_count: '{count} commande(s)',
    admin_customers_profile_title: 'Profil client',
    admin_customers_name: 'Nom',
    admin_customers_email: 'E-mail',
    admin_customers_phone: 'Téléphone',
    admin_customers_address: 'Adresse',
    admin_customers_city: 'Ville',
    admin_customers_district: 'Quartier',
    admin_customers_history_title: 'Historique des commandes en base',
    admin_customers_order: 'Commande',
    admin_customers_status: 'État',
    admin_customers_total: 'Total',
    admin_customers_date: 'Date',
    admin_customers_no_history: 'Aucun historique de commande n’est disponible.',
    admin_customers_history_loading: 'Chargement de l’historique exact de ce client…',
    admin_customers_history_error: 'Impossible de charger l’historique de ce client. Réessayez.',
    admin_customers_history_limited: 'Affichage des 200 commandes les plus récentes sur {count}.',
    admin_status_processing: 'En traitement',
    admin_status_confirmed: 'Confirmée',
    admin_status_preparing: 'En préparation',
    admin_status_shipping: 'En livraison',
    admin_status_delivered: 'Livrée',
    admin_status_cancelled: 'Annulée',
    admin_customers_missing: 'Cette fiche client n’est plus disponible.'
  });

  const STATUS_KEYS = {
    processing: 'admin_status_processing',
    confirmed: 'admin_status_confirmed',
    preparing: 'admin_status_preparing',
    shipping: 'admin_status_shipping',
    delivered: 'admin_status_delivered',
    cancelled: 'admin_status_cancelled'
  };

  let customers = [];
  let activeCustomerKey = '';
  let initialized = false;
  let nextCursor = null;
  let hasMore = false;
  let totalCustomers = 0;
  let requestGeneration = 0;
  let loadingMore = false;
  let searchTimer = null;

  const PAGE_SIZE = 50;

  const byId = id => document.getElementById(id);
  const esc = value => AdminCore.escape(value == null ? '' : String(value));
  const clean = value => value == null ? '' : String(value).trim();
  const normalized = value => clean(value).toLocaleLowerCase();

  function timestamp(value) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : 0;
  }

  function normalizeDirectory(account) {
    const id = clean(account?.id || account?.publicId);
    const customerType = clean(account?.customerType) === 'guest' ? 'guest' : 'registered';
    const name = clean(account?.name || account?.displayName);
    const email = clean(account?.email);
    const phone = clean(account?.phone);
    const address = clean(account?.address);
    const city = clean(account?.city);
    const quartier = clean(account?.quartier || account?.district);
    const orderCount = Math.max(0, Math.floor(Number(account?.orderCount) || 0));
    const knownTotal = Number.isFinite(Number(account?.totalSpent)) ? Number(account.totalSpent) : null;
    const latestOrderAt = account?.lastOrderAt || null;
    const searchText = normalized([
      id,
      account?.guestOrderNumber,
      customerType,
      name,
      email,
      phone,
      address,
      city,
      quartier
    ].filter(Boolean).join(' '));
    return {
      key: `${customerType}:${id}`,
      id,
      customerType,
      name,
      email,
      phone,
      address,
      city,
      quartier,
      orders: [],
      orderCount,
      knownTotal,
      latestOrderAt,
      searchText
    };
  }

  function statusLabel(status) {
    const key = STATUS_KEYS[normalized(status || 'Processing')];
    return key ? t(key) : clean(status || t('admin_status_processing'));
  }

  function showState(kind, titleKey, textKey, retry = false) {
    const state = byId('adminCustomersState');
    byId('adminCustomersTableWrap').hidden = true;
    byId('adminCustomersLoadMore').hidden = true;
    state.hidden = false;
    AdminCore.state(state, {
      type: kind,
      title: t(titleKey),
      body: t(textKey),
      actionLabel: retry ? t('admin_retry') : '',
      onAction: retry ? () => loadCustomers() : null
    });
  }

  function valueOrUnavailable(value) {
    return clean(value) || t('admin_not_available');
  }

  function renderCustomers() {
    const state = byId('adminCustomersState');
    const wrap = byId('adminCustomersTableWrap');
    const body = byId('adminCustomersBody');
    const loadMore = byId('adminCustomersLoadMore');

    byId('adminCustomersCount').textContent = t('admin_customers_count', {
      shown: customers.length,
      total: totalCustomers
    });

    if (!customers.length) {
      const searching = Boolean(normalized(byId('adminCustomerSearch')?.value));
      showState(
        'empty',
        searching ? 'admin_customers_filtered_title' : 'admin_customers_empty_title',
        searching ? 'admin_customers_filtered_text' : 'admin_customers_empty_text'
      );
      return;
    }

    body.innerHTML = customers.map(customer => {
      const contact = [customer.email, customer.phone].filter(Boolean);
      const location = [customer.quartier, customer.city].filter(Boolean).join(', ');
      const latest = customer.orders[0];
      return `<tr>
        <td data-label="${esc(t('admin_customers_col_customer'))}">
          <span class="admin-customer-name">${esc(customer.name || t('admin_customers_name_missing'))}</span>
        </td>
        <td data-label="${esc(t('admin_customers_col_contact'))}" class="admin-customer-contact">
          ${contact.length ? contact.map(value => `<span>${esc(value)}</span>`).join('') : `<span>${esc(t('admin_not_available'))}</span>`}
        </td>
        <td data-label="${esc(t('admin_customers_col_location'))}" class="admin-customer-location">
          <span>${esc(location || t('admin_not_available'))}</span>
          ${customer.address ? `<span>${esc(customer.address)}</span>` : ''}
        </td>
        <td data-label="${esc(t('admin_customers_col_orders'))}">${esc(t('admin_customers_order_count', { count: customer.orderCount ?? customer.orders.length }))}</td>
        <td data-label="${esc(t('admin_customers_col_total'))}"><strong>${customer.knownTotal == null ? esc(t('admin_not_available')) : esc(formatPrice(customer.knownTotal))}</strong></td>
        <td data-label="${esc(t('admin_customers_col_latest'))}">${esc(AdminCore.formatDate(customer.latestOrderAt || latest?.date))}</td>
        <td data-label="${esc(t('admin_actions'))}">
          <button class="admin-button admin-button--secondary admin-customer-view" type="button" data-customer-key="${esc(customer.key)}">
            <i class="fa-regular fa-eye" aria-hidden="true"></i> ${esc(t('admin_view_details'))}
          </button>
        </td>
      </tr>`;
    }).join('');

    state.hidden = true;
    wrap.hidden = false;
    loadMore.hidden = !hasMore;
    body.querySelectorAll('[data-customer-key]').forEach(button => {
      button.addEventListener('click', () => { void openCustomer(button.dataset.customerKey); });
    });
  }

  function profileField(labelKey, value) {
    return `<div><dt>${esc(t(labelKey))}</dt><dd>${esc(valueOrUnavailable(value))}</dd></div>`;
  }

  function renderCustomerDetail(customer) {
    byId('adminCustomerDialogTitle').textContent = customer.name || t('admin_customers_name_missing');
    byId('adminCustomerDetail').innerHTML = `
      <section aria-labelledby="adminCustomerProfileHeading">
        <h3 id="adminCustomerProfileHeading" class="admin-customer-history-title">${esc(t('admin_customers_profile_title'))}</h3>
        <dl class="admin-customer-profile">
          ${profileField('admin_customers_name', customer.name)}
          ${profileField('admin_customers_email', customer.email)}
          ${profileField('admin_customers_phone', customer.phone)}
          ${profileField('admin_customers_address', customer.address)}
          ${profileField('admin_customers_city', customer.city)}
          ${profileField('admin_customers_district', customer.quartier)}
        </dl>
      </section>
      <section aria-labelledby="adminCustomerHistoryHeading">
        <h3 id="adminCustomerHistoryHeading" class="admin-customer-history-title">${esc(t('admin_customers_history_title'))}</h3>
        ${customer.orders.length ? `<ul class="admin-customer-order-list">${customer.orders.map(order => `
          <li>
            <div><strong>${esc(t('admin_customers_order'))} #${esc(order?.id)}</strong><small>${esc(AdminCore.formatDate(order?.date))}</small></div>
            <span>${esc(statusLabel(order?.status))}</span>
            <strong>${order?.total !== null && order?.total !== undefined && order?.total !== '' && Number.isFinite(Number(order.total)) ? esc(formatPrice(order.total)) : esc(t('admin_not_available'))}</strong>
          </li>`).join('')}</ul>` : `<p>${esc(t('admin_customers_no_history'))}</p>`}
        ${customer.historyHasMore ? `<p>${esc(t('admin_customers_history_limited', { count: customer.orderCount }))}</p>` : ''}
      </section>`;
  }

  async function openCustomer(key) {
    const customer = customers.find(item => item.key === key);
    if (!customer) {
      AdminCore.toast(t('admin_customers_missing'), 'error');
      return;
    }
    activeCustomerKey = key;
    const dialog = byId('adminCustomerDialog');
    if (!dialog.open) dialog.showModal();
    AdminCore.state(byId('adminCustomerDetail'), {
      type: 'loading',
      title: t('admin_customers_history_loading')
    });
    try {
      const payload = await window.AdminAuth.request(`/customers/${encodeURIComponent(customer.id)}/orders?limit=200`);
      if (payload?.customerId !== customer.id
        || payload?.customerType !== customer.customerType
        || !Array.isArray(payload?.orders)) {
        throw new TypeError('Invalid customer history response');
      }
      customer.orders = payload.orders.map(order => AdminCore.normalizeOrder(order));
      customer.historyHasMore = payload.hasMore === true;
      const newestOrder = customer.orders.reduce((newest, order) => (
        !newest || timestamp(order?.date) > timestamp(newest?.date) ? order : newest
      ), null);
      const newestBuyer = newestOrder?.buyer && typeof newestOrder.buyer === 'object'
        ? newestOrder.buyer
        : {};
      customer.address ||= clean(newestBuyer.address);
      customer.city ||= clean(newestBuyer.city);
      customer.quartier ||= clean(newestBuyer.quartier || newestBuyer.district);
      customer.searchText = normalized([
        customer.searchText,
        customer.address,
        customer.city,
        customer.quartier,
        ...customer.orders.map(order => order.id)
      ].join(' '));
      if (activeCustomerKey === key) {
        renderCustomers();
        renderCustomerDetail(customer);
      }
    } catch (error) {
      if (activeCustomerKey !== key) return;
      AdminCore.state(byId('adminCustomerDetail'), {
        type: 'error',
        title: t('admin_customers_history_error'),
        actionLabel: t('admin_retry'),
        onAction: () => { void openCustomer(key); }
      });
    }
  }

  function closeCustomer() {
    const dialog = byId('adminCustomerDialog');
    if (dialog.open) dialog.close();
    activeCustomerKey = '';
  }

  function appendUniqueCustomers(nextCustomers) {
    const merged = new Map(customers.map(customer => [customer.key, customer]));
    nextCustomers.forEach(customer => {
      const existing = merged.get(customer.key);
      merged.set(customer.key, existing ? {
        ...existing,
        ...customer,
        address: customer.address || existing.address,
        city: customer.city || existing.city,
        quartier: customer.quartier || existing.quartier,
        orders: existing.orders,
        historyHasMore: existing.historyHasMore
      } : customer);
    });
    return [...merged.values()];
  }

  async function loadCustomers({ append = false } = {}) {
    if (append && (!hasMore || !nextCursor || loadingMore)) return;
    const generation = append ? requestGeneration : ++requestGeneration;
    const state = byId('adminCustomersState');
    const loadMore = byId('adminCustomersLoadMore');
    if (append) {
      loadingMore = true;
      AdminCore.setBusy(loadMore, true, t('admin_customers_loading_more'));
    } else {
      loadingMore = false;
      AdminCore.setBusy(loadMore, false);
      byId('adminCustomersTableWrap').hidden = true;
      loadMore.hidden = true;
      state.hidden = false;
      AdminCore.state(state, { type: 'loading', title: t('admin_customers_loading') });
    }

    try {
      const page = await AdminCore.fetchCustomersPage({
        limit: PAGE_SIZE,
        cursor: append ? nextCursor : '',
        search: String(byId('adminCustomerSearch')?.value || '').trim()
      });
      if (generation !== requestGeneration) return;
      const pageCustomers = page.customers.map(normalizeDirectory).filter(customer => customer.id);
      customers = append ? appendUniqueCustomers(pageCustomers) : pageCustomers;
      nextCursor = page.nextCursor;
      hasMore = page.hasMore;
      totalCustomers = page.total;
      renderCustomers();
    } catch (error) {
      if (generation !== requestGeneration) return;
      if (append) {
        AdminCore.toast(t('admin_customers_error_text'), 'error');
        renderCustomers();
      } else {
        customers = [];
        nextCursor = null;
        hasMore = false;
        totalCustomers = 0;
        byId('adminCustomersCount').textContent = '';
        showState('error', 'admin_customers_error_title', 'admin_customers_error_text', true);
      }
    } finally {
      if (append && generation === requestGeneration) {
        loadingMore = false;
        AdminCore.setBusy(loadMore, false);
        loadMore.hidden = !hasMore;
      }
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;
    applyI18n(document);

    byId('adminCustomerSearch').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { void loadCustomers(); }, 300);
    });
    byId('adminCustomersClear').addEventListener('click', () => {
      clearTimeout(searchTimer);
      byId('adminCustomerSearch').value = '';
      void loadCustomers();
      byId('adminCustomerSearch').focus();
    });
    byId('adminCustomersLoadMore').addEventListener('click', () => { void loadCustomers({ append: true }); });
    byId('adminCustomerDialogClose').addEventListener('click', closeCustomer);
    byId('adminCustomerDialogDone').addEventListener('click', closeCustomer);
    byId('adminCustomerDialog').addEventListener('click', event => {
      if (event.target === byId('adminCustomerDialog')) closeCustomer();
    });

    void loadCustomers();
  }

  window.addEventListener('admin:ready', init, { once: true });
  window.addEventListener('am:langchange', () => {
    if (!initialized) return;
    renderCustomers();
    const active = customers.find(customer => customer.key === activeCustomerKey);
    if (active) renderCustomerDetail(active);
  });
  window.addEventListener('admin:datachange', event => {
    if (!initialized || event.detail?.resource !== 'customers') return;
    void loadCustomers();
  });
})();
