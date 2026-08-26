/**
 * Customers admin page.
 * Customer accounts come from the authenticated administrator API and are
 * enriched with delivery/history details from the live order response.
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
    admin_customers_search_placeholder: 'Name, email, phone, city or order',
    admin_clear_search: 'Clear search',
    admin_customers_privacy_note: 'Customer details are shown only to authenticated administrators; missing fields remain blank.',
    admin_customers_loading: 'Loading the database customer directory…',
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
    admin_customers_filtered_text: 'Try another name, contact detail, city or order number.',
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
    admin_customers_search_placeholder: 'Nom, e-mail, téléphone, ville ou commande',
    admin_clear_search: 'Effacer la recherche',
    admin_customers_privacy_note: 'Les coordonnées sont visibles uniquement par les administrateurs authentifiés ; les champs manquants restent vides.',
    admin_customers_loading: 'Chargement du répertoire clients de la base…',
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
    admin_customers_filtered_text: 'Essayez un autre nom, contact, ville ou numéro de commande.',
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

  const byId = id => document.getElementById(id);
  const esc = value => AdminCore.escape(value == null ? '' : String(value));
  const clean = value => value == null ? '' : String(value).trim();
  const normalized = value => clean(value).toLocaleLowerCase();

  function hashIdentity(seed) {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `customer-${(hash >>> 0).toString(36)}`;
  }

  function identitySeed(buyer) {
    const email = normalized(buyer?.email);
    if (email) return `email:${email}`;
    const phone = clean(buyer?.phone).replace(/\D/g, '');
    if (phone) return `phone:${phone}`;
    const name = normalized(buyer?.name).replace(/\s+/g, ' ');
    if (name) return `name:${name}`;
    return '';
  }

  function firstActualValue(orderList, field) {
    for (const order of orderList) {
      const value = clean(order?.buyer?.[field]);
      if (value) return value;
    }
    return '';
  }

  function timestamp(value) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : 0;
  }

  function deriveCustomers(orderList) {
    const grouped = new Map();

    orderList.forEach(order => {
      if (!order?.buyer || typeof order.buyer !== 'object') return;
      const seed = identitySeed(order.buyer);
      if (!seed) return;
      if (!grouped.has(seed)) grouped.set(seed, []);
      grouped.get(seed).push(order);
    });

    return [...grouped.entries()].map(([seed, customerOrders]) => {
      const sortedOrders = [...customerOrders].sort((a, b) => timestamp(b?.date) - timestamp(a?.date));
      const knownTotals = sortedOrders
        .map(order => order?.total)
        .filter(value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)))
        .map(Number);
      const searchParts = sortedOrders.flatMap(order => {
        const buyer = order?.buyer || {};
        return [order?.id, buyer.name, buyer.email, buyer.phone, buyer.address, buyer.city, buyer.quartier];
      }).filter(Boolean);

      return {
        key: hashIdentity(seed),
        name: firstActualValue(sortedOrders, 'name'),
        email: firstActualValue(sortedOrders, 'email'),
        phone: firstActualValue(sortedOrders, 'phone'),
        address: firstActualValue(sortedOrders, 'address'),
        city: firstActualValue(sortedOrders, 'city'),
        quartier: firstActualValue(sortedOrders, 'quartier'),
        orders: sortedOrders,
        knownTotal: knownTotals.length ? knownTotals.reduce((sum, value) => sum + value, 0) : null,
        searchText: normalized(searchParts.join(' '))
      };
    }).sort((a, b) => timestamp(b.orders[0]?.date) - timestamp(a.orders[0]?.date));
  }

  function mergeCustomerDirectory(orderCustomers, accountCustomers) {
    const unmatched = new Set(orderCustomers);
    const merged = accountCustomers.map((account) => {
      const seed = identitySeed(account);
      const accountEmail = normalized(account.email);
      const accountPhone = clean(account.phone).replace(/\D/g, '');
      const history = [...unmatched].find(customer => {
        const emailMatches = accountEmail && normalized(customer.email) === accountEmail;
        const phoneMatches = accountPhone && clean(customer.phone).replace(/\D/g, '') === accountPhone;
        return emailMatches || phoneMatches;
      }) || null;
      if (history) unmatched.delete(history);
      const ordersForCustomer = history?.orders || [];
      const searchParts = [
        account.id, account.name, account.displayName, account.email, account.phone,
        ...ordersForCustomer.flatMap(order => [order.id, order.buyer?.address, order.buyer?.city, order.buyer?.quartier])
      ].filter(Boolean);
      return {
        key: `customer-${clean(account.id) || hashIdentity(seed)}`,
        name: clean(account.name || account.displayName || history?.name),
        email: clean(account.email || history?.email),
        phone: clean(account.phone || history?.phone),
        address: history?.address || '',
        city: history?.city || '',
        quartier: history?.quartier || '',
        orders: ordersForCustomer,
        orderCount: Number.isFinite(Number(account.orderCount)) ? Number(account.orderCount) : ordersForCustomer.length,
        knownTotal: Number.isFinite(Number(account.totalSpent)) ? Number(account.totalSpent) : history?.knownTotal ?? null,
        latestOrderAt: account.lastOrderAt || ordersForCustomer[0]?.date || null,
        searchText: normalized(searchParts.join(' '))
      };
    });
    unmatched.forEach(customer => merged.push({
      ...customer,
      orderCount: customer.orders.length,
      latestOrderAt: customer.orders[0]?.date || null
    }));
    return merged.sort((a, b) => timestamp(b.latestOrderAt) - timestamp(a.latestOrderAt));
  }

  function statusLabel(status) {
    const key = STATUS_KEYS[normalized(status || 'Processing')];
    return key ? t(key) : clean(status || t('admin_status_processing'));
  }

  function showState(kind, titleKey, textKey, retry = false) {
    const state = byId('adminCustomersState');
    byId('adminCustomersTableWrap').hidden = true;
    state.hidden = false;
    AdminCore.state(state, {
      type: kind,
      title: t(titleKey),
      body: t(textKey),
      actionLabel: retry ? t('admin_retry') : '',
      onAction: retry ? () => loadCustomers({ refresh: true }) : null
    });
  }

  function filteredCustomers() {
    const query = normalized(byId('adminCustomerSearch')?.value);
    return query ? customers.filter(customer => customer.searchText.includes(query)) : customers;
  }

  function valueOrUnavailable(value) {
    return clean(value) || t('admin_not_available');
  }

  function renderCustomers() {
    const filtered = filteredCustomers();
    const state = byId('adminCustomersState');
    const wrap = byId('adminCustomersTableWrap');
    const body = byId('adminCustomersBody');

    byId('adminCustomersCount').textContent = t('admin_customers_count', {
      shown: filtered.length,
      total: customers.length
    });

    if (!customers.length) {
      showState('empty', 'admin_customers_empty_title', 'admin_customers_empty_text');
      return;
    }
    if (!filtered.length) {
      showState('empty', 'admin_customers_filtered_title', 'admin_customers_filtered_text');
      return;
    }

    body.innerHTML = filtered.map(customer => {
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
    body.querySelectorAll('[data-customer-key]').forEach(button => {
      button.addEventListener('click', () => openCustomer(button.dataset.customerKey));
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
      </section>`;
  }

  function openCustomer(key) {
    const customer = customers.find(item => item.key === key);
    if (!customer) {
      AdminCore.toast(t('admin_customers_missing'), 'error');
      return;
    }
    activeCustomerKey = key;
    renderCustomerDetail(customer);
    const dialog = byId('adminCustomerDialog');
    if (!dialog.open) dialog.showModal();
  }

  function closeCustomer() {
    const dialog = byId('adminCustomerDialog');
    if (dialog.open) dialog.close();
    activeCustomerKey = '';
  }

  async function loadCustomers({ refresh = false } = {}) {
    const state = byId('adminCustomersState');
    byId('adminCustomersTableWrap').hidden = true;
    state.hidden = false;
    AdminCore.state(state, { type: 'loading', title: t('admin_customers_loading') });

    if (refresh) await AdminCore.refreshLiveData({ includeCustomers: true });
    if (AdminCore.dataError('orders') && AdminCore.dataError('customers')) {
      customers = [];
      byId('adminCustomersCount').textContent = '';
      showState('error', 'admin_customers_error_title', 'admin_customers_error_text', true);
      return;
    }
    customers = mergeCustomerDirectory(
      deriveCustomers(AdminCore.getOrders()),
      AdminCore.getCustomers()
    );
    renderCustomers();
  }

  function init() {
    if (initialized) return;
    initialized = true;
    applyI18n(document);

    byId('adminCustomerSearch').addEventListener('input', renderCustomers);
    byId('adminCustomersClear').addEventListener('click', () => {
      byId('adminCustomerSearch').value = '';
      renderCustomers();
      byId('adminCustomerSearch').focus();
    });
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
    if (!initialized || !['orders', 'customers'].includes(event.detail?.resource)) return;
    void loadCustomers();
  });
})();
