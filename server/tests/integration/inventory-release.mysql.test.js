import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { releaseOrderInventory } from '../../src/catalog/inventory.js';
import { runMigrations } from '../../src/db/migrate.js';
import { pool } from '../../src/db/pool.js';
import {
  cleanupIntegrationData,
  uniqueEmail,
  uniqueProduct
} from '../helpers/integration-fixtures.js';

const integrationEnabled = process.env.TEST_USE_DATABASE === 'true';
const databaseDescribe = integrationEnabled ? describe.sequential : describe.skip;
const trackedEmails = new Set();
const trackedProductIds = new Set();
const customerEmail = uniqueEmail('inventory-release', trackedEmails);

let customerId;
let databaseReady = false;

async function createFixture(label, { sourceQuantity, availableQuantity, quantities }) {
  const product = uniqueProduct(label, trackedProductIds, {
    price: '1.00',
    stock_quantity: sourceQuantity
  });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [productResult] = await connection.execute(
      `INSERT INTO catalog_product_refs
        (external_id, last_known_name, last_known_image_url, last_verified_price,
         currency, is_available, stock_quantity, last_verified_at)
       VALUES (?, ?, ?, '1.00', 'MAD', 1, ?, UTC_TIMESTAMP(3))`,
      [product.id, product.name, product.image_url, sourceQuantity]
    );
    const productRefId = productResult.insertId;
    await connection.execute(
      `INSERT INTO catalog_inventory
        (product_ref_id, available_quantity, source_quantity, last_observed_at)
       VALUES (?, ?, ?, UTC_TIMESTAMP(3))`,
      [productRefId, availableQuantity, sourceQuantity]
    );

    const orderIds = [];
    for (const [index, quantity] of quantities.entries()) {
      const [orderResult] = await connection.execute(
        `INSERT INTO orders
          (public_id, order_number, user_id, status, payment_method, payment_status,
           currency, subtotal, delivery_fee, total, cart_version,
           idempotency_digest, request_digest, placed_at)
         VALUES (?, ?, ?, 'confirmed', 'cod', 'pending', 'MAD', ?, 0, ?, 1, ?, ?, UTC_TIMESTAMP(3))`,
        [
          randomUUID(),
          `AM-INV-${index}-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
          customerId,
          quantity.toFixed(2),
          quantity.toFixed(2),
          randomBytes(32),
          randomBytes(32)
        ]
      );
      await connection.execute(
        `INSERT INTO order_inventory_allocations
          (order_id, product_ref_id, quantity, inventory_policy)
         VALUES (?, ?, ?, 'finite')`,
        [orderResult.insertId, productRefId, quantity]
      );
      orderIds.push(orderResult.insertId);
    }
    await connection.commit();
    return { productRefId, orderIds };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function cancelOrder(orderId, beforeRelease) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE orders
          SET status = 'cancelled', cancelled_at = UTC_TIMESTAMP(3)
        WHERE id = ?`,
      [orderId]
    );
    await beforeRelease?.();
    const released = await releaseOrderInventory(connection, orderId);
    await connection.commit();
    return released;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function cancelOrderTransition(orderId, beforeLock) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await beforeLock?.();
    const [orders] = await connection.execute(
      'SELECT status FROM orders WHERE id = ? FOR UPDATE',
      [orderId]
    );
    if (orders[0].status === 'cancelled') {
      await connection.commit();
      return { replayed: true, released: 0 };
    }
    await connection.execute(
      `UPDATE orders
          SET status = 'cancelled', cancelled_at = UTC_TIMESTAMP(3)
        WHERE id = ?`,
      [orderId]
    );
    const released = await releaseOrderInventory(connection, orderId);
    await connection.commit();
    return { replayed: false, released };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function rendezvous(parties) {
  let arrivals = 0;
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  return async () => {
    arrivals += 1;
    if (arrivals === parties) release();
    await ready;
  };
}

databaseDescribe('finite inventory release with MySQL', () => {
  beforeAll(async () => {
    if (!pool) throw new Error('TEST_USE_DATABASE=true did not create a database pool.');
    if (process.env.TEST_SKIP_MIGRATIONS !== 'true') {
      await runMigrations({ database: pool, log: { info() {}, error() {} } });
    }
    const [result] = await pool.execute(
      `INSERT INTO users
        (public_id, email, email_normalized, display_name, password_hash, status)
       VALUES (?, ?, ?, 'Inventory Release Customer', 'integration-test-not-used', 'active')`,
      [randomUUID(), customerEmail, customerEmail]
    );
    customerId = result.insertId;
    databaseReady = true;
  }, 60_000);

  afterAll(async () => {
    try {
      if (databaseReady) {
        await cleanupIntegrationData(pool, trackedEmails, trackedProductIds);
      }
    } finally {
      await pool?.end();
    }
  }, 60_000);

  it('honors a lower upstream source while retaining every active allocation', async () => {
    const fixture = await createFixture('source-drop', {
      sourceQuantity: 10,
      availableQuantity: 0,
      quantities: [6, 4]
    });
    await pool.execute(
      `UPDATE catalog_inventory
          SET source_quantity = 5,
              available_quantity = LEAST(available_quantity, 5)
        WHERE product_ref_id = ?`,
      [fixture.productRefId]
    );

    expect(await cancelOrder(fixture.orderIds[0])).toBe(1);
    const [afterFirstRelease] = await pool.execute(
      `SELECT available_quantity, source_quantity
         FROM catalog_inventory
        WHERE product_ref_id = ?`,
      [fixture.productRefId]
    );
    expect(afterFirstRelease[0]).toMatchObject({
      available_quantity: 1,
      source_quantity: 5
    });

  }, 60_000);

  it('serializes concurrent cancellations without losing or duplicating stock', async () => {
    const fixture = await createFixture('concurrent', {
      sourceQuantity: 10,
      availableQuantity: 0,
      quantities: [6, 4]
    });
    const bothCancelled = rendezvous(2);

    await expect(Promise.all([
      cancelOrder(fixture.orderIds[0], bothCancelled),
      cancelOrder(fixture.orderIds[1], bothCancelled)
    ])).resolves.toEqual(expect.arrayContaining([1, 1]));

    const [inventory] = await pool.execute(
      'SELECT available_quantity, source_quantity FROM catalog_inventory WHERE product_ref_id = ?',
      [fixture.productRefId]
    );
    expect(inventory[0]).toMatchObject({ available_quantity: 10, source_quantity: 10 });
  }, 60_000);

  it('lets concurrent same-order cancellation replay without releasing twice', async () => {
    const fixture = await createFixture('same-order', {
      sourceQuantity: 10,
      availableQuantity: 4,
      quantities: [6]
    });
    const simultaneousStart = rendezvous(2);

    const results = await Promise.all([
      cancelOrderTransition(fixture.orderIds[0], simultaneousStart),
      cancelOrderTransition(fixture.orderIds[0], simultaneousStart)
    ]);
    expect(results).toEqual(expect.arrayContaining([
      { replayed: false, released: 1 },
      { replayed: true, released: 0 }
    ]));

    const [inventory] = await pool.execute(
      'SELECT available_quantity FROM catalog_inventory WHERE product_ref_id = ?',
      [fixture.productRefId]
    );
    expect(inventory[0].available_quantity).toBe(10);
  }, 60_000);
});
