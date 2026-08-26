import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { runMigrations } from '../../src/db/migrate.js';
import { pool } from '../../src/db/pool.js';
import { hashPassword } from '../../src/security/passwords.js';
import {
  cleanupIntegrationData,
  createMockCatalog,
  createMockMailer,
  uniqueEmail,
  uniqueProduct
} from '../helpers/integration-fixtures.js';

const integrationEnabled = process.env.TEST_USE_DATABASE === 'true';
const databaseDescribe = integrationEnabled ? describe.sequential : describe.skip;
const trackedEmails = new Set();
const trackedProductIds = new Set();
const trackedReturnIds = new Set();
const trackedGuestOrderIds = new Set();
const ownerEmail = uniqueEmail('admin-operations-owner', trackedEmails);
const supportEmail = uniqueEmail('admin-operations-support', trackedEmails);
const customerEmail = uniqueEmail('admin-operations-customer', trackedEmails);
const adminPassword = `AM-admin-${randomBytes(24).toString('base64url')}`;
const customerPassword = `AM-customer-${randomBytes(24).toString('base64url')}`;
const product = uniqueProduct('admin-operations', trackedProductIds, {
  price: '12.00',
  stock_quantity: 10
});

let customerId;
let customerPublicId;
let productRefId;
let primaryOrder;
let cancellableOrder;
let primaryOrderItem;
let returnRequest;
let guestOrder;

async function insertOrder(connection, {
  quantity,
  suffix,
  allocateInventory = true,
  userId = customerId,
  recipientName = 'Admin Operations Customer',
  buyerEmail = customerEmail
}) {
  const publicId = randomUUID();
  const orderNumber = `AM-ADMIN-${suffix}-${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
  const subtotal = Number(product.price) * quantity;
  const idempotencyDigest = randomBytes(32);
  const guestAccessDigest = userId === null ? randomBytes(32) : null;
  const guestAccessExpiresAt = userId === null ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null;
  const guestIdempotencyDigest = userId === null ? idempotencyDigest : null;
  const cartVersion = userId === null ? null : 1;
  const [result] = await connection.execute(
    `INSERT INTO orders
      (public_id, order_number, user_id, guest_access_digest, guest_access_expires_at,
       status, payment_method, payment_status,
       currency, subtotal, delivery_fee, total, cart_version,
       idempotency_digest, guest_idempotency_digest, request_digest, placed_at)
     VALUES (?, ?, ?, ?, ?, 'confirmed', 'wafacash', 'pending', 'MAD', ?, 0, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [publicId, orderNumber, userId, guestAccessDigest, guestAccessExpiresAt,
      subtotal.toFixed(2), subtotal.toFixed(2),
      cartVersion, idempotencyDigest, guestIdempotencyDigest, randomBytes(32)]
  );
  await connection.execute(
    `INSERT INTO order_addresses
      (order_id, recipient_name, phone_e164, email, address_line1,
       district, city, country_code)
     VALUES (?, ?, '+212600000001', ?,
             '1 Integration Street', 'Centre', 'Casablanca', 'MA')`,
    [result.insertId, recipientName, buyerEmail]
  );
  const itemPublicId = randomUUID();
  const [itemResult] = await connection.execute(
    `INSERT INTO order_items
      (public_id, order_id, line_no, product_ref_id, external_product_id,
       product_name, product_image_url, unit_price, quantity)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    [itemPublicId, result.insertId, productRefId, product.id, product.name,
      product.image_url, product.price, quantity]
  );
  await connection.execute(
    `INSERT INTO order_tracking_events
      (order_id, status, event_code, source, public_note)
     VALUES (?, 'confirmed', 'order_confirmed', 'system', 'Your order has been confirmed.')`,
    [result.insertId]
  );
  if (allocateInventory) {
    await connection.execute(
      `INSERT INTO order_inventory_allocations
        (order_id, product_ref_id, quantity, inventory_policy)
       VALUES (?, ?, ?, 'finite')`,
      [result.insertId, productRefId, quantity]
    );
  }
  return {
    id: result.insertId,
    publicId,
    orderNumber,
    itemId: itemResult.insertId,
    itemPublicId
  };
}

async function login(agent, email) {
  const bootstrap = await agent.get('/api/v1/admin/auth/session');
  expect(bootstrap.status).toBe(200);
  const response = await agent
    .post('/api/v1/admin/auth/login')
    .set('Origin', config.appOrigin)
    .set('X-CSRF-Token', bootstrap.body.csrfToken)
    .send({ email, password: adminPassword });
  expect(response.status).toBe(200);
  return response.body.csrfToken;
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

function connectionBarrierDatabase(database) {
  let referenceBarrier = null;
  return {
    setReferenceBarrier(barrier) {
      referenceBarrier = barrier;
    },
    execute(...args) {
      return database.execute(...args);
    },
    async getConnection() {
      const connection = await database.getConnection();
      return {
        beginTransaction: () => connection.beginTransaction(),
        commit: () => connection.commit(),
        rollback: () => connection.rollback(),
        release: () => connection.release(),
        async execute(sql, values) {
          const result = await connection.execute(sql, values);
          if (referenceBarrier && sql.includes('SELECT order_id FROM return_requests WHERE public_id = ?')) {
            await referenceBarrier();
          }
          return result;
        }
      };
    }
  };
}

databaseDescribe('administrator MySQL order operations', () => {
  beforeAll(async () => {
    if (!pool) throw new Error('TEST_USE_DATABASE=true did not create a database pool.');
    if (process.env.TEST_SKIP_MIGRATIONS !== 'true') {
      await runMigrations({ database: pool, log: { info() {}, error() {} } });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const passwordHash = await hashPassword(adminPassword);
      await connection.execute(
        `INSERT INTO admin_identities
          (public_id, email, email_normalized, display_name, password_hash, role, status)
         VALUES (?, ?, ?, 'Operations Owner', ?, 'owner', 'active'),
                (?, ?, ?, 'Operations Support', ?, 'support', 'active')`,
        [randomUUID(), ownerEmail, ownerEmail, passwordHash,
          randomUUID(), supportEmail, supportEmail, passwordHash]
      );
      customerPublicId = randomUUID();
      const [userResult] = await connection.execute(
        `INSERT INTO users
          (public_id, email, email_normalized, display_name, phone_e164,
           password_hash, status, email_verified_at)
         VALUES (?, ?, ?, 'Admin Operations Customer', '+212600000001', ?, 'active', UTC_TIMESTAMP(3))`,
        [customerPublicId, customerEmail, customerEmail, await hashPassword(customerPassword)]
      );
      customerId = userResult.insertId;
      await connection.execute(
        `INSERT INTO user_preferences
          (user_id, language, theme, default_payment, order_notifications,
           low_stock_notifications, personalization_enabled)
         VALUES (?, 'en', 'light', 'wafacash', 1, 1, 1)`,
        [customerId]
      );
      const [productResult] = await connection.execute(
        `INSERT INTO catalog_product_refs
          (external_id, last_known_name, last_known_image_url, last_verified_price,
           currency, is_available, stock_quantity, last_verified_at)
         VALUES (?, ?, ?, ?, 'MAD', 1, ?, UTC_TIMESTAMP(3))`,
        [product.id, product.name, product.image_url, product.price, product.stock_quantity]
      );
      productRefId = productResult.insertId;
      await connection.execute(
        `INSERT INTO catalog_inventory
          (product_ref_id, available_quantity, source_quantity, last_observed_at)
         VALUES (?, 7, 10, UTC_TIMESTAMP(3))`,
        [productRefId]
      );

      primaryOrder = await insertOrder(connection, { quantity: 2, suffix: 'PRIMARY' });
      cancellableOrder = await insertOrder(connection, { quantity: 1, suffix: 'CANCEL' });
      guestOrder = await insertOrder(connection, {
        quantity: 1,
        suffix: 'GUEST',
        allocateInventory: false,
        userId: null,
        recipientName: 'Separate Guest Contact',
        // Deliberately share the registered account email. Stable ownership,
        // not mutable contact data, must keep these records separate.
        buyerEmail: customerEmail
      });
      trackedGuestOrderIds.add(guestOrder.publicId);
      primaryOrderItem = { id: primaryOrder.itemId, publicId: primaryOrder.itemPublicId };
      const returnPublicId = randomUUID();
      const [returnResult] = await connection.execute(
        `INSERT INTO return_requests
          (public_id, order_id, user_id, status, reason_code, details)
         VALUES (?, ?, ?, 'requested', 'quality', 'Integration return')`,
        [returnPublicId, primaryOrder.id, customerId]
      );
      await connection.execute(
        `INSERT INTO return_items (return_id, order_item_id, quantity, reason)
         VALUES (?, ?, 1, 'quality')`,
        [returnResult.insertId, primaryOrderItem.id]
      );
      returnRequest = { id: returnResult.insertId, publicId: returnPublicId };
      trackedReturnIds.add(returnResult.insertId);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }, 60_000);

  afterAll(async () => {
    try {
      for (const returnId of trackedReturnIds) {
        await pool?.execute(
          `DELETE FROM outbox_events
            WHERE aggregate_type = 'return' AND aggregate_id = ?`,
          [String(returnId)]
        );
      }
      await cleanupIntegrationData(
        pool,
        new Set([customerEmail]),
        trackedProductIds,
        trackedGuestOrderIds
      );
      await pool?.execute(
        'DELETE FROM admin_identities WHERE email_normalized IN (?, ?)',
        [ownerEmail, supportEmail]
      );
    } finally {
      await pool?.end();
    }
  }, 60_000);

  it('requires an administrator session and manager-level mutation role', async () => {
    const app = createApp({
      database: pool,
      catalog: createMockCatalog([product]),
      mailService: createMockMailer()
    });
    expect((await request(app).get('/api/v1/admin/orders')).status).toBe(401);

    const support = request.agent(app);
    const csrfToken = await login(support, supportEmail);
    const denied = await support
      .patch(`/api/v1/admin/orders/${primaryOrder.publicId}/status`)
      .set('Origin', config.appOrigin)
      .set('X-CSRF-Token', csrfToken)
      .send({ status: 'preparing' });
    expect(denied.status).toBe(403);
    expect(denied.body.error?.code).toBe('ADMIN_ROLE_REQUIRED');

    const [rows] = await pool.execute('SELECT status FROM orders WHERE id = ?', [primaryOrder.id]);
    expect(rows[0].status).toBe('confirmed');
  }, 60_000);

  it('lists real orders and customers without exposing authentication secrets', async () => {
    const app = createApp({
      database: pool,
      catalog: createMockCatalog([product]),
      mailService: createMockMailer()
    });
    const owner = request.agent(app);
    await login(owner, ownerEmail);

    const orders = await owner.get('/api/v1/admin/orders?limit=50');
    expect(orders.status).toBe(200);
    expect(orders.headers['cache-control']).toBe('no-store');
    expect(orders.body.orders).toContainEqual(expect.objectContaining({
      id: primaryOrder.publicId,
      publicId: primaryOrder.publicId,
      orderNumber: primaryOrder.orderNumber,
      status: 'confirmed',
      paymentMethod: 'wafacash',
      paymentStatus: 'pending',
      paymentReference: primaryOrder.orderNumber,
      customerId: customerPublicId,
      customerType: 'registered',
      buyer: expect.objectContaining({ email: customerEmail, city: 'Casablanca' }),
      items: [expect.objectContaining({ id: primaryOrderItem.publicId, quantity: 2 })],
      returns: [expect.objectContaining({ id: returnRequest.publicId, status: 'requested' })]
    }));
    expect(typeof orders.body.hasMore).toBe('boolean');
    expect(orders.body.total).toBeGreaterThanOrEqual(3);

    const firstOrderPage = await owner.get('/api/v1/admin/orders?limit=1&status=confirmed');
    expect(firstOrderPage.status).toBe(200);
    expect(firstOrderPage.body).toMatchObject({ hasMore: true });
    expect(firstOrderPage.body.nextCursor).toEqual(expect.any(String));
    const secondOrderPage = await owner.get(
      `/api/v1/admin/orders?limit=1&status=confirmed&cursor=${encodeURIComponent(firstOrderPage.body.nextCursor)}`
    );
    expect(secondOrderPage.status).toBe(200);
    expect(secondOrderPage.body.total).toBe(firstOrderPage.body.total);
    expect(secondOrderPage.body.orders[0].publicId).not.toBe(firstOrderPage.body.orders[0].publicId);

    const searchedOrders = await owner.get(
      `/api/v1/admin/orders?search=${encodeURIComponent(primaryOrder.orderNumber)}`
    );
    expect(searchedOrders.status).toBe(200);
    expect(searchedOrders.body.total).toBe(1);
    expect(searchedOrders.body.orders[0].publicId).toBe(primaryOrder.publicId);

    const customers = await owner.get('/api/v1/admin/customers?limit=50');
    expect(customers.status).toBe(200);
    const customer = customers.body.customers.find((entry) => entry.id === customerPublicId);
    expect(customer).toMatchObject({
      displayName: 'Admin Operations Customer',
      phone: '+212600000001',
      status: 'active',
      orderCount: 2
    });
    expect(customer).toMatchObject({ id: customerPublicId, customerType: 'registered' });
    const guest = customers.body.customers.find((entry) => entry.id === guestOrder.publicId);
    expect(guest).toMatchObject({
      customerType: 'guest',
      displayName: 'Separate Guest Contact',
      email: customerEmail,
      orderCount: 1
    });
    expect(guest.id).not.toBe(customer.id);

    const firstCustomerPage = await owner.get('/api/v1/admin/customers?limit=1');
    expect(firstCustomerPage.status).toBe(200);
    expect(firstCustomerPage.body).toMatchObject({ hasMore: true });
    expect(firstCustomerPage.body.nextCursor).toEqual(expect.any(String));
    const secondCustomerPage = await owner.get(
      `/api/v1/admin/customers?limit=1&cursor=${encodeURIComponent(firstCustomerPage.body.nextCursor)}`
    );
    expect(secondCustomerPage.status).toBe(200);
    expect(secondCustomerPage.body.total).toBe(firstCustomerPage.body.total);
    expect(secondCustomerPage.body.customers[0].id).not.toBe(firstCustomerPage.body.customers[0].id);

    const searchedCustomers = await owner.get('/api/v1/admin/customers?search=Separate%20Guest%20Contact');
    expect(searchedCustomers.status).toBe(200);
    expect(searchedCustomers.body.total).toBe(1);
    expect(searchedCustomers.body.customers[0]).toMatchObject({
      id: guestOrder.publicId,
      customerType: 'guest'
    });

    const registeredHistory = await owner.get(`/api/v1/admin/customers/${customer.id}/orders?limit=50`);
    expect(registeredHistory.status).toBe(200);
    expect(registeredHistory.body).toMatchObject({
      customerId: customerPublicId,
      customerType: 'registered',
      hasMore: false
    });
    expect(registeredHistory.body.orders).toHaveLength(2);
    expect(registeredHistory.body.orders.every((entry) => entry.customerId === customerPublicId)).toBe(true);

    const guestHistory = await owner.get(`/api/v1/admin/customers/${guest.id}/orders?limit=50`);
    expect(guestHistory.status).toBe(200);
    expect(guestHistory.body).toMatchObject({
      customerId: guestOrder.publicId,
      customerType: 'guest',
      hasMore: false
    });
    expect(guestHistory.body.orders).toHaveLength(1);
    expect(guestHistory.body.orders[0]).toMatchObject({
      publicId: guestOrder.publicId,
      customerId: null,
      customerType: 'guest'
    });
    expect(JSON.stringify(customer)).not.toContain('password');
    const [demoRows] = await pool.execute(
      `SELECT u.public_id
         FROM local_demo_accounts demo
         JOIN users u ON u.id = demo.user_id`
    );
    for (const demo of demoRows) {
      expect(customers.body.customers.some((entry) => entry.id === demo.public_id)).toBe(false);
    }
  }, 60_000);

  it('validates, persists, audits, and notifies order and offline-payment transitions', async () => {
    const app = createApp({
      database: pool,
      catalog: createMockCatalog([product]),
      mailService: createMockMailer()
    });
    const owner = request.agent(app);
    const csrfToken = await login(owner, ownerEmail);
    const mutate = (path, body) => owner.patch(path)
      .set('Origin', config.appOrigin)
      .set('X-CSRF-Token', csrfToken)
      .send(body);

    const csrfDenied = await owner
      .patch(`/api/v1/admin/orders/${primaryOrder.publicId}/status`)
      .set('Origin', config.appOrigin)
      .send({ status: 'preparing' });
    expect(csrfDenied.status).toBe(403);
    expect(csrfDenied.body.error?.code).toBe('ADMIN_CSRF_INVALID');

    const invalidJump = await mutate(
      `/api/v1/admin/orders/${primaryOrder.publicId}/status`,
      { status: 'delivered' }
    );
    expect(invalidJump.status).toBe(409);
    expect(invalidJump.body.error?.code).toBe('ORDER_STATUS_TRANSITION_INVALID');

    for (const status of ['preparing', 'shipping', 'delivered']) {
      const response = await mutate(
        `/api/v1/admin/orders/${primaryOrder.publicId}/status`,
        { status }
      );
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ order: { status }, replayed: false });
    }
    const replay = await mutate(
      `/api/v1/admin/orders/${primaryOrder.publicId}/status`,
      { status: 'delivered' }
    );
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);

    const wrongReference = await mutate(
      `/api/v1/admin/orders/${primaryOrder.publicId}/payment`,
      { status: 'paid', reference: 'not-the-order-number' }
    );
    expect(wrongReference.status).toBe(409);
    expect(wrongReference.body.error?.code).toBe('PAYMENT_REFERENCE_MISMATCH');

    const paid = await mutate(
      `/api/v1/admin/orders/${primaryOrder.publicId}/payment`,
      { status: 'paid', reference: primaryOrder.orderNumber }
    );
    expect(paid.status).toBe(200);
    expect(paid.body.order).toMatchObject({
      paymentStatus: 'paid',
      paymentReference: primaryOrder.orderNumber
    });
    const paidReplay = await mutate(
      `/api/v1/admin/orders/${primaryOrder.publicId}/payment`,
      { status: 'paid', reference: primaryOrder.orderNumber }
    );
    expect(paidReplay.status).toBe(200);
    expect(paidReplay.body.replayed).toBe(true);

    const [orderRows] = await pool.execute(
      'SELECT status, payment_status, delivered_at FROM orders WHERE id = ?',
      [primaryOrder.id]
    );
    expect(orderRows[0].status).toBe('delivered');
    expect(orderRows[0].payment_status).toBe('paid');
    expect(orderRows[0].delivered_at).not.toBeNull();
    const [trackingRows] = await pool.execute(
      `SELECT status, source FROM order_tracking_events
        WHERE order_id = ? AND source = 'admin' ORDER BY id`,
      [primaryOrder.id]
    );
    expect(trackingRows.map((row) => row.status)).toEqual(['preparing', 'shipping', 'delivered']);
    expect(trackingRows.every((row) => row.source === 'admin')).toBe(true);
    const [notificationRows] = await pool.execute(
      `SELECT type FROM notifications
        WHERE order_id = ? AND type IN ('order_preparing', 'order_shipping', 'order_delivered', 'payment_paid')`,
      [primaryOrder.id]
    );
    expect(notificationRows).toHaveLength(4);
    expect(new Set(notificationRows.map((row) => row.type))).toEqual(
      new Set(['order_preparing', 'order_shipping', 'order_delivered', 'payment_paid'])
    );
    const [outboxRows] = await pool.execute(
      `SELECT event_type FROM outbox_events
        WHERE aggregate_type = 'order' AND aggregate_id = ?`,
      [String(primaryOrder.id)]
    );
    expect(outboxRows).toHaveLength(4);
    expect(new Set(outboxRows.map((row) => row.event_type))).toEqual(
      new Set(['order.preparing', 'order.shipping', 'order.delivered', 'order.payment.paid'])
    );
  }, 60_000);

  it('processes returns in order and reconciles partial refunds transactionally', async () => {
    const app = createApp({
      database: pool,
      catalog: createMockCatalog([product]),
      mailService: createMockMailer()
    });
    const owner = request.agent(app);
    const csrfToken = await login(owner, ownerEmail);
    const mutate = (status) => owner
      .patch(`/api/v1/admin/returns/${returnRequest.publicId}/status`)
      .set('Origin', config.appOrigin)
      .set('X-CSRF-Token', csrfToken)
      .send({ status });

    expect((await mutate('approved')).body).toMatchObject({
      return: { status: 'approved' },
      order: { id: primaryOrder.publicId, paymentStatus: 'paid' },
      replayed: false
    });
    const invalid = await mutate('refunded');
    expect(invalid.status).toBe(409);
    expect(invalid.body.error?.code).toBe('RETURN_STATUS_TRANSITION_INVALID');
    expect((await mutate('received')).body.return.status).toBe('received');
    const refunded = await mutate('refunded');
    expect(refunded.status).toBe(200);
    expect(refunded.body).toMatchObject({
      return: { status: 'refunded' },
      order: { paymentStatus: 'partially_refunded' }
    });
    expect((await mutate('refunded')).body.replayed).toBe(true);

    const [returnRows] = await pool.execute(
      'SELECT status, resolved_at FROM return_requests WHERE id = ?',
      [returnRequest.id]
    );
    expect(returnRows[0].status).toBe('refunded');
    expect(returnRows[0].resolved_at).not.toBeNull();
    const [orderRows] = await pool.execute(
      'SELECT payment_status FROM orders WHERE id = ?',
      [primaryOrder.id]
    );
    expect(orderRows[0].payment_status).toBe('partially_refunded');
    const [returnOutbox] = await pool.execute(
      `SELECT event_type FROM outbox_events
        WHERE aggregate_type = 'return' AND aggregate_id = ? ORDER BY id`,
      [String(returnRequest.id)]
    );
    expect(returnOutbox.map((row) => row.event_type)).toEqual([
      'return.approved', 'return.received', 'return.refunded'
    ]);
  }, 60_000);

  it('reconciles two concurrent refunds against the current committed return state', async () => {
    const connection = await pool.getConnection();
    let concurrentOrder;
    const concurrentReturns = [];
    try {
      await connection.beginTransaction();
      concurrentOrder = await insertOrder(connection, {
        quantity: 2,
        suffix: 'CONCURRENT-RETURN',
        allocateInventory: false
      });
      await connection.execute(
        `UPDATE orders
            SET status = 'delivered', payment_status = 'paid', delivered_at = UTC_TIMESTAMP(3)
          WHERE id = ?`,
        [concurrentOrder.id]
      );
      for (let index = 0; index < 2; index += 1) {
        const publicId = randomUUID();
        const [returnResult] = await connection.execute(
          `INSERT INTO return_requests
            (public_id, order_id, user_id, status, reason_code, details)
           VALUES (?, ?, ?, 'received', 'quality', ?)`,
          [publicId, concurrentOrder.id, customerId, `Concurrent refund ${index + 1}`]
        );
        await connection.execute(
          `INSERT INTO return_items (return_id, order_item_id, quantity, reason)
           VALUES (?, ?, 1, 'quality')`,
          [returnResult.insertId, concurrentOrder.itemId]
        );
        concurrentReturns.push({ id: returnResult.insertId, publicId });
        trackedReturnIds.add(returnResult.insertId);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const synchronizedDatabase = connectionBarrierDatabase(pool);
    synchronizedDatabase.setReferenceBarrier(rendezvous(2));
    const app = createApp({
      database: synchronizedDatabase,
      catalog: createMockCatalog([product]),
      mailService: createMockMailer()
    });
    const owner = request.agent(app);
    const csrfToken = await login(owner, ownerEmail);
    const refund = (returnId) => owner
      .patch(`/api/v1/admin/returns/${returnId}/status`)
      .set('Origin', config.appOrigin)
      .set('X-CSRF-Token', csrfToken)
      .send({ status: 'refunded' });

    const responses = await Promise.all(concurrentReturns.map((entry) => refund(entry.publicId)));
    expect(responses.every((response) => response.status === 200)).toBe(true);

    const [orderRows] = await pool.execute(
      'SELECT payment_status FROM orders WHERE id = ?',
      [concurrentOrder.id]
    );
    expect(orderRows[0].payment_status).toBe('refunded');
    const [returnRows] = await pool.execute(
      'SELECT status FROM return_requests WHERE id IN (?, ?) ORDER BY id',
      concurrentReturns.map((entry) => entry.id)
    );
    expect(returnRows).toEqual([{ status: 'refunded' }, { status: 'refunded' }]);
  }, 60_000);

  it('cancels only an eligible order and releases finite inventory exactly once', async () => {
    const app = createApp({
      database: pool,
      catalog: createMockCatalog([product]),
      mailService: createMockMailer()
    });
    const owner = request.agent(app);
    const csrfToken = await login(owner, ownerEmail);
    const mutate = (path, body) => owner
      .patch(path)
      .set('Origin', config.appOrigin)
      .set('X-CSRF-Token', csrfToken)
      .send(body);
    const cancel = () => mutate(
      `/api/v1/admin/orders/${cancellableOrder.publicId}/status`,
      { status: 'cancelled' }
    );

    const paid = await mutate(
      `/api/v1/admin/orders/${cancellableOrder.publicId}/payment`,
      { status: 'paid', reference: cancellableOrder.orderNumber }
    );
    expect(paid.status).toBe(200);
    expect(paid.body.order.paymentStatus).toBe('paid');

    const prematureRefund = await mutate(
      `/api/v1/admin/orders/${cancellableOrder.publicId}/payment`,
      { status: 'refunded', reference: cancellableOrder.orderNumber }
    );
    expect(prematureRefund.status).toBe(409);
    expect(prematureRefund.body.error?.code).toBe('PAYMENT_REFUND_REQUIRES_CANCELLATION');

    const first = await cancel();
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ order: { status: 'cancelled' }, replayed: false });
    const second = await cancel();
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);

    const refunded = await mutate(
      `/api/v1/admin/orders/${cancellableOrder.publicId}/payment`,
      { status: 'refunded', reference: cancellableOrder.orderNumber }
    );
    expect(refunded.status).toBe(200);
    expect(refunded.body.order.paymentStatus).toBe('refunded');

    const [inventory] = await pool.execute(
      'SELECT available_quantity FROM catalog_inventory WHERE product_ref_id = ?',
      [productRefId]
    );
    expect(inventory[0].available_quantity).toBe(8);
    const [cancellations] = await pool.execute(
      'SELECT status, processed_at FROM order_cancellations WHERE order_id = ?',
      [cancellableOrder.id]
    );
    expect(cancellations).toHaveLength(1);
    expect(cancellations[0].status).toBe('accepted');
    expect(cancellations[0].processed_at).not.toBeNull();
    const [cancelOutbox] = await pool.execute(
      `SELECT event_type FROM outbox_events
        WHERE aggregate_type = 'order' AND aggregate_id = ?
          AND event_type IN ('order.cancelled', 'order.payment.paid', 'order.payment.refunded')`,
      [String(cancellableOrder.id)]
    );
    expect(cancelOutbox.map((row) => row.event_type).sort()).toEqual([
      'order.cancelled', 'order.payment.paid', 'order.payment.refunded'
    ]);
  }, 60_000);
});
