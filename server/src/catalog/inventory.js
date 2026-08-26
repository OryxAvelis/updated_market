import { conflict } from '../http/errors.js';
import { upsertProductRef } from './refs.js';

function unavailableInventory(productIds) {
  return conflict(
    'CART_CHANGED',
    'Some cart items are unavailable. Review your cart and try again.',
    { productIds }
  );
}

function finiteStock(product) {
  return Number.isSafeInteger(product.stock_quantity) && product.stock_quantity >= 0;
}

// The catalog remains the source of product descriptions and the latest upper
// bound for stock. Once a product is first ordered, catalog_inventory becomes
// this application's monotonic finite-stock allocation ledger: a refresh may
// lower the bound, but cannot silently add back units already allocated by this
// service. Catalog products that expose only an availability flag still get a
// transactional audit row, explicitly marked availability_only; without an
// upstream quantity no service can provide a mathematical oversell guarantee.
export async function reserveOrderInventory(connection, orderId, verifiedItems) {
  const ordered = [...verifiedItems].sort((left, right) =>
    left.product.id.localeCompare(right.product.id)
  );
  const invalid = ordered.filter(({ product, quantity }) =>
    !product.is_available ||
    (product.stock_quantity != null &&
      (!finiteStock(product) || quantity > product.stock_quantity))
  );
  if (invalid.length) throw unavailableInventory(invalid.map(({ product }) => product.id));

  const productRefs = new Map();
  for (const { product, quantity } of ordered) {
    const productRefId = await upsertProductRef(connection, product);
    if (product.stock_quantity == null) {
      await connection.execute(
        `INSERT INTO order_inventory_allocations
          (order_id, product_ref_id, quantity, inventory_policy)
         VALUES (?, ?, ?, 'availability_only')`,
        [orderId, productRefId, quantity]
      );
      productRefs.set(product.id, productRefId);
      continue;
    }
    await connection.execute(
      `INSERT INTO catalog_inventory
        (product_ref_id, available_quantity, source_quantity, last_observed_at)
       VALUES (?, ?, ?, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE
         source_quantity = VALUES(source_quantity),
         available_quantity = LEAST(available_quantity, VALUES(source_quantity)),
         last_observed_at = UTC_TIMESTAMP(3)`,
      [productRefId, product.stock_quantity, product.stock_quantity]
    );
    const [reservation] = await connection.execute(
      `UPDATE catalog_inventory
          SET available_quantity = available_quantity - ?
        WHERE product_ref_id = ?
          AND available_quantity >= ?`,
      [quantity, productRefId, quantity]
    );
    if (reservation.affectedRows !== 1) throw unavailableInventory([product.id]);
    await connection.execute(
      `INSERT INTO order_inventory_allocations
        (order_id, product_ref_id, quantity, inventory_policy)
       VALUES (?, ?, ?, 'finite')`,
      [orderId, productRefId, quantity]
    );
    productRefs.set(product.id, productRefId);
  }
  return productRefs;
}

// Cancellation owns the order row lock and permits exactly one transition to
// `cancelled`, so this release runs at most once for an order. Keep the
// allocation rows as the historical checkout audit and restore only inventory
// that received the finite-stock guarantee.
export async function releaseOrderInventory(connection, orderId) {
  const [allocations] = await connection.execute(
    `SELECT allocation.product_ref_id, allocation.quantity
       FROM order_inventory_allocations allocation
       JOIN orders released_order ON released_order.id = allocation.order_id
       JOIN catalog_product_refs product ON product.id = allocation.product_ref_id
      WHERE allocation.order_id = ?
        AND allocation.inventory_policy = 'finite'
        AND released_order.status = 'cancelled'
      ORDER BY product.external_id, allocation.product_ref_id
      FOR UPDATE`,
    [orderId]
  );

  let affectedRows = 0;
  for (const allocation of allocations) {
    // Serialize releases and new reservations for this product before deriving
    // the active-allocation ceiling. Both cancellation flows reach this helper
    // through locking reads, so a waiter takes its first consistent read only
    // after the preceding inventory owner commits.
    const [inventoryRows] = await connection.execute(
      `SELECT product_ref_id, available_quantity, source_quantity
         FROM catalog_inventory
        WHERE product_ref_id = ?
        FOR UPDATE`,
      [allocation.product_ref_id]
    );
    if (!inventoryRows.length) continue;

    const [activeRows] = await connection.execute(
      `SELECT COALESCE(SUM(active_allocation.quantity), 0) AS active_quantity
         FROM order_inventory_allocations active_allocation
         JOIN orders active_order ON active_order.id = active_allocation.order_id
        WHERE active_allocation.product_ref_id = ?
          AND active_allocation.inventory_policy = 'finite'
          AND active_order.status <> 'cancelled'`,
      [allocation.product_ref_id]
    );
    const availableQuantity = Number(inventoryRows[0].available_quantity);
    const sourceQuantity = Number(inventoryRows[0].source_quantity);
    const activeQuantity = Number(activeRows[0].active_quantity);
    const activeCeiling = Math.max(0, sourceQuantity - activeQuantity);
    const nextAvailableQuantity = Math.min(
      availableQuantity + Number(allocation.quantity),
      activeCeiling
    );
    if (nextAvailableQuantity === availableQuantity) continue;

    const [result] = await connection.execute(
      `UPDATE catalog_inventory
          SET available_quantity = ?
        WHERE product_ref_id = ?`,
      [nextAvailableQuantity, allocation.product_ref_id]
    );
    affectedRows += result.affectedRows;
  }
  return affectedRows;
}
