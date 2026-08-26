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
  const [result] = await connection.execute(
    `UPDATE catalog_inventory inventory
       JOIN order_inventory_allocations allocation
         ON allocation.product_ref_id = inventory.product_ref_id
        AND allocation.order_id = ?
        AND allocation.inventory_policy = 'finite'
        SET inventory.available_quantity = LEAST(
          inventory.source_quantity,
          inventory.available_quantity + allocation.quantity
        )`,
    [orderId]
  );
  return result.affectedRows;
}
