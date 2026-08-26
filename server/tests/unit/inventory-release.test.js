import { describe, expect, it } from 'vitest';
import { releaseOrderInventory } from '../../src/catalog/inventory.js';

function releaseConnection({
  allocations = [{ product_ref_id: 17, quantity: 6 }],
  inventory = [{ product_ref_id: 17, available_quantity: 0, source_quantity: 5 }],
  activeQuantity = 4
} = {}) {
  const calls = [];
  return {
    calls,
    async execute(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('FROM order_inventory_allocations allocation')) return [allocations];
      if (sql.includes('FROM catalog_inventory')) return [inventory];
      if (sql.includes('AS active_quantity')) return [[{ active_quantity: activeQuantity }]];
      if (sql.includes('UPDATE catalog_inventory')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected inventory-release SQL: ${sql}`);
    }
  };
}

describe('order inventory release', () => {
  it('locks finite cancelled allocations and caps the release below remaining active reservations', async () => {
    const database = releaseConnection();

    expect(await releaseOrderInventory(database, 91)).toBe(1);

    const allocationRead = database.calls[0];
    expect(allocationRead.sql).toContain("released_order.status = 'cancelled'");
    expect(allocationRead.sql).toContain("allocation.inventory_policy = 'finite'");
    expect(allocationRead.sql).toContain('JOIN catalog_product_refs product');
    expect(allocationRead.sql).toContain('ORDER BY product.external_id');
    expect(allocationRead.sql).toContain('FOR UPDATE');
    expect(allocationRead.values).toEqual([91]);

    const inventoryLock = database.calls[1];
    expect(inventoryLock.sql).toContain('available_quantity, source_quantity');
    expect(inventoryLock.sql).toContain('FOR UPDATE');
    expect(inventoryLock.values).toEqual([17]);

    const activeRead = database.calls[2];
    expect(activeRead.sql).toContain("active_order.status <> 'cancelled'");
    expect(activeRead.sql).toContain("active_allocation.inventory_policy = 'finite'");

    const release = database.calls[3];
    expect(release.sql).toContain('SET available_quantity = ?');
    // Source 5 minus four units still actively allocated leaves one unit,
    // even though the cancelled order originally held six.
    expect(release.values).toEqual([1, 17]);
  });

  it('never increases availability by more than the cancelled allocation', async () => {
    const database = releaseConnection({
      allocations: [{ product_ref_id: 23, quantity: 2 }],
      inventory: [{ product_ref_id: 23, available_quantity: 1, source_quantity: 10 }],
      activeQuantity: 0
    });

    await releaseOrderInventory(database, 92);

    const release = database.calls.find((call) => call.sql.includes('UPDATE catalog_inventory'));
    expect(release.values).toEqual([3, 23]);
  });

  it('does not issue a write when the active ceiling already matches availability', async () => {
    const database = releaseConnection({
      inventory: [{ product_ref_id: 17, available_quantity: 1, source_quantity: 5 }]
    });

    expect(await releaseOrderInventory(database, 93)).toBe(0);
    expect(database.calls.some((call) => call.sql.includes('UPDATE catalog_inventory'))).toBe(false);
  });

  it('ignores orders without a finite cancelled allocation', async () => {
    const database = releaseConnection({ allocations: [] });

    expect(await releaseOrderInventory(database, 94)).toBe(0);
    expect(database.calls).toHaveLength(1);
  });
});
