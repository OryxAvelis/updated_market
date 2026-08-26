import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const serverRoot = fileURLToPath(new URL('../../', import.meta.url));
const projectRoot = path.resolve(serverRoot, '..');

async function adminSource(filename) {
  return readFile(path.join(projectRoot, 'admin', 'js', filename), 'utf8');
}

describe('administrator frontend data boundary', () => {
  it.each([
    'admin-orders.js',
    'admin-inventory.js',
    'admin-settings.js',
    'admin-promotions.js',
    'admin-delivery.js'
  ])('loads %s before the asynchronous admin core is available', async (filename) => {
    const source = await adminSource(filename);
    const registeredEvents = [];
    const context = vm.createContext({
      I18N: { en: {}, fr: {} },
      window: {
        addEventListener(type) {
          registeredEvents.push(type);
        }
      }
    });

    expect(() => vm.runInContext(source, context, { filename })).not.toThrow();
    expect(registeredEvents).toContain('admin:ready');
  });

  it('exposes one authenticated request adapter for non-auth administrator APIs', async () => {
    const source = await adminSource('admin-auth.js');

    expect(source).toContain("const API_BASE_URL = '/api/v1/admin'");
    expect(source).toContain("const AUTH_BASE_URL = '/api/v1/admin/auth'");
    expect(source).toMatch(/window\.AdminAuth\s*=\s*Object\.freeze\([\s\S]*\brequest\b/);
    expect(source).toContain("credentials: 'same-origin'");
    expect(source).toContain("headers['X-CSRF-Token'] = csrfToken");
  });

  it('loads and normalizes database orders and customers before admin pages become ready', async () => {
    const source = await adminSource('admin-core.js');

    expect(source).toContain("fetchAdminListPage('orders', 'orders', normalizeOrder, options)");
    expect(source).toContain("fetchAdminListPage('customers', 'customers', normalizeCustomer, options)");
    expect(source).toContain('const page = await fetchOrdersPage({ limit: 100 })');
    expect(source).toContain('const page = await fetchCustomersPage({ limit: 100 })');
    expect(source).toMatch(/await preloadWorkspace\(\);[\s\S]*await refreshLiveData\(\{ includeOrders: page !== 'customers' \}\);[\s\S]*dispatchEvent\(new CustomEvent\('admin:ready'/);
  });

  it('uses server-side pagination, search, and exact list totals in order and customer workspaces', async () => {
    const [core, orders, customers] = await Promise.all([
      adminSource('admin-core.js'),
      adminSource('admin-orders.js'),
      adminSource('admin-customers.js')
    ]);

    expect(core).toContain("params.set('cursor', normalizedCursor)");
    expect(core).toContain("params.set('search', normalizedSearch)");
    expect(core).toContain("params.set('status', normalizedListStatus)");
    expect(orders).toContain('AdminCore.fetchOrdersPage({');
    expect(orders).toContain('cursor: append ? nextCursor');
    expect(orders).toContain('total: totalOrders');
    expect(orders).toContain("byId('adminOrdersLoadMore')");
    expect(customers).toContain('AdminCore.fetchCustomersPage({');
    expect(customers).toContain('cursor: append ? nextCursor');
    expect(customers).toContain('total: totalCustomers');
    expect(customers).toContain("byId('adminCustomersLoadMore')");
    expect(customers).not.toContain('filteredCustomers()');
  });

  it('persists order status changes through the API and never through legacy Web Storage', async () => {
    const source = await adminSource('admin-orders.js');

    expect(source).toContain('AdminCore.updateOrderStatus(order.publicId, canonicalStatus(nextStatus))');
    expect(source).not.toContain('saveOrders(');
    expect(source).not.toContain("event.key !== 'am_orders'");
    expect(source).not.toContain('AdminCore.readResult(AdminCore.storageKeys.orders');
  });

  it('uses the shared live data adapter for dashboard, customer, and analytics pages', async () => {
    const [dashboard, customers, analytics] = await Promise.all([
      adminSource('admin-dashboard.js'),
      adminSource('admin-customers.js'),
      adminSource('admin-analytics.js')
    ]);

    expect(dashboard).toContain('AdminCore.getOrders()');
    expect(dashboard).not.toContain('AdminCore.read(AdminCore.storageKeys.orders');
    expect(customers).toContain('AdminCore.fetchCustomersPage({');
    expect(customers).toContain("window.AdminAuth.request(`/customers/${encodeURIComponent(customer.id)}/orders?limit=200`)");
    expect(customers).not.toContain('deriveCustomers(AdminCore.getOrders())');
    expect(analytics).toContain('AdminCore.getOrders().filter');
  });

  it('keeps stable product and customer identities when aggregating live data', async () => {
    const [customers, analytics] = await Promise.all([
      adminSource('admin-customers.js'),
      adminSource('admin-analytics.js')
    ]);

    expect(customers).toContain('key: `${customerType}:${id}`');
    expect(customers).toContain('payload?.customerId !== customer.id');
    expect(customers).toContain('payload?.customerType !== customer.customerType');
    expect(analytics).toContain("const key = String(item.productId ?? item.id ?? item.nameKey ?? item.name ?? 'unknown')");
  });

  it('preloads and revision-saves all shared workspace drafts before page initialization', async () => {
    const [core, products, categories, inventory, promotions, delivery, settings] = await Promise.all([
      adminSource('admin-core.js'),
      adminSource('admin-products.js'),
      adminSource('admin-categories.js'),
      adminSource('admin-inventory.js'),
      adminSource('admin-promotions.js'),
      adminSource('admin-delivery.js'),
      adminSource('admin-settings.js')
    ]);

    expect(core).toContain("window.AdminAuth.request('/workspace')");
    expect(core).toContain("resource !== 'delivery'");
    expect(core).toContain('body: {\n        document: cloneDocument(documentValue),\n        expectedRevision');
    expect(core).toContain("error.code = 'ADMIN_WORKSPACE_READ_ONLY'");
    expect(core).toMatch(/if \(!publicPage\) await preloadWorkspace\(\);[\s\S]*admin:ready/);
    expect(products).toContain("await core.saveWorkspace('products', overlay)");
    expect(categories).toContain("await core.saveWorkspace('categories', overlay)");
    expect(inventory).toContain("await AdminCore.saveWorkspace('inventory', nextOverrides)");
    expect(promotions).toContain("await AdminCore.saveWorkspace('promotions', promotionState)");
    expect(delivery).toContain("await AdminCore.saveWorkspace('delivery', deliveryState)");
    expect(settings).toContain("await AdminCore.saveWorkspace('settings', nextSettings)");
  });

  it('preserves customer delivery notes and mirrors server mutation roles', async () => {
    const [core, orders, dashboard, analytics] = await Promise.all([
      adminSource('admin-core.js'),
      adminSource('admin-orders.js'),
      adminSource('admin-dashboard.js'),
      adminSource('admin-analytics.js')
    ]);

    expect(core).toContain('[rawOrder.note, sourceBuyer.note, sourceBuyer.deliveryInstructions]');
    expect(core).toContain('note: buyerNote');
    expect(orders).toContain("['owner', 'manager'].includes");
    expect(orders).toContain('select.disabled = !canUpdateOrders');
    expect(orders).toContain("if (nextStatus === 'Cancelled')");
    expect(orders).toContain('await AdminCore.confirm({');
    expect(orders).toContain("const canonicalStatus = value => normalized(value) === 'processing' ? 'confirmed' : normalized(value)");
    expect(orders).toContain("registeredCustomer ? 'admin_orders_cancel_registered_message' : 'admin_orders_cancel_guest_message'");
    expect(dashboard).toContain('data.customersError ? uniqueCustomerCount(orders) : customers.length');
    expect(dashboard).toContain("translate('admin_dashboard_customer_order_fallback')");
    expect(core).toContain("admin_dashboard_sales: 'Gross order value'");
    expect(analytics).toContain("admin_sales: 'Gross order value'");
    expect(analytics).toContain("admin_revenue: 'Gross item value'");
  });

  it('uses identity-bound customer history and discloses the 200-order cap', async () => {
    const customers = await adminSource('admin-customers.js');

    expect(customers).toContain('/orders?limit=200`');
    expect(customers).toContain('customer.historyHasMore = payload.hasMore === true');
    expect(customers).toContain('const newestBuyer = newestOrder?.buyer');
    expect(customers).toContain('customer.address ||= clean(newestBuyer.address)');
    expect(customers).toContain("admin_customers_history_limited: 'Showing the latest 200 of {count} orders.'");
    expect(customers).not.toMatch(/emailMatches|phoneMatches|identitySeed/);
  });
});
