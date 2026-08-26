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

    expect(source).toContain("window.AdminAuth.request('/orders?limit=200')");
    expect(source).toContain("window.AdminAuth.request('/customers?limit=200')");
    expect(source).toContain('payload.orders.map(normalizeOrder)');
    expect(source).toContain('payload.customers.map(normalizeCustomer)');
    expect(source).toMatch(/await refreshLiveData\(\);[\s\S]*dispatchEvent\(new CustomEvent\('admin:ready'/);
  });

  it('persists order status changes through the API and never through legacy Web Storage', async () => {
    const source = await adminSource('admin-orders.js');

    expect(source).toContain('AdminCore.updateOrderStatus(order.publicId, nextStatus.toLowerCase())');
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
    expect(customers).toContain('AdminCore.getCustomers()');
    expect(customers).toContain('deriveCustomers(AdminCore.getOrders())');
    expect(analytics).toContain('AdminCore.getOrders().filter');
  });

  it('keeps stable product and customer identities when aggregating live data', async () => {
    const [customers, analytics] = await Promise.all([
      adminSource('admin-customers.js'),
      adminSource('admin-analytics.js')
    ]);

    expect(customers).toMatch(/function identitySeed\(buyer\)[\s\S]*const email[\s\S]*if \(email\)[\s\S]*const phone/);
    expect(analytics).toContain("const key = String(item.productId ?? item.id ?? item.nameKey ?? item.name ?? 'unknown')");
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
    expect(dashboard).toContain('data.customersError ? uniqueCustomerCount(orders) : customers.length');
    expect(dashboard).toContain("translate('admin_dashboard_customer_order_fallback')");
    expect(core).toContain("admin_dashboard_sales: 'Gross order value'");
    expect(analytics).toContain("admin_sales: 'Gross order value'");
    expect(analytics).toContain("admin_revenue: 'Gross item value'");
  });
});
