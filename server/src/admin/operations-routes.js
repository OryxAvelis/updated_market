import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from './session.js';
import { releaseOrderInventory } from '../catalog/inventory.js';
import { databaseDateToIso, nullableDatabaseDateToIso } from '../db/date.js';
import { conflict, forbidden, notFound } from '../http/errors.js';
import { publicIdSchema } from '../validation/common.js';

const orderListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  status: z.enum(['confirmed', 'preparing', 'shipping', 'delivered', 'cancelled']).optional()
}).strip();

const customerListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100)
}).strip();

const orderStatusSchema = z.object({
  status: z.enum(['confirmed', 'preparing', 'shipping', 'delivered', 'cancelled'])
}).strict();

const paymentStatusSchema = z.object({
  status: z.enum(['paid', 'failed', 'refunded']),
  reference: z.string().trim().min(1).max(40).optional()
}).strict();

const returnStatusSchema = z.object({
  status: z.enum(['requested', 'approved', 'rejected', 'received', 'refunded', 'cancelled'])
}).strict();

export const adminOrderTransitions = Object.freeze({
  confirmed: Object.freeze(['preparing', 'cancelled']),
  preparing: Object.freeze(['shipping', 'cancelled']),
  shipping: Object.freeze(['delivered']),
  delivered: Object.freeze([]),
  cancelled: Object.freeze([])
});

export const adminReturnTransitions = Object.freeze({
  requested: Object.freeze(['approved', 'rejected', 'cancelled']),
  approved: Object.freeze(['received', 'rejected', 'cancelled']),
  received: Object.freeze(['refunded']),
  rejected: Object.freeze([]),
  refunded: Object.freeze([]),
  cancelled: Object.freeze([])
});

export const offlinePaymentTransitions = Object.freeze({
  pending: Object.freeze(['paid', 'failed']),
  authorized: Object.freeze(['paid', 'failed']),
  failed: Object.freeze(['paid']),
  paid: Object.freeze(['refunded']),
  partially_refunded: Object.freeze([]),
  refunded: Object.freeze([])
});

const orderStatusCopy = Object.freeze({
  preparing: {
    eventCode: 'order_preparing',
    eventType: 'order.preparing',
    note: 'Your order is being prepared.'
  },
  shipping: {
    eventCode: 'order_shipping',
    eventType: 'order.shipping',
    note: 'Your order is on the way.'
  },
  delivered: {
    eventCode: 'order_delivered',
    eventType: 'order.delivered',
    note: 'Your order has been delivered.'
  },
  cancelled: {
    eventCode: 'order_cancelled',
    eventType: 'order.cancelled',
    note: 'The order was cancelled.'
  }
});

const returnStatusCopy = Object.freeze({
  approved: 'Your return request was approved.',
  rejected: 'Your return request was rejected.',
  received: 'Your returned items were received.',
  refunded: 'Your return was refunded.',
  cancelled: 'Your return request was cancelled.'
});

export function isAllowedAdminOrderTransition(currentStatus, targetStatus) {
  return adminOrderTransitions[currentStatus]?.includes(targetStatus) === true;
}

export function isAllowedAdminReturnTransition(currentStatus, targetStatus) {
  return adminReturnTransitions[currentStatus]?.includes(targetStatus) === true;
}

export function isAllowedOfflinePaymentTransition(currentStatus, targetStatus) {
  return offlinePaymentTransitions[currentStatus]?.includes(targetStatus) === true;
}

function requireAdminMutation(req, _res, next) {
  if (['owner', 'manager'].includes(req.adminAuth?.admin?.role)) return next();
  return next(forbidden('ADMIN_ROLE_REQUIRED', 'An owner or manager role is required for this action.'));
}

async function inTransaction(database, work) {
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function placeholders(values) {
  return values.map(() => '?').join(', ');
}

function iso(value) {
  return databaseDateToIso(value);
}

function nullableIso(value) {
  return nullableDatabaseDateToIso(value);
}

function customerAddress(row) {
  return [row.address_line1, row.address_line2, row.district, row.city, row.postal_code]
    .filter(Boolean)
    .join(', ');
}

function serializeOrder(row, itemsByOrder, returnsByOrder) {
  return {
    id: row.public_id,
    publicId: row.public_id,
    orderNumber: row.order_number,
    status: row.status,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    // Offline payment partners and customers can use the immutable order
    // number as the settlement reference; no separate secret identifier is
    // needed or exposed.
    paymentReference: row.order_number,
    currency: row.currency,
    subtotal: row.subtotal,
    deliveryFee: row.delivery_fee,
    total: row.total,
    note: row.note,
    placedAt: iso(row.placed_at),
    date: iso(row.placed_at),
    cancelledAt: nullableIso(row.cancelled_at),
    deliveredAt: nullableIso(row.delivered_at),
    buyer: {
      name: row.recipient_name,
      phone: row.phone_e164,
      email: row.email,
      address: customerAddress(row),
      addressLine1: row.address_line1,
      addressLine2: row.address_line2,
      district: row.district,
      city: row.city,
      postalCode: row.postal_code,
      country: row.country_code,
      deliveryInstructions: row.delivery_instructions
    },
    items: itemsByOrder.get(String(row.id)) || [],
    returns: returnsByOrder.get(String(row.id)) || []
  };
}

async function loadAdminOrders(database, { publicId, limit = 100, status } = {}) {
  const conditions = [];
  const params = [];
  if (publicId) {
    conditions.push('o.public_id = ?');
    params.push(publicId);
  }
  if (status) {
    conditions.push('o.status = ?');
    params.push(status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await database.execute(
    `SELECT o.id, o.public_id, o.order_number, o.status, o.payment_method,
            o.payment_status, o.currency, o.subtotal, o.delivery_fee, o.total,
            o.note, o.placed_at, o.cancelled_at, o.delivered_at,
            a.recipient_name, a.phone_e164, a.email, a.address_line1,
            a.address_line2, a.district, a.city, a.postal_code,
            a.country_code, a.delivery_instructions
       FROM orders o
       JOIN order_addresses a ON a.order_id = o.id
       ${where}
      ORDER BY o.placed_at DESC, o.id DESC
      LIMIT ${Number(limit)}`,
    params
  );
  if (!rows.length) return [];

  const orderIds = rows.map((row) => row.id);
  const [itemRows] = await database.execute(
    `SELECT id, public_id, order_id, external_product_id, product_name,
            product_image_url, unit_price, quantity, line_total
       FROM order_items
      WHERE order_id IN (${placeholders(orderIds)})
      ORDER BY order_id, line_no`,
    orderIds
  );
  const itemsByOrder = new Map();
  for (const item of itemRows) {
    const key = String(item.order_id);
    if (!itemsByOrder.has(key)) itemsByOrder.set(key, []);
    itemsByOrder.get(key).push({
      id: item.public_id,
      productId: item.external_product_id,
      name: item.product_name,
      imageUrl: item.product_image_url,
      unitPrice: item.unit_price,
      quantity: item.quantity,
      lineTotal: item.line_total
    });
  }

  const [returnRows] = await database.execute(
    `SELECT rr.id, rr.public_id, rr.order_id, rr.status, rr.reason_code,
            rr.details, rr.requested_at, rr.updated_at, rr.resolved_at,
            ri.order_item_id, ri.quantity, ri.reason,
            oi.public_id AS order_item_public_id,
            oi.external_product_id, oi.product_name
       FROM return_requests rr
       LEFT JOIN return_items ri ON ri.return_id = rr.id
       LEFT JOIN order_items oi ON oi.id = ri.order_item_id
      WHERE rr.order_id IN (${placeholders(orderIds)})
      ORDER BY rr.order_id, rr.requested_at, rr.id, ri.id`,
    orderIds
  );
  const returnsByOrder = new Map();
  const returnMap = new Map();
  for (const request of returnRows) {
    const orderKey = String(request.order_id);
    const returnKey = String(request.id);
    if (!returnsByOrder.has(orderKey)) returnsByOrder.set(orderKey, []);
    if (!returnMap.has(returnKey)) {
      const serialized = {
        id: request.public_id,
        status: request.status,
        reason: request.reason_code,
        details: request.details,
        requestedAt: iso(request.requested_at),
        updatedAt: iso(request.updated_at),
        resolvedAt: nullableIso(request.resolved_at),
        items: []
      };
      returnMap.set(returnKey, serialized);
      returnsByOrder.get(orderKey).push(serialized);
    }
    if (request.order_item_id) {
      returnMap.get(returnKey).items.push({
        orderItemId: request.order_item_public_id,
        productId: request.external_product_id,
        name: request.product_name,
        quantity: request.quantity,
        reason: request.reason
      });
    }
  }

  return rows.map((row) => serializeOrder(row, itemsByOrder, returnsByOrder));
}

async function loadAdminOrder(database, publicId) {
  const orders = await loadAdminOrders(database, { publicId, limit: 1 });
  if (!orders[0]) throw notFound('ORDER_NOT_FOUND', 'The order was not found.');
  return orders[0];
}

async function notifyOrderCustomer(connection, order, type, message, payload = {}) {
  if (!order.user_id) return;
  await connection.execute(
    `INSERT INTO notifications
      (public_id, user_id, type, order_id, dedupe_key, payload)
     SELECT ?, ?, ?, ?, ?, JSON_MERGE_PATCH(
              JSON_OBJECT('orderId', ?, 'orderNumber', ?, 'message', ?),
              CAST(? AS JSON)
            )
       FROM user_preferences
      WHERE user_id = ? AND order_notifications = 1`,
    [randomUUID(), order.user_id, type, order.id,
      `order:${order.public_id}:${type}`, order.public_id, order.order_number,
      message, JSON.stringify(payload), order.user_id]
  );
}

async function notifyReturnCustomer(connection, request, status) {
  await connection.execute(
    `INSERT INTO notifications
      (public_id, user_id, type, order_id, dedupe_key, payload)
     SELECT ?, ?, ?, ?, ?, JSON_OBJECT(
              'orderId', ?, 'orderNumber', ?, 'returnId', ?,
              'status', ?, 'message', ?
            )
       FROM user_preferences
      WHERE user_id = ? AND order_notifications = 1`,
    [randomUUID(), request.user_id, `return_${status}`, request.order_id,
      `return:${request.public_id}:${status}`, request.order_public_id,
      request.order_number, request.public_id, status,
      returnStatusCopy[status], request.user_id]
  );
}

async function transitionOrder(database, req, publicId, targetStatus) {
  let replayed = false;
  await inTransaction(database, async (connection) => {
    const [rows] = await connection.execute(
      `SELECT id, public_id, order_number, user_id, status
         FROM orders WHERE public_id = ? LIMIT 1 FOR UPDATE`,
      [publicId]
    );
    const order = rows[0];
    if (!order) throw notFound('ORDER_NOT_FOUND', 'The order was not found.');
    if (order.status === targetStatus) {
      replayed = true;
      return;
    }
    if (!isAllowedAdminOrderTransition(order.status, targetStatus)) {
      throw conflict(
        'ORDER_STATUS_TRANSITION_INVALID',
        `An order in ${order.status} status cannot transition to ${targetStatus}.`
      );
    }

    await connection.execute(
      `UPDATE orders
          SET status = ?,
              cancelled_at = CASE WHEN ? = 'cancelled' THEN UTC_TIMESTAMP(3) ELSE cancelled_at END,
              delivered_at = CASE WHEN ? = 'delivered' THEN UTC_TIMESTAMP(3) ELSE delivered_at END,
              version = version + 1
        WHERE id = ?`,
      [targetStatus, targetStatus, targetStatus, order.id]
    );
    if (targetStatus === 'cancelled') {
      await releaseOrderInventory(connection, order.id);
      if (order.user_id) {
        await connection.execute(
          `INSERT INTO order_cancellations
            (order_id, user_id, status, reason_code, details, processed_at)
           VALUES (?, ?, 'accepted', 'other', 'Cancelled by an administrator.', UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE
             status = 'accepted', processed_at = COALESCE(processed_at, UTC_TIMESTAMP(3))`,
          [order.id, order.user_id]
        );
      }
    }

    const copy = orderStatusCopy[targetStatus];
    await connection.execute(
      `INSERT INTO order_tracking_events
        (order_id, status, event_code, source, public_note, dedupe_key, occurred_at)
       VALUES (?, ?, ?, 'admin', ?, ?, UTC_TIMESTAMP(3))`,
      [order.id, targetStatus, copy.eventCode, copy.note,
        `admin:${order.public_id}:${targetStatus}`]
    );
    await notifyOrderCustomer(connection, order, copy.eventCode, copy.note, { status: targetStatus });
    await connection.execute(
      `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
       VALUES ('order', ?, ?, JSON_OBJECT(
         'orderId', ?, 'orderNumber', ?, 'userId', ?, 'adminId', ?,
         'previousStatus', ?, 'status', ?
       ))`,
      [String(order.id), copy.eventType, order.public_id, order.order_number,
        order.user_id, req.adminAuth.admin.id, order.status, targetStatus]
    );
  });
  return { order: await loadAdminOrder(database, publicId), replayed };
}

async function transitionPayment(database, req, publicId, input) {
  let replayed = false;
  await inTransaction(database, async (connection) => {
    const [rows] = await connection.execute(
      `SELECT id, public_id, order_number, user_id, status, payment_method, payment_status
         FROM orders WHERE public_id = ? LIMIT 1 FOR UPDATE`,
      [publicId]
    );
    const order = rows[0];
    if (!order) throw notFound('ORDER_NOT_FOUND', 'The order was not found.');
    if (!['cod', 'wafacash', 'cashplus'].includes(order.payment_method)) {
      throw conflict('PAYMENT_METHOD_NOT_OFFLINE', 'Only offline payments can be settled from the administrator API.');
    }
    if (input.reference && input.reference !== order.order_number) {
      throw conflict('PAYMENT_REFERENCE_MISMATCH', 'The payment reference must match the order number.');
    }
    if (order.payment_status === input.status) {
      replayed = true;
      return;
    }
    if (input.status === 'refunded' && order.status !== 'cancelled') {
      throw conflict(
        'PAYMENT_REFUND_REQUIRES_CANCELLATION',
        'A direct payment refund is available only after the order is cancelled; product returns use the return workflow.'
      );
    }
    if (!isAllowedOfflinePaymentTransition(order.payment_status, input.status)) {
      throw conflict(
        'PAYMENT_STATUS_TRANSITION_INVALID',
        `A payment in ${order.payment_status} status cannot transition to ${input.status}.`
      );
    }
    await connection.execute(
      'UPDATE orders SET payment_status = ?, version = version + 1 WHERE id = ?',
      [input.status, order.id]
    );
    const message = input.status === 'paid'
      ? 'Your payment was confirmed.'
      : input.status === 'refunded'
        ? 'Your payment was refunded.'
        : 'Your payment could not be confirmed.';
    await notifyOrderCustomer(connection, order, `payment_${input.status}`, message, {
      paymentStatus: input.status,
      paymentReference: order.order_number
    });
    await connection.execute(
      `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
       VALUES ('order', ?, ?, JSON_OBJECT(
         'orderId', ?, 'orderNumber', ?, 'userId', ?, 'adminId', ?,
         'paymentMethod', ?, 'paymentReference', ?,
         'previousStatus', ?, 'status', ?
       ))`,
      [String(order.id), `order.payment.${input.status}`, order.public_id,
        order.order_number, order.user_id, req.adminAuth.admin.id,
        order.payment_method, order.order_number, order.payment_status, input.status]
    );
  });
  return { order: await loadAdminOrder(database, publicId), replayed };
}

async function transitionReturn(database, req, returnPublicId, targetStatus) {
  let orderPublicId;
  let replayed = false;
  await inTransaction(database, async (connection) => {
    // Customer return creation locks the order before its return rows. Resolve
    // the immutable FK first, then take locks in that same order so an admin
    // transition cannot deadlock with a concurrent customer return request.
    const [references] = await connection.execute(
      'SELECT order_id FROM return_requests WHERE public_id = ? LIMIT 1',
      [returnPublicId]
    );
    const reference = references[0];
    if (!reference) throw notFound('RETURN_NOT_FOUND', 'The return request was not found.');
    const [orderRows] = await connection.execute(
      `SELECT id, public_id, order_number, payment_status, subtotal
         FROM orders WHERE id = ? LIMIT 1 FOR UPDATE`,
      [reference.order_id]
    );
    const order = orderRows[0];
    if (!order) throw notFound('RETURN_NOT_FOUND', 'The return request was not found.');
    const [returnRows] = await connection.execute(
      `SELECT id, public_id, order_id, user_id, status
         FROM return_requests
        WHERE public_id = ? AND order_id = ? LIMIT 1 FOR UPDATE`,
      [returnPublicId, order.id]
    );
    const requestRow = returnRows[0];
    if (!requestRow) throw notFound('RETURN_NOT_FOUND', 'The return request was not found.');
    const request = {
      ...requestRow,
      order_public_id: order.public_id,
      order_number: order.order_number,
      payment_status: order.payment_status,
      subtotal: order.subtotal
    };
    orderPublicId = request.order_public_id;
    if (request.status === targetStatus) {
      replayed = true;
      return;
    }
    if (!isAllowedAdminReturnTransition(request.status, targetStatus)) {
      throw conflict(
        'RETURN_STATUS_TRANSITION_INVALID',
        `A return in ${request.status} status cannot transition to ${targetStatus}.`
      );
    }
    if (targetStatus === 'refunded' && !['paid', 'partially_refunded'].includes(request.payment_status)) {
      throw conflict('RETURN_PAYMENT_NOT_SETTLED', 'The order payment must be paid before a return can be refunded.');
    }

    await connection.execute(
      `UPDATE return_requests
          SET status = ?,
              resolved_at = CASE
                WHEN ? IN ('rejected', 'refunded', 'cancelled') THEN UTC_TIMESTAMP(3)
                ELSE NULL
              END
        WHERE id = ?`,
      [targetStatus, targetStatus, request.id]
    );

    let reconciledPaymentStatus = null;
    if (targetStatus === 'refunded') {
      const [refundRows] = await connection.execute(
        `SELECT oi.unit_price, ri.quantity
           FROM return_requests rr
           JOIN return_items ri ON ri.return_id = rr.id
           JOIN order_items oi ON oi.id = ri.order_item_id
          WHERE rr.order_id = ? AND rr.status = 'refunded'
          ORDER BY rr.id, ri.id
          FOR UPDATE`,
        [request.order_id]
      );
      const refundedCents = refundRows.reduce(
        (total, row) => total + Math.round(Number(row.unit_price) * 100) * Number(row.quantity),
        0
      );
      const orderSubtotalCents = Math.round(Number(request.subtotal) * 100);
      reconciledPaymentStatus = refundedCents >= orderSubtotalCents
        ? 'refunded'
        : 'partially_refunded';
      await connection.execute(
        'UPDATE orders SET payment_status = ?, version = version + 1 WHERE id = ?',
        [reconciledPaymentStatus, request.order_id]
      );
    }

    await notifyReturnCustomer(connection, request, targetStatus);
    await connection.execute(
      `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
       VALUES ('return', ?, ?, JSON_OBJECT(
         'returnId', ?, 'orderId', ?, 'orderNumber', ?, 'userId', ?,
         'adminId', ?, 'previousStatus', ?, 'status', ?,
         'paymentStatus', ?
       ))`,
      [String(request.id), `return.${targetStatus}`, request.public_id,
        request.order_public_id, request.order_number, request.user_id,
        req.adminAuth.admin.id, request.status, targetStatus,
        reconciledPaymentStatus]
    );
  });

  const order = await loadAdminOrder(database, orderPublicId);
  const updatedReturn = order.returns.find((request) => request.id === returnPublicId);
  return { return: updatedReturn, order, replayed };
}

export function createAdminOperationsRouter() {
  const router = Router();
  router.use(requireAdmin);

  router.get('/orders', async (req, res) => {
    const query = orderListSchema.parse(req.query);
    const orders = await loadAdminOrders(req.app.locals.db, query);
    res.set('Cache-Control', 'no-store').json({ orders });
  });

  router.get('/customers', async (req, res) => {
    const query = customerListSchema.parse(req.query);
    const [rows] = await req.app.locals.db.execute(
      `SELECT u.public_id, u.email, u.display_name, u.phone_e164, u.status,
              u.created_at, COUNT(o.id) AS order_count,
              COALESCE(SUM(o.total), 0) AS total_spent,
              MAX(o.placed_at) AS last_order_at
         FROM users u
         LEFT JOIN local_demo_accounts demo ON demo.user_id = u.id
         LEFT JOIN orders o ON o.user_id = u.id
        WHERE demo.user_id IS NULL
        GROUP BY u.id, u.public_id, u.email, u.display_name, u.phone_e164,
                 u.status, u.created_at
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT ${Number(query.limit)}`
    );
    res.set('Cache-Control', 'no-store').json({
      customers: rows.map((row) => ({
        id: row.public_id,
        email: row.email,
        displayName: row.display_name,
        name: row.display_name,
        phone: row.phone_e164,
        status: row.status,
        createdAt: iso(row.created_at),
        orderCount: Number(row.order_count),
        totalSpent: row.total_spent,
        lastOrderAt: nullableIso(row.last_order_at)
      }))
    });
  });

  router.patch('/orders/:orderId/status', requireAdminMutation, async (req, res) => {
    const orderId = publicIdSchema.parse(req.params.orderId);
    const input = orderStatusSchema.parse(req.body);
    const result = await transitionOrder(req.app.locals.db, req, orderId, input.status);
    res.set('Cache-Control', 'no-store').json(result);
  });

  router.patch('/orders/:orderId/payment', requireAdminMutation, async (req, res) => {
    const orderId = publicIdSchema.parse(req.params.orderId);
    const input = paymentStatusSchema.parse(req.body);
    const result = await transitionPayment(req.app.locals.db, req, orderId, input);
    res.set('Cache-Control', 'no-store').json(result);
  });

  router.patch('/returns/:returnId/status', requireAdminMutation, async (req, res) => {
    const returnId = publicIdSchema.parse(req.params.returnId);
    const input = returnStatusSchema.parse(req.body);
    const result = await transitionReturn(req.app.locals.db, req, returnId, input.status);
    res.set('Cache-Control', 'no-store').json(result);
  });

  return router;
}
