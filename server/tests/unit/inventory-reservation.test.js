import { describe, expect, it } from 'vitest';
import { reserveOrderInventory } from '../../src/catalog/inventory.js';

function product(stockQuantity) {
  return {
    id: 'inventory-product',
    name: 'Inventory product',
    image_url: '',
    brand_name: 'AM Test',
    price: '10.00',
    is_available: true,
    stock_quantity: stockQuantity
  };
}

function connection({ reservationAffectedRows = 1 } = {}) {
  const calls = [];
  return {
    calls,
    async execute(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('INSERT INTO catalog_product_refs')) return [{ insertId: 7 }];
      if (sql.includes('UPDATE catalog_inventory')) return [{ affectedRows: reservationAffectedRows }];
      return [{ affectedRows: 1, insertId: 0 }];
    }
  };
}

describe('order inventory reservation', () => {
  it('atomically decrements finite inventory and records the strong policy', async () => {
    const database = connection();
    const refs = await reserveOrderInventory(database, 91, [{ product: product(5), quantity: 2 }]);

    expect(refs.get('inventory-product')).toBe(7);
    expect(database.calls.some((call) => call.sql.includes('INSERT INTO catalog_inventory'))).toBe(true);
    const decrement = database.calls.find((call) => call.sql.includes('UPDATE catalog_inventory'));
    expect(decrement.values).toEqual([2, 7, 2]);
    const allocation = database.calls.find((call) => call.sql.includes('order_inventory_allocations'));
    expect(allocation.sql).toContain("'finite'");
    expect(allocation.values).toEqual([91, 7, 2]);
  });

  it('records availability-only allocations when the upstream omits quantity', async () => {
    const database = connection();
    const refs = await reserveOrderInventory(database, 92, [{ product: product(null), quantity: 3 }]);

    expect(refs.get('inventory-product')).toBe(7);
    expect(database.calls.some((call) => call.sql.includes('INSERT INTO catalog_inventory'))).toBe(false);
    expect(database.calls.some((call) => call.sql.includes('UPDATE catalog_inventory'))).toBe(false);
    const allocation = database.calls.find((call) => call.sql.includes('order_inventory_allocations'));
    expect(allocation.sql).toContain("'availability_only'");
    expect(allocation.values).toEqual([92, 7, 3]);
  });

  it('fails closed when a finite atomic decrement cannot reserve every unit', async () => {
    const database = connection({ reservationAffectedRows: 0 });
    await expect(reserveOrderInventory(database, 93, [{ product: product(2), quantity: 2 }]))
      .rejects.toMatchObject({ status: 409, code: 'CART_CHANGED' });
    expect(database.calls.some((call) => call.sql.includes('order_inventory_allocations'))).toBe(false);
  });
});
