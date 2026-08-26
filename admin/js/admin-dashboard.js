/** AM MARKET admin dashboard: database order/customer data + read-only catalog. */
Object.assign(I18N.en, {
  admin_workspace_label: 'Administration workspace',
  admin_dashboard_customer_order_fallback: 'Unique customers from the latest database orders',
  admin_dashboard_customer_unavailable: 'Customer directory temporarily unavailable'
});

Object.assign(I18N.fr, {
  admin_workspace_label: 'Espace d’administration',
  admin_dashboard_customer_order_fallback: 'Clients uniques d’après les dernières commandes en base',
  admin_dashboard_customer_unavailable: 'Annuaire clients temporairement indisponible'
});

(() => {
  'use strict';

  let currentData = null;
  let loadSequence = 0;

  const translate = (key, vars) => typeof t === 'function' ? t(key, vars) : key;
  const escape = value => AdminCore.escape(value);

  function formatCount(value) {
    const locale = typeof getLang === 'function' && getLang() === 'fr' ? 'fr-MA' : 'en-MA';
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(value) || 0);
  }

  function money(value) {
    return typeof formatPrice === 'function' ? formatPrice(Number(value) || 0) : `${Math.round(Number(value) || 0)} DH`;
  }

  function validOrders() {
    return AdminCore.getOrders().filter(order => order && order.id != null && Array.isArray(order.items));
  }

  function productOverlay() {
    const value = AdminCore.read(AdminCore.storageKeys.products, {});
    const source = value && typeof value === 'object' ? value : {};
    return {
      created: Array.isArray(source.created) ? source.created.filter(item => item && item.id != null) : [],
      patches: source.patches && typeof source.patches === 'object' && !Array.isArray(source.patches) ? source.patches : {},
      hiddenIds: new Set((Array.isArray(source.hiddenIds) ? source.hiddenIds : []).map(String))
    };
  }

  function productStatusSummary(catalog) {
    const overlay = productOverlay();
    const counts = { active: Math.max(0, Number(catalog?.total) || 0), draft: 0, archived: 0 };
    overlay.hiddenIds.forEach(id => {
      if (!id.startsWith('local-product-')) counts.active = Math.max(0, counts.active - 1);
    });
    Object.entries(overlay.patches).forEach(([id, patch]) => {
      if (overlay.hiddenIds.has(String(id)) || !patch || typeof patch !== 'object') return;
      const status = ['active', 'draft', 'archived'].includes(patch.status) ? patch.status : 'active';
      if (status !== 'active') {
        counts.active = Math.max(0, counts.active - 1);
        counts[status] += 1;
      }
    });
    overlay.created.forEach(product => {
      if (overlay.hiddenIds.has(String(product.id))) return;
      const status = ['active', 'draft', 'archived'].includes(product.status) ? product.status : 'active';
      counts[status] += 1;
    });
    return { ...counts, total: counts.active + counts.draft + counts.archived, overlay };
  }

  function availabilitySample(catalog, summary) {
    return (Array.isArray(catalog?.products) ? catalog.products : [])
      .filter(product => !summary.overlay.hiddenIds.has(String(product?.id)))
      .map(product => {
        const patch = summary.overlay.patches[String(product?.id)];
        return patch && typeof patch === 'object' ? { ...product, ...patch, id: product.id } : product;
      });
  }

  function orderTotal(order) {
    const direct = Number(order?.total);
    if (Number.isFinite(direct)) return direct;
    return (Number(order?.subtotal) || 0) + (Number(order?.delivery) || 0);
  }

  function uniqueCustomerCount(orders) {
    const identities = new Set();
    orders.forEach(order => {
      const buyer = order?.buyer || order?.customer || {};
      const email = String(buyer.email || '').trim().toLowerCase();
      const phone = String(buyer.phone || '').replace(/\D/g, '');
      const name = String(buyer.name || '').trim().toLowerCase();
      const identity = phone ? `phone:${phone}` : (email ? `email:${email}` : (name ? `name:${name}` : ''));
      if (identity) identities.add(identity);
    });
    return identities.size;
  }

  function normalizeStatus(value) {
    const status = String(value || 'processing').trim().toLowerCase();
    if (/deliver/.test(status)) return 'delivered';
    if (/cancel/.test(status)) return 'cancelled';
    if (/ship|transit|livraison/.test(status)) return 'shipping';
    if (/prepar/.test(status)) return 'preparing';
    if (/confirm/.test(status)) return 'confirmed';
    if (/process|pending|traitement/.test(status)) return 'processing';
    return 'other';
  }

  function statusLabel(status) {
    return translate(`admin_status_${status}`);
  }

  function statusBadgeClass(status) {
    if (status === 'delivered') return 'admin-badge--success';
    if (status === 'cancelled') return 'admin-badge--danger';
    if (status === 'shipping') return 'admin-badge--info';
    return 'admin-badge--warning';
  }

  function statusCounts(orders) {
    return orders.reduce((counts, order) => {
      const status = normalizeStatus(order.status);
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {});
  }

  function monthSeries(orders) {
    const locale = typeof getLang === 'function' && getLang() === 'fr' ? 'fr-MA' : 'en-MA';
    const now = new Date();
    const buckets = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      return {
        key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
        label: new Intl.DateTimeFormat(locale, { month: 'short' }).format(date),
        value: 0
      };
    });
    const byKey = new Map(buckets.map(bucket => [bucket.key, bucket]));
    orders.forEach(order => {
      if (normalizeStatus(order.status) === 'cancelled') return;
      const date = new Date(order.date || order.createdAt || order.created_at);
      if (Number.isNaN(date.getTime())) return;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const bucket = byKey.get(key);
      if (bucket) bucket.value += orderTotal(order);
    });
    return buckets;
  }

  async function fetchCatalog() {
    if (typeof fetchProducts !== 'function' || typeof ensureCategories !== 'function') {
      throw new Error('Catalog helpers unavailable');
    }
    const [first, categoryList] = await Promise.all([
      fetchProducts(1, null, '', '', 100),
      ensureCategories()
    ]);
    const firstResults = Array.isArray(first.results) ? first.results : [];
    const total = Math.max(0, Number(first.count) || firstResults.length);
    // The live API currently caps responses below the requested page_size.
    // Derive pagination from what it actually returned so a bounded preview is
    // never mislabeled as the complete catalog.
    const effectivePageSize = Math.max(1, firstResults.length);
    const pageCount = Math.max(1, Math.ceil(total / effectivePageSize));
    const maxPages = Math.min(pageCount, 30);
    const products = [...firstResults];

    for (let start = 2; start <= maxPages; start += 4) {
      const pages = Array.from({ length: Math.min(4, maxPages - start + 1) }, (_, index) => start + index);
      const results = await Promise.all(pages.map(number => fetchProducts(number, null, '', '', 100)));
      results.forEach(result => products.push(...(result.results || [])));
    }

    return {
      total,
      products,
      categories: Array.isArray(categoryList) ? categoryList : [],
      complete: maxPages >= pageCount && new Set(products.map(product => String(product?.id))).size >= total
    };
  }

  function setLoading() {
    ['adminMetricSales', 'adminMetricOrders', 'adminMetricCustomers', 'adminMetricProducts'].forEach(id => {
      const element = document.getElementById(id);
      if (element) element.textContent = '…';
    });
    ['adminMetricSalesNote', 'adminMetricOrdersNote', 'adminMetricCustomersNote', 'adminMetricProductsNote'].forEach(id => {
      const element = document.getElementById(id);
      if (element) element.textContent = translate('admin_loading');
    });
    AdminCore.state(document.getElementById('adminSalesChart'), { type: 'loading', title: translate('admin_loading'), body: translate('admin_loading_body') });
    AdminCore.state(document.getElementById('adminStatusChart'), { type: 'loading', title: translate('admin_loading'), body: translate('admin_loading_body') });
    AdminCore.state(document.getElementById('adminRecentOrders'), { type: 'loading', title: translate('admin_loading'), body: translate('admin_loading_body') });
    AdminCore.state(document.getElementById('adminCatalogSnapshot'), { type: 'loading', title: translate('admin_loading'), body: translate('admin_loading_body') });
  }

  function sourceNotice(data) {
    const container = document.getElementById('adminDashboardSource');
    if (!container) return;
    if (data.ordersError) {
      container.innerHTML = `
        <div class="admin-inline-notice">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          <div><strong>${escape(translate('admin_error'))}</strong><p>${escape(translate('admin_database_unavailable'))}</p></div>
        </div>`;
      return;
    }
    const titleKey = 'admin_dashboard_local_banner_title';
    const bodyKey = 'admin_dashboard_local_banner';
    container.innerHTML = `
      <div class="admin-inline-notice">
        <i class="fa-solid fa-database" aria-hidden="true"></i>
        <div><strong data-i18n="${titleKey}">${escape(translate(titleKey))}</strong><p data-i18n="${bodyKey}">${escape(translate(bodyKey))}</p></div>
      </div>`;
  }

  function renderMetrics(data) {
    const { orders, customers, catalog, catalogError, ordersError } = data;
    const productSummary = productStatusSummary(catalog);
    const sales = orders
      .filter(order => normalizeStatus(order.status) !== 'cancelled')
      .reduce((sum, order) => sum + orderTotal(order), 0);
    const orderCount = orders.length;
    const customerCount = data.customersError ? uniqueCustomerCount(orders) : customers.length;
    const source = orders.length
      ? translate('admin_dashboard_local_orders')
      : translate('admin_dashboard_no_orders');

    document.getElementById('adminMetricSales').textContent = ordersError ? '—' : money(sales);
    document.getElementById('adminMetricOrders').textContent = ordersError ? '—' : formatCount(orderCount);
    document.getElementById('adminMetricCustomers').textContent = data.customersError && ordersError ? '—' : formatCount(customerCount);
    document.getElementById('adminMetricSalesNote').textContent = ordersError ? translate('admin_database_unavailable') : source;
    document.getElementById('adminMetricOrdersNote').textContent = ordersError ? translate('admin_database_unavailable') : source;
    document.getElementById('adminMetricCustomersNote').textContent = data.customersError
      ? (ordersError || !orders.length
        ? translate('admin_dashboard_customer_unavailable')
        : translate('admin_dashboard_customer_order_fallback'))
      : translate('admin_dashboard_unique_customers');
    document.getElementById('adminMetricProducts').textContent = catalogError ? '—' : formatCount(productSummary.total);
    document.getElementById('adminMetricProductsNote').textContent = catalogError ? translate('admin_not_available') : translate('admin_dashboard_catalog_total');
  }

  function renderSalesChart(data) {
    const container = document.getElementById('adminSalesChart');
    const badge = document.getElementById('adminSalesChartBadge');
    const subtitle = document.getElementById('adminSalesChartSubtitle');
    if (data.ordersError) {
      AdminCore.state(container, { type: 'error', title: translate('admin_error'), body: translate('admin_database_unavailable') });
      badge.textContent = translate('admin_not_available');
      subtitle.textContent = translate('admin_database_unavailable');
      return;
    }
    const series = monthSeries(data.orders);
    const values = series.map(point => point.value);
    const maximum = Math.max(...values, 1);
    const width = 560;
    const height = 190;
    const left = 18;
    const right = 18;
    const top = 14;
    const bottom = 18;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const points = series.map((point, index) => ({
      ...point,
      x: left + (plotWidth * index / Math.max(1, series.length - 1)),
      y: top + plotHeight - ((point.value / maximum) * plotHeight)
    }));
    const linePoints = points.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
    const areaPoints = `${left},${height - bottom} ${linePoints} ${width - right},${height - bottom}`;
    const total = values.reduce((sum, value) => sum + value, 0);
    const sourceLabel = translate('admin_dashboard_local_label');

    badge.textContent = sourceLabel;
    subtitle.textContent = translate('admin_dashboard_six_months');
    container.innerHTML = `
      <svg class="admin-dashboard-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(translate('admin_dashboard_sales_chart_label'))}">
        <line class="admin-dashboard-chart-gridline" x1="${left}" y1="${top}" x2="${width - right}" y2="${top}"></line>
        <line class="admin-dashboard-chart-gridline" x1="${left}" y1="${top + plotHeight / 2}" x2="${width - right}" y2="${top + plotHeight / 2}"></line>
        <line class="admin-dashboard-chart-gridline" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"></line>
        <polygon class="admin-dashboard-chart-area" points="${areaPoints}"></polygon>
        <polyline class="admin-dashboard-chart-line" points="${linePoints}"></polyline>
        ${points.map(point => `<circle class="admin-dashboard-chart-dot" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="5"><title>${escape(`${point.label}: ${money(point.value)}`)}</title></circle>`).join('')}
      </svg>
      <div class="admin-dashboard-chart-axis" aria-hidden="true">${series.map(point => `<span>${escape(point.label)}</span>`).join('')}</div>
      <div class="admin-dashboard-chart-summary"><span>${escape(translate('admin_dashboard_period_total'))}</span><strong>${escape(money(total))}</strong></div>`;
  }

  function renderStatusChart(data) {
    const container = document.getElementById('adminStatusChart');
    const badge = document.getElementById('adminStatusChartBadge');
    const subtitle = document.getElementById('adminStatusChartSubtitle');
    if (data.ordersError) {
      AdminCore.state(container, { type: 'error', title: translate('admin_error'), body: translate('admin_database_unavailable') });
      badge.textContent = translate('admin_not_available');
      subtitle.textContent = translate('admin_database_unavailable');
      return;
    }
    const counts = statusCounts(data.orders);
    const order = ['processing', 'confirmed', 'preparing', 'shipping', 'delivered', 'cancelled', 'other'];
    const entries = order.filter(status => counts[status] > 0).map(status => [status, counts[status]]);
    const maximum = Math.max(...entries.map(([, count]) => count), 1);
    const sourceLabel = translate('admin_dashboard_local_label');
    badge.textContent = sourceLabel;
    subtitle.textContent = data.orders.length
      ? translate('admin_dashboard_local_orders')
      : translate('admin_dashboard_no_orders');
    if (!entries.length) {
      container.removeAttribute('role');
      container.removeAttribute('aria-label');
      AdminCore.state(container, {
        type: 'empty',
        title: translate('admin_dashboard_no_recent_title'),
        body: translate('admin_dashboard_no_recent_body')
      });
      return;
    }
    container.setAttribute('role', 'img');
    container.setAttribute('aria-label', translate('admin_dashboard_status_chart_label'));
    container.innerHTML = entries.map(([status, count]) => `
      <div class="admin-dashboard-status-row">
        <span class="admin-dashboard-status-label">${escape(statusLabel(status))}</span>
        <span class="admin-dashboard-status-track" aria-hidden="true"><span class="admin-dashboard-status-fill" style="--admin-status-width:${Math.max(5, count / maximum * 100).toFixed(1)}%"></span></span>
        <strong class="admin-dashboard-status-count">${formatCount(count)}</strong>
      </div>`).join('');
  }

  function renderRecentOrders(data) {
    const container = document.getElementById('adminRecentOrders');
    if (!container) return;
    if (data.ordersError) {
      AdminCore.state(container, { type: 'error', title: translate('admin_error'), body: translate('admin_database_unavailable') });
      return;
    }
    if (!data.orders.length) {
      AdminCore.state(container, {
        type: 'empty',
        title: translate('admin_dashboard_no_recent_title'),
        body: translate('admin_dashboard_no_recent_body'),
        actionLabel: translate('admin_dashboard_open_storefront'),
        onAction: () => { location.href = '../index.html'; }
      });
      return;
    }

    const orders = [...data.orders]
      .sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0))
      .slice(0, 5);
    container.innerHTML = `
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr>
            <th scope="col">${escape(translate('admin_dashboard_order_id'))}</th>
            <th scope="col">${escape(translate('admin_dashboard_date'))}</th>
            <th scope="col">${escape(translate('admin_dashboard_customer'))}</th>
            <th scope="col">${escape(translate('admin_dashboard_total'))}</th>
            <th scope="col">${escape(translate('admin_dashboard_status'))}</th>
          </tr></thead>
          <tbody>${orders.map(order => {
            const status = normalizeStatus(order.status);
            const buyer = order.buyer || order.customer || {};
            const customer = buyer.name || translate('admin_unknown_customer');
            return `<tr>
              <td data-label="${escape(translate('admin_dashboard_order_id'))}"><strong>${escape(order.id)}</strong></td>
              <td data-label="${escape(translate('admin_dashboard_date'))}">${escape(AdminCore.formatDate(order.date || order.createdAt))}</td>
              <td data-label="${escape(translate('admin_dashboard_customer'))}">${escape(customer)}</td>
              <td data-label="${escape(translate('admin_dashboard_total'))}">${escape(money(orderTotal(order)))}</td>
              <td data-label="${escape(translate('admin_dashboard_status'))}"><span class="admin-badge ${statusBadgeClass(status)}">${escape(statusLabel(status))}</span></td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
  }

  function renderCatalog(data) {
    const container = document.getElementById('adminCatalogSnapshot');
    if (!container) return;
    if (data.catalogError) {
      AdminCore.state(container, {
        type: 'error',
        title: translate('admin_dashboard_catalog_error_title'),
        body: translate('admin_dashboard_catalog_error_body'),
        actionLabel: translate('admin_retry'),
        onAction: () => loadDashboard({ announce: true })
      });
      return;
    }

    const summary = productStatusSummary(data.catalog);
    const sample = availabilitySample(data.catalog, summary);
    const available = sample.filter(product => product.is_available !== false).length;
    const unavailable = sample.length - available;
    const coverage = data.catalog.complete
      ? translate('admin_dashboard_full_catalog')
      : translate('admin_dashboard_loaded_sample', { n: formatCount(data.catalog.products.length) });
    container.innerHTML = `
      <div class="admin-dashboard-catalog-list">
        <p class="admin-card-subtitle mb-0"><strong>${escape(translate('admin_dashboard_product_status'))}</strong></p>
        <div class="admin-dashboard-catalog-row"><span><i class="fa-solid fa-circle-play" aria-hidden="true"></i>${escape(translate('admin_product_status_active'))}</span><strong>${formatCount(summary.active)}</strong></div>
        <div class="admin-dashboard-catalog-row"><span><i class="fa-solid fa-file-pen" aria-hidden="true"></i>${escape(translate('admin_product_status_draft'))}</span><strong>${formatCount(summary.draft)}</strong></div>
        <div class="admin-dashboard-catalog-row"><span><i class="fa-solid fa-box-archive" aria-hidden="true"></i>${escape(translate('admin_product_status_archived'))}</span><strong>${formatCount(summary.archived)}</strong></div>
        <p class="admin-card-subtitle mb-0"><strong>${escape(translate('admin_dashboard_catalog'))}</strong></p>
        <div class="admin-dashboard-catalog-row"><span><i class="fa-solid fa-circle-check" aria-hidden="true"></i>${escape(translate('admin_dashboard_available'))}</span><strong>${formatCount(available)}</strong></div>
        <div class="admin-dashboard-catalog-row"><span><i class="fa-solid fa-circle-xmark" aria-hidden="true"></i>${escape(translate('admin_dashboard_unavailable'))}</span><strong>${formatCount(unavailable)}</strong></div>
        <div class="admin-dashboard-catalog-row"><span><i class="fa-solid fa-shapes" aria-hidden="true"></i>${escape(translate('admin_dashboard_categories'))}</span><strong>${formatCount(data.catalog.categories.length)}</strong></div>
        <p class="admin-card-subtitle mb-0">${escape(coverage)}</p>
      </div>`;
  }

  function render(data) {
    sourceNotice(data);
    renderMetrics(data);
    renderSalesChart(data);
    renderStatusChart(data);
    renderRecentOrders(data);
    renderCatalog(data);
  }

  async function loadDashboard({ announce = false } = {}) {
    const sequence = ++loadSequence;
    const refresh = document.getElementById('adminDashboardRefresh');
    if (refresh) AdminCore.setBusy(refresh, true, translate('admin_dashboard_refreshing'));
    setLoading();
    if (announce) await AdminCore.refreshLiveData({ includeCustomers: true });
    const orders = validOrders();
    const customers = AdminCore.getCustomers();
    let catalog = null;
    let catalogError = null;
    try {
      catalog = await fetchCatalog();
    } catch (error) {
      catalogError = error;
      catalog = { total: 0, products: [], categories: [], complete: false };
    }
    if (sequence !== loadSequence) return;
    currentData = {
      orders,
      customers,
      catalog,
      catalogError,
      ordersError: AdminCore.dataError('orders'),
      customersError: AdminCore.dataError('customers')
    };
    render(currentData);
    if (refresh) AdminCore.setBusy(refresh, false);
    if (announce) {
      const partialFailure = Boolean(catalogError || currentData.ordersError || currentData.customersError);
      AdminCore.toast(translate('admin_dashboard_refreshed'), partialFailure ? 'warning' : 'success');
    }
  }

  window.addEventListener('admin:ready', () => {
    document.getElementById('adminDashboardRefresh')?.addEventListener('click', () => loadDashboard({ announce: true }));
    loadDashboard();
  });

  window.addEventListener('am:langchange', () => {
    if (currentData) render(currentData);
    else setLoading();
  });

})();
