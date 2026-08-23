/**
 * AM MARKET admin analytics.
 * Uses local am_orders when available; otherwise uses explicitly labeled aggregate demo data.
 */
Object.assign(I18N.en, {
  title_admin_analytics: 'Analytics — AM MARKET Admin',
  admin_insights: 'Insights',
  admin_analytics_title: 'Analytics',
  admin_analytics_intro: 'Review local order signals and transparent demo fallbacks.',
  admin_period: 'Period',
  admin_last_7_days: 'Last 7 days',
  admin_last_30_days: 'Last 30 days',
  admin_last_90_days: 'Last 90 days',
  admin_all_time: 'All time',
  admin_analytics_metrics: 'Analytics metrics',
  admin_sales_trend: 'Sales trend',
  admin_sales_trend_sub: 'Order totals grouped across the selected period.',
  admin_orders_by_status: 'Orders by status',
  admin_orders_by_status_sub: 'Distribution of the current local or demo dataset.',
  admin_best_sellers: 'Best sellers',
  admin_best_sellers_sub: 'Ranked by units in the selected order data.',
  admin_loading: 'Loading…',
  admin_local_analytics_source: 'Showing orders stored in this browser. No server analytics exist.',
  admin_demo_analytics_source: 'No local orders match this period, so every value below is clearly labeled demo data.',
  admin_demo_data: 'Demo data',
  admin_local_data: 'Local browser data',
  admin_sales: 'Sales',
  admin_orders_metric: 'Orders',
  admin_average_order_value: 'Average order value',
  admin_top_product: 'Top product',
  admin_no_product: 'No product',
  admin_units: '{n} units',
  admin_revenue: 'Revenue',
  admin_product: 'Product',
  admin_quantity: 'Quantity',
  admin_status_processing: 'Processing',
  admin_status_confirmed: 'Confirmed',
  admin_status_preparing: 'Preparing',
  admin_status_shipping: 'On the way',
  admin_status_delivered: 'Delivered',
  admin_sales_chart_label: 'Sales over time',
  admin_status_chart_label: 'Orders grouped by status',
  admin_demo_groceries: 'Everyday groceries',
  admin_demo_drinks: 'Beverages',
  admin_demo_household: 'Household essentials',
  admin_demo_snacks: 'Snacks',
  admin_metric_source_local: 'Calculated from local orders',
  admin_metric_source_demo: 'Illustrative demo value'
});

Object.assign(I18N.fr, {
  title_admin_analytics: 'Analyses — Administration AM MARKET',
  admin_insights: 'Analyses',
  admin_analytics_title: 'Analyses',
  admin_analytics_intro: 'Consultez les signaux des commandes locales et des valeurs de démonstration transparentes.',
  admin_period: 'Période',
  admin_last_7_days: '7 derniers jours',
  admin_last_30_days: '30 derniers jours',
  admin_last_90_days: '90 derniers jours',
  admin_all_time: 'Toute la période',
  admin_analytics_metrics: 'Indicateurs analytiques',
  admin_sales_trend: 'Évolution des ventes',
  admin_sales_trend_sub: 'Totaux des commandes regroupés sur la période sélectionnée.',
  admin_orders_by_status: 'Commandes par statut',
  admin_orders_by_status_sub: 'Répartition du jeu de données local ou de démonstration.',
  admin_best_sellers: 'Meilleures ventes',
  admin_best_sellers_sub: 'Classement par unités dans les commandes sélectionnées.',
  admin_loading: 'Chargement…',
  admin_local_analytics_source: 'Affichage des commandes stockées dans ce navigateur. Aucune analyse serveur n’existe.',
  admin_demo_analytics_source: 'Aucune commande locale ne correspond à cette période : toutes les valeurs ci-dessous sont clairement des données de démonstration.',
  admin_demo_data: 'Données de démo',
  admin_local_data: 'Données locales du navigateur',
  admin_sales: 'Ventes',
  admin_orders_metric: 'Commandes',
  admin_average_order_value: 'Panier moyen',
  admin_top_product: 'Meilleur produit',
  admin_no_product: 'Aucun produit',
  admin_units: '{n} unités',
  admin_revenue: 'Chiffre',
  admin_product: 'Produit',
  admin_quantity: 'Quantité',
  admin_status_processing: 'En cours',
  admin_status_confirmed: 'Confirmée',
  admin_status_preparing: 'En préparation',
  admin_status_shipping: 'En livraison',
  admin_status_delivered: 'Livrée',
  admin_sales_chart_label: 'Ventes dans le temps',
  admin_status_chart_label: 'Commandes regroupées par statut',
  admin_demo_groceries: 'Courses du quotidien',
  admin_demo_drinks: 'Boissons',
  admin_demo_household: 'Essentiels maison',
  admin_demo_snacks: 'Snacks',
  admin_metric_source_local: 'Calculé depuis les commandes locales',
  admin_metric_source_demo: 'Valeur illustrative de démonstration'
});

let analyticsUsesDemo = false;

function demoAnalyticsOrders() {
  const values = [148, 232, 196, 318, 274, 356, 420];
  const statuses = ['Processing', 'Confirmed', 'Preparing', 'Shipping', 'Delivered', 'Delivered', 'Delivered'];
  const products = [
    ['admin_demo_groceries', 3],
    ['admin_demo_drinks', 2],
    ['admin_demo_household', 1],
    ['admin_demo_snacks', 4]
  ];
  return values.map((total, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (values.length - 1 - index) * 3);
    return {
      id: `demo-${index + 1}`,
      date: date.toISOString(),
      total,
      status: statuses[index],
      items: products.slice(0, 2 + (index % 3)).map(([nameKey, qty], itemIndex) => ({
        id: `demo-product-${itemIndex}`,
        nameKey,
        name: t(nameKey),
        qty: Math.max(1, qty - (index % 2)),
        price: Math.round(total / (4 + itemIndex))
      }))
    };
  });
}

function selectedPeriodOrders(orderList) {
  const period = document.getElementById('analyticsPeriod').value;
  const limit = period === 'all' ? null : Number(period);
  const cutoff = limit ? Date.now() - limit * 86400000 : 0;
  return orderList.filter(order => {
    const timestamp = Date.parse(order?.date);
    return order && Array.isArray(order.items) && Number.isFinite(timestamp) && (!limit || timestamp >= cutoff);
  });
}

function analyticsDataset() {
  const local = (Array.isArray(orders) ? orders : []).filter(order => {
    const timestamp = Date.parse(order?.date);
    return order && Array.isArray(order.items) && Number.isFinite(timestamp);
  });
  analyticsUsesDemo = local.length === 0;
  return selectedPeriodOrders(analyticsUsesDemo ? demoAnalyticsOrders() : local);
}

function statusKey(status) {
  const value = String(status || 'Processing').toLowerCase();
  if (value.includes('deliver') || value.includes('livr')) return 'delivered';
  if (value.includes('cancel') || value.includes('annul')) return 'cancelled';
  if (value.includes('ship') || value.includes('route')) return 'shipping';
  if (value.includes('prepar')) return 'preparing';
  if (value.includes('confirm')) return 'confirmed';
  return 'processing';
}

function productName(item) {
  return item.nameKey ? t(item.nameKey) : String(item.name || t('admin_no_product'));
}

function aggregateProducts(dataset) {
  const products = new Map();
  dataset.forEach(order => {
    (order.items || []).forEach(item => {
      const key = String(item.id ?? item.nameKey ?? item.name ?? 'unknown');
      const current = products.get(key) || { name: productName(item), qty: 0, revenue: 0 };
      const qty = Math.max(0, Number(item.qty) || 0);
      current.name = productName(item);
      current.qty += qty;
      current.revenue += qty * (Number(item.price) || 0);
      products.set(key, current);
    });
  });
  return [...products.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
}

function revenueOrders(dataset) {
  return dataset.filter(order => statusKey(order.status) !== 'cancelled');
}

function renderAnalyticsMetrics(dataset) {
  const revenueDataset = revenueOrders(dataset);
  const sales = revenueDataset.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
  const average = revenueDataset.length ? sales / revenueDataset.length : 0;
  const top = aggregateProducts(revenueDataset)[0];
  const source = t(analyticsUsesDemo ? 'admin_metric_source_demo' : 'admin_metric_source_local');
  const metrics = [
    { icon: 'coins', label: t('admin_sales'), value: formatPrice(sales) },
    { icon: 'bag-shopping', label: t('admin_orders_metric'), value: String(dataset.length) },
    { icon: 'chart-line', label: t('admin_average_order_value'), value: formatPrice(average) },
    { icon: 'basket-shopping', label: t('admin_top_product'), value: top?.name || t('admin_no_product') }
  ];
  document.getElementById('analyticsMetrics').innerHTML = metrics.map(metric => `
    <article class="admin-metric-card">
      <span class="admin-metric-icon"><i class="fa-solid fa-${metric.icon}" aria-hidden="true"></i></span>
      <div><p>${AdminCore.escape(metric.label)}</p><strong>${AdminCore.escape(metric.value)}</strong><small>${AdminCore.escape(source)}</small></div>
    </article>`).join('');
}

function trendPoints(dataset) {
  const sorted = [...dataset].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const buckets = new Map();
  sorted.forEach(order => {
    const key = new Date(order.date).toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) || 0) + (Number(order.total) || 0));
  });
  let points = [...buckets].map(([date, value]) => ({ date, value }));
  if (points.length > 8) {
    const stride = Math.ceil(points.length / 8);
    points = Array.from({ length: Math.ceil(points.length / stride) }, (_, index) => {
      const slice = points.slice(index * stride, (index + 1) * stride);
      return { date: slice[slice.length - 1].date, value: slice.reduce((sum, item) => sum + item.value, 0) };
    });
  }
  return points;
}

function renderSalesChart(dataset) {
  const container = document.getElementById('salesTrendChart');
  const values = trendPoints(dataset);
  if (!values.length) {
    AdminCore.state(container, { type: 'empty', title: t('admin_no_product'), body: '' });
    return;
  }
  const width = 600;
  const height = 190;
  const padding = 18;
  const max = Math.max(...values.map(item => item.value), 1);
  const coords = values.map((item, index) => {
    const x = values.length === 1 ? width / 2 : padding + index * ((width - padding * 2) / (values.length - 1));
    const y = height - padding - (item.value / max) * (height - padding * 2);
    return { ...item, x, y };
  });
  const line = coords.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const area = `${line} L ${coords[coords.length - 1].x.toFixed(1)} ${height - padding} L ${coords[0].x.toFixed(1)} ${height - padding} Z`;
  container.innerHTML = `
    <div class="admin-line-chart">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${AdminCore.escape(t('admin_sales_chart_label'))}">
        <line class="admin-chart-grid" x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}"></line>
        <line class="admin-chart-grid" x1="${padding}" y1="${height / 2}" x2="${width - padding}" y2="${height / 2}"></line>
        <path class="admin-chart-area" d="${area}"></path>
        <path class="admin-chart-line" d="${line}"></path>
        ${coords.map(point => `<circle class="admin-chart-point" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="5"><title>${AdminCore.escape(AdminCore.formatDate(point.date))}: ${AdminCore.escape(formatPrice(point.value))}</title></circle>`).join('')}
      </svg>
      <div class="admin-chart-labels">${coords.map(point => `<span>${AdminCore.escape(AdminCore.formatDate(point.date, { day: 'numeric', month: 'short' }))}</span>`).join('')}</div>
    </div>`;
}

function renderStatusChart(dataset) {
  const counts = { processing: 0, confirmed: 0, preparing: 0, shipping: 0, delivered: 0, cancelled: 0 };
  dataset.forEach(order => { counts[statusKey(order.status)] += 1; });
  const max = Math.max(...Object.values(counts), 1);
  document.getElementById('orderStatusChart').innerHTML = `
    <div class="admin-status-chart" role="img" aria-label="${AdminCore.escape(t('admin_status_chart_label'))}">
      ${Object.entries(counts).map(([key, count]) => `
        <div class="admin-status-bar">
          <span>${t('admin_status_' + key)}</span>
          <span class="admin-status-track" aria-hidden="true"><span class="admin-status-fill" style="width:${(count / max * 100).toFixed(1)}%"></span></span>
          <strong>${count}</strong>
        </div>`).join('')}
    </div>`;
}

function renderBestSellers(dataset) {
  const container = document.getElementById('bestSellersList');
  const products = aggregateProducts(dataset).slice(0, 6);
  container.removeAttribute('aria-busy');
  if (!products.length) {
    AdminCore.state(container, { type: 'empty', title: t('admin_no_product'), body: '' });
    return;
  }
  container.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th scope="col">${t('admin_product')}</th><th scope="col">${t('admin_quantity')}</th><th scope="col">${t('admin_revenue')}</th></tr></thead>
        <tbody>${products.map((product, index) => `
          <tr>
            <td data-label="${AdminCore.escape(t('admin_product'))}"><span class="admin-best-seller"><span class="admin-best-seller-rank">${index + 1}</span><strong>${AdminCore.escape(product.name)}</strong></span></td>
            <td data-label="${AdminCore.escape(t('admin_quantity'))}">${t('admin_units', { n: product.qty })}</td>
            <td data-label="${AdminCore.escape(t('admin_revenue'))}"><strong>${formatPrice(product.revenue)}</strong></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

function renderAnalytics() {
  const dataset = analyticsDataset();
  const note = document.getElementById('analyticsSourceNote');
  note.innerHTML = `<i class="fa-solid fa-${analyticsUsesDemo ? 'flask' : 'laptop'}" aria-hidden="true"></i><span>${t(analyticsUsesDemo ? 'admin_demo_analytics_source' : 'admin_local_analytics_source')}</span><strong>${t(analyticsUsesDemo ? 'admin_demo_data' : 'admin_local_data')}</strong>`;
  renderAnalyticsMetrics(dataset);
  renderSalesChart(revenueOrders(dataset));
  renderStatusChart(dataset);
  renderBestSellers(revenueOrders(dataset));
}

window.addEventListener('admin:ready', () => {
  document.getElementById('analyticsPeriod').addEventListener('change', renderAnalytics);
  requestAnimationFrame(renderAnalytics);
});

window.addEventListener('am:langchange', renderAnalytics);
