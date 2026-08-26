import { createHash, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/session.js';
import { releaseOrderInventory, reserveOrderInventory } from '../catalog/inventory.js';
import { databaseDateToIso, nullableDatabaseDateToIso } from '../db/date.js';
import { conflict, notFound } from '../http/errors.js';
import { centsToDecimal, decimalToCents } from '../money.js';
import { loadStoreDeliverySettings } from '../storefront/config.js';
import { createPricingQuote, pricingQuoteSchema, pricingQuotesEqual } from '../storefront/pricing.js';
import { publicIdSchema } from '../validation/common.js';

const checkoutSchema = z.object({
  addressId: publicIdSchema,
  pricing: pricingQuoteSchema,
  paymentMethod: z.enum(['cod', 'wafacash', 'cashplus']).default('cod'),
  note: z.union([z.string().trim().max(500), z.literal(''), z.null()]).transform((value) => value || null).optional()
}).strict();

const cancelSchema = z.object({
  reason: z.enum(['changed_mind', 'duplicate', 'wrong_address', 'delivery_time', 'other']).default('changed_mind'),
  details: z.union([z.string().trim().max(500), z.literal(''), z.null()]).transform((value) => value || null).optional()
}).strict();

const returnSchema = z.object({
  reason: z.enum(['damaged', 'wrong_item', 'not_as_described', 'quality', 'other']),
  details: z.union([z.string().trim().max(1000), z.literal(''), z.null()]).transform((value) => value || null).optional(),
  items: z.array(z.object({
    orderItemId: publicIdSchema,
    quantity: z.coerce.number().int().min(1).max(99),
    reason: z.string().trim().min(2).max(255).optional()
  }).strict()).min(1).max(50)
}).strict();

const orderCursorPayloadSchema = z.object({
  placedAt: z.string().datetime({ offset: true }),
  orderId: publicIdSchema
}).strict();

const RETURN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function orderDateToIso(value) {
  return databaseDateToIso(value);
}

function optionalOrderDateToIso(value) {
  return nullableDatabaseDateToIso(value);
}

export function returnWindowMetadata(status, deliveredAt, now = Date.now()) {
  if (!deliveredAt) return { returnEligible: false, returnDeadline: null };
  const deliveredAtMs = new Date(orderDateToIso(deliveredAt)).getTime();
  const returnDeadlineMs = deliveredAtMs + RETURN_WINDOW_MS;
  return {
    returnEligible: status === 'delivered' && now >= deliveredAtMs && now <= returnDeadlineMs,
    returnDeadline: new Date(returnDeadlineMs).toISOString()
  };
}

export function isReturnWindowOpen(deliveredAt, now = Date.now()) {
  return returnWindowMetadata('delivered', deliveredAt, now).returnEligible;
}

export function encodeOrderCursor({ placedAt, orderId }) {
  return Buffer.from(JSON.stringify({
    placedAt: orderDateToIso(placedAt),
    orderId: publicIdSchema.parse(orderId)
  })).toString('base64url');
}

export function decodeOrderCursor(value) {
  const text = z.string().trim().min(1).max(512).parse(value);
  // Continue accepting the original timestamp-only cursor during a rolling
  // deployment. New responses always use the stable composite cursor below.
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(text)) {
    return { placedAt: new Date(orderDateToIso(text)), orderId: null };
  }
  const payload = orderCursorPayloadSchema.parse(
    JSON.parse(Buffer.from(text, 'base64url').toString('utf8'))
  );
  return { placedAt: new Date(payload.placedAt), orderId: payload.orderId };
}

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.string().trim().min(1).max(512).transform((value, context) => {
    try {
      return decodeOrderCursor(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Invalid order cursor.' });
      return z.NEVER;
    }
  }).optional()
}).strip();

function requestDigest(input) {
  return createHash('sha256').update(JSON.stringify({
    addressId: input.addressId,
    pricing: input.pricing,
    paymentMethod: input.paymentMethod,
    note: input.note || null
  })).digest();
}

export function returnRequestDigest(orderId, input) {
  const items = input.items.map((item) => ({
    orderItemId: item.orderItemId,
    quantity: item.quantity,
    reason: item.reason || null
  })).sort((left, right) => left.orderItemId.localeCompare(right.orderItemId));
  return createHash('sha256').update(JSON.stringify({
    orderId,
    reason: input.reason,
    details: input.details || null,
    items
  })).digest();
}

function orderNumber() {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `AM-${day}-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
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

async function getOrder(database, userId, publicId) {
  const [rows] = await database.execute(
    `SELECT o.id, o.public_id, o.order_number, o.status, o.payment_method,
            o.payment_status, o.currency, o.subtotal, o.delivery_fee, o.total,
            o.note, o.placed_at, o.cancelled_at, o.delivered_at,
            a.recipient_name, a.phone_e164, a.email, a.address_line1, a.address_line2,
            a.district, a.city, a.postal_code, a.country_code, a.delivery_instructions
       FROM orders o
       JOIN order_addresses a ON a.order_id = o.id
      WHERE o.user_id = ? AND o.public_id = ? LIMIT 1`,
    [userId, publicId]
  );
  const order = rows[0];
  if (!order) throw notFound('ORDER_NOT_FOUND', 'The order was not found.');
  const [items] = await database.execute(
    `SELECT public_id, external_product_id, product_name, product_image_url,
            unit_price, quantity, line_total,
            COALESCE((
              SELECT SUM(ri.quantity)
                FROM return_items ri
                JOIN return_requests rr ON rr.id = ri.return_id
               WHERE ri.order_item_id = order_items.id
                 AND rr.status NOT IN ('rejected', 'cancelled')
            ), 0) AS returned_quantity
       FROM order_items WHERE order_id = ? ORDER BY line_no`,
    [order.id]
  );
  const [tracking] = await database.execute(
    `SELECT status, event_code, public_note, source, location, occurred_at
       FROM order_tracking_events WHERE order_id = ? ORDER BY occurred_at, id`,
    [order.id]
  );
  const [returns] = await database.execute(
    `SELECT public_id, status, reason_code, details, requested_at, updated_at
       FROM return_requests
      WHERE order_id = ? AND user_id = ?
      ORDER BY requested_at, id`,
    [order.id, userId]
  );
  const returnWindow = returnWindowMetadata(order.status, order.delivered_at);
  return {
    id: order.public_id,
    orderNumber: order.order_number,
    status: order.status,
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    currency: order.currency,
    subtotal: order.subtotal,
    deliveryFee: order.delivery_fee,
    total: order.total,
    note: order.note,
    placedAt: orderDateToIso(order.placed_at),
    cancelledAt: optionalOrderDateToIso(order.cancelled_at),
    deliveredAt: optionalOrderDateToIso(order.delivered_at),
    returnEligible: returnWindow.returnEligible,
    returnDeadline: returnWindow.returnDeadline,
    address: {
      recipientName: order.recipient_name,
      phone: order.phone_e164,
      email: order.email,
      addressLine1: order.address_line1,
      addressLine2: order.address_line2,
      district: order.district,
      city: order.city,
      postalCode: order.postal_code,
      country: order.country_code,
      deliveryInstructions: order.delivery_instructions
    },
    items: items.map((item) => ({
      id: item.public_id,
      productId: item.external_product_id,
      name: item.product_name,
      imageUrl: item.product_image_url,
      unitPrice: item.unit_price,
      quantity: item.quantity,
      returnedQuantity: Number(item.returned_quantity) || 0,
      lineTotal: item.line_total
    })),
    tracking: tracking.map((event) => ({
      status: event.status,
      code: event.event_code,
      message: event.public_note,
      source: event.source,
      location: event.location,
      occurredAt: orderDateToIso(event.occurred_at)
    })),
    returns: returns.map((request) => ({
      id: request.public_id,
      status: request.status,
      reason: request.reason_code,
      details: request.details,
      requestedAt: orderDateToIso(request.requested_at),
      updatedAt: orderDateToIso(request.updated_at)
    }))
  };
}

async function existingOrderForKey(database, userId, digest) {
  const [rows] = await database.execute(
    'SELECT public_id, request_digest FROM orders WHERE user_id = ? AND idempotency_digest = ? LIMIT 1',
    [userId, digest]
  );
  return rows[0] || null;
}

async function existingReturnForKey(database, userId, digest, { lock = false } = {}) {
  const [rows] = await database.execute(
    `SELECT rr.public_id, ri.request_digest
       FROM return_request_idempotency ri
       JOIN return_requests rr ON rr.id = ri.return_id
      WHERE ri.user_id = ? AND ri.key_digest = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [userId, digest]
  );
  return rows[0] || null;
}

async function returnSummary(database, userId, publicId) {
  const [rows] = await database.execute(
    `SELECT public_id, status, reason_code, details, requested_at, updated_at
       FROM return_requests WHERE public_id = ? AND user_id = ? LIMIT 1`,
    [publicId, userId]
  );
  if (!rows[0]) throw notFound('RETURN_NOT_FOUND', 'The return request was not found.');
  return {
    id: rows[0].public_id,
    status: rows[0].status,
    reason: rows[0].reason_code,
    details: rows[0].details,
    requestedAt: orderDateToIso(rows[0].requested_at),
    updatedAt: orderDateToIso(rows[0].updated_at)
  };
}

export function createOrdersRouter(catalog) {
  const router = Router();
  router.use(requireAuth);

  router.post('/', async (req, res) => {
    const input = checkoutSchema.parse(req.body);
    const idempotencyKey = req.get('idempotency-key');
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw conflict('IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.');
    }
    const idempotencyDigest = createHash('sha256').update(idempotencyKey).digest();
    const bodyDigest = requestDigest(input);
    const existing = await existingOrderForKey(req.app.locals.db, req.auth.userId, idempotencyDigest);
    if (existing) {
      if (!Buffer.from(existing.request_digest).equals(bodyDigest)) {
        throw conflict('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different checkout.');
      }
      return res.json({ order: await getOrder(req.app.locals.db, req.auth.userId, existing.public_id), replayed: true });
    }

    const [cartRows] = await req.app.locals.db.execute(
      'SELECT id, version FROM carts WHERE user_id = ? LIMIT 1',
      [req.auth.userId]
    );
    const cartSnapshot = cartRows[0];
    if (!cartSnapshot) throw notFound('CART_NOT_FOUND', 'The cart was not found.');
    const [itemRows] = await req.app.locals.db.execute(
      `SELECT ci.quantity, r.external_id
         FROM cart_items ci JOIN catalog_product_refs r ON r.id = ci.product_ref_id
        WHERE ci.cart_id = ? ORDER BY r.external_id`,
      [cartSnapshot.id]
    );
    if (!itemRows.length) {
      // A same-key request can commit after the fast idempotency lookup above
      // and clear the cart before this read. The committed order wins over the
      // now-empty cart for that caller-owned key.
      const replay = await existingOrderForKey(req.app.locals.db, req.auth.userId, idempotencyDigest);
      if (replay) {
        if (!Buffer.from(replay.request_digest).equals(bodyDigest)) {
          throw conflict('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different checkout.');
        }
        return res.json({ order: await getOrder(req.app.locals.db, req.auth.userId, replay.public_id), replayed: true });
      }
      throw conflict('CART_EMPTY', 'Your cart is empty.');
    }

    const verified = await Promise.all(itemRows.map(async (item) => ({
      quantity: item.quantity,
      product: await catalog.getProduct(item.external_id, { refresh: true })
    })));
    const unavailable = verified.filter(({ product, quantity }) =>
      !product.is_available ||
      (product.stock_quantity != null &&
        (!Number.isSafeInteger(product.stock_quantity) || quantity > product.stock_quantity))
    );
    if (unavailable.length) {
      throw conflict('CART_CHANGED', 'Some cart items are unavailable. Review your cart and try again.', {
        productIds: unavailable.map(({ product }) => product.id)
      });
    }
    const subtotalCents = verified.reduce((sum, item) => sum + item.product.priceCents * item.quantity, 0);
    const orderPublicId = randomUUID();
    let replayedPublicId = null;

    try {
      await inTransaction(req.app.locals.db, async (connection) => {
        // Serialize checkout on the user's cart before taking an absent-key
        // range lock. Otherwise two new same-key transactions can deadlock:
        // each holds the idempotency-index gap while one waits for the cart.
        const [lockedCarts] = await connection.execute(
          'SELECT id, version FROM carts WHERE user_id = ? LIMIT 1 FOR UPDATE',
          [req.auth.userId]
        );
        const [replayRows] = await connection.execute(
          'SELECT public_id, request_digest FROM orders WHERE user_id = ? AND idempotency_digest = ? LIMIT 1 FOR UPDATE',
          [req.auth.userId, idempotencyDigest]
        );
        if (replayRows[0]) {
          if (!Buffer.from(replayRows[0].request_digest).equals(bodyDigest)) {
            throw conflict('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different checkout.');
          }
          replayedPublicId = replayRows[0].public_id;
          return;
        }

        const cart = lockedCarts[0];
        if (!cart || cart.version !== cartSnapshot.version) {
          throw conflict('CART_CHANGED', 'Your cart changed during checkout. Review it and try again.');
        }
        const [lockedItems] = await connection.execute(
          `SELECT ci.quantity, r.external_id
             FROM cart_items ci JOIN catalog_product_refs r ON r.id = ci.product_ref_id
            WHERE ci.cart_id = ? ORDER BY r.external_id FOR UPDATE`,
          [cart.id]
        );
        if (JSON.stringify(lockedItems.map((item) => [item.external_id, item.quantity])) !==
            JSON.stringify(itemRows.map((item) => [item.external_id, item.quantity]))) {
          throw conflict('CART_CHANGED', 'Your cart changed during checkout. Review it and try again.');
        }
        const [addresses] = await connection.execute(
          `SELECT public_id, recipient_name, phone_e164, email, address_line1, address_line2,
                  district, city, postal_code, country_code, delivery_instructions
             FROM delivery_addresses
            WHERE public_id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
          [input.addressId, req.auth.userId]
        );
        const address = addresses[0];
        if (!address) throw notFound('ADDRESS_NOT_FOUND', 'The delivery address was not found.');

        const deliverySettings = await loadStoreDeliverySettings(connection, { forUpdate: true });
        const pricing = createPricingQuote(deliverySettings, subtotalCents);
        if (!pricingQuotesEqual(input.pricing, pricing)) {
          throw conflict('PRICING_CHANGED', 'Pricing changed during checkout. Review the new total and try again.');
        }
        const deliveryCents = pricing.deliveryFeeCents;

        const [orderInsert] = await connection.execute(
          `INSERT INTO orders
            (public_id, order_number, user_id, status, payment_method, payment_status,
             currency, subtotal, delivery_fee, total, cart_version, idempotency_digest,
             request_digest, note, placed_at)
           VALUES (?, ?, ?, 'confirmed', ?, 'pending', 'MAD', ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
          [orderPublicId, orderNumber(), req.auth.userId, input.paymentMethod,
            centsToDecimal(subtotalCents), centsToDecimal(deliveryCents), centsToDecimal(subtotalCents + deliveryCents),
            cart.version, idempotencyDigest, bodyDigest, input.note ?? null]
        );
        const orderId = orderInsert.insertId;
        const productRefs = await reserveOrderInventory(connection, orderId, verified);
        await connection.execute(
          `INSERT INTO order_addresses
            (order_id, source_address_public_id, recipient_name, phone_e164, email,
             address_line1, address_line2, district, city, postal_code, country_code, delivery_instructions)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [orderId, address.public_id, address.recipient_name, address.phone_e164, address.email,
            address.address_line1, address.address_line2, address.district, address.city,
            address.postal_code, address.country_code, address.delivery_instructions]
        );
        for (let index = 0; index < verified.length; index += 1) {
          const { product, quantity } = verified[index];
          await connection.execute(
            `INSERT INTO order_items
              (public_id, order_id, line_no, product_ref_id, external_product_id, product_name,
               product_brand, product_sku, product_image_url, unit_price, quantity)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [randomUUID(), orderId, index + 1, productRefs.get(product.id), product.id, product.name,
              product.brand_name ? String(product.brand_name).slice(0, 160) : null,
              product.sku ? String(product.sku).slice(0, 120) : null,
              product.image_url || null, product.price, quantity]
          );
        }
        await connection.execute(
          `INSERT INTO order_tracking_events
            (order_id, status, event_code, source, public_note, occurred_at)
           VALUES (?, 'confirmed', 'order_confirmed', 'system', 'Your order has been confirmed.', UTC_TIMESTAMP(3))`,
          [orderId]
        );
        const notificationPublicId = randomUUID();
        await connection.execute(
          `INSERT INTO notifications
            (public_id, user_id, type, order_id, dedupe_key, payload)
            SELECT ?, ?, 'order_confirmed', ?, ?, JSON_OBJECT('orderId', ?, 'status', 'confirmed')
              FROM user_preferences WHERE user_id = ? AND order_notifications = 1`,
          [notificationPublicId, req.auth.userId, orderId, `order:${orderPublicId}:confirmed`, orderPublicId, req.auth.userId]
        );
        await connection.execute(
          `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
           VALUES ('order', ?, 'order.confirmed', JSON_OBJECT('orderId', ?, 'userId', ?))`,
          [String(orderId), orderPublicId, req.auth.userId]
        );
        await connection.execute('DELETE FROM cart_items WHERE cart_id = ?', [cart.id]);
        await connection.execute('UPDATE carts SET version = version + 1 WHERE id = ?', [cart.id]);
      });
    } catch (error) {
      // A concurrent retry can observe the old cart and then wait behind the
      // first transaction. Once that transaction commits, the order—not the
      // now-empty cart—is the source of truth for this caller-owned key.
      const replay = await existingOrderForKey(req.app.locals.db, req.auth.userId, idempotencyDigest);
      if (replay && Buffer.from(replay.request_digest).equals(bodyDigest)) {
        replayedPublicId = replay.public_id;
      } else if (error?.code === 'ER_DUP_ENTRY' || replay) {
        throw conflict('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different checkout.');
      } else {
        throw error;
      }
    }

    const publicId = replayedPublicId || orderPublicId;
    res.status(replayedPublicId ? 200 : 201).json({
      order: await getOrder(req.app.locals.db, req.auth.userId, publicId),
      replayed: Boolean(replayedPublicId)
    });
  });

  router.get('/', async (req, res) => {
    const query = listSchema.parse(req.query);
    const params = [req.auth.userId];
    let beforeSql = '';
    if (query.before?.orderId) {
      beforeSql = ' AND (placed_at < ? OR (placed_at = ? AND public_id < ?))';
      params.push(query.before.placedAt, query.before.placedAt, query.before.orderId);
    } else if (query.before) {
      beforeSql = ' AND placed_at < ?';
      params.push(query.before.placedAt);
    }
    const [rows] = await req.app.locals.db.execute(
      `SELECT public_id, order_number, status, payment_method, payment_status,
              currency, subtotal, delivery_fee, total, placed_at, cancelled_at, delivered_at
         FROM orders WHERE user_id = ?${beforeSql}
        ORDER BY placed_at DESC, public_id DESC LIMIT ${query.limit + 1}`,
      params
    );
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const returnWindowNow = Date.now();
    res.json({
      orders: page.map((row) => {
        const returnWindow = returnWindowMetadata(row.status, row.delivered_at, returnWindowNow);
        return {
          id: row.public_id, orderNumber: row.order_number, status: row.status,
          paymentMethod: row.payment_method, paymentStatus: row.payment_status,
          currency: row.currency, subtotal: row.subtotal, deliveryFee: row.delivery_fee,
          total: row.total, placedAt: orderDateToIso(row.placed_at),
          cancelledAt: optionalOrderDateToIso(row.cancelled_at),
          deliveredAt: optionalOrderDateToIso(row.delivered_at),
          returnEligible: returnWindow.returnEligible,
          returnDeadline: returnWindow.returnDeadline
        };
      }),
      nextCursor: hasMore ? encodeOrderCursor({
        placedAt: page.at(-1).placed_at,
        orderId: page.at(-1).public_id
      }) : null
    });
  });

  router.get('/:orderId', async (req, res) => {
    const orderId = publicIdSchema.parse(req.params.orderId);
    res.json({ order: await getOrder(req.app.locals.db, req.auth.userId, orderId) });
  });

  router.get('/:orderId/tracking', async (req, res) => {
    const orderId = publicIdSchema.parse(req.params.orderId);
    const order = await getOrder(req.app.locals.db, req.auth.userId, orderId);
    res.json({ orderId: order.id, status: order.status, events: order.tracking });
  });

  router.post('/:orderId/cancel', async (req, res) => {
    const orderPublicId = publicIdSchema.parse(req.params.orderId);
    const input = cancelSchema.parse(req.body);
    await inTransaction(req.app.locals.db, async (connection) => {
      const [rows] = await connection.execute(
        'SELECT id, status FROM orders WHERE public_id = ? AND user_id = ? LIMIT 1 FOR UPDATE',
        [orderPublicId, req.auth.userId]
      );
      const order = rows[0];
      if (!order) throw notFound('ORDER_NOT_FOUND', 'The order was not found.');
      if (!['confirmed', 'preparing'].includes(order.status)) {
        throw conflict('ORDER_CANNOT_BE_CANCELLED', 'This order can no longer be cancelled.');
      }
      await connection.execute(
        `UPDATE orders SET status = 'cancelled', cancelled_at = UTC_TIMESTAMP(3), version = version + 1 WHERE id = ?`,
        [order.id]
      );
      await releaseOrderInventory(connection, order.id);
      await connection.execute(
        `INSERT INTO order_cancellations
          (order_id, user_id, status, reason_code, details, processed_at)
         VALUES (?, ?, 'accepted', ?, ?, UTC_TIMESTAMP(3))`,
        [order.id, req.auth.userId, input.reason, input.details ?? null]
      );
      await connection.execute(
        `INSERT INTO order_tracking_events
          (order_id, status, event_code, source, public_note, occurred_at)
         VALUES (?, 'cancelled', 'order_cancelled', 'customer', 'The order was cancelled.', UTC_TIMESTAMP(3))`,
        [order.id]
      );
      await connection.execute(
        `INSERT INTO notifications (public_id, user_id, type, order_id, dedupe_key, payload)
         SELECT ?, ?, 'order_cancelled', ?, ?, JSON_OBJECT('orderId', ?, 'status', 'cancelled')
           FROM user_preferences WHERE user_id = ? AND order_notifications = 1`,
        [randomUUID(), req.auth.userId, order.id, `order:${orderPublicId}:cancelled`, orderPublicId, req.auth.userId]
      );
      await connection.execute(
        `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
         VALUES ('order', ?, 'order.cancelled', JSON_OBJECT(
           'orderId', ?, 'userId', ?, 'previousStatus', ?,
           'status', 'cancelled', 'reason', ?
         ))`,
        [String(order.id), orderPublicId, req.auth.userId, order.status, input.reason]
      );
    });
    res.json({ order: await getOrder(req.app.locals.db, req.auth.userId, orderPublicId) });
  });

  router.post('/:orderId/returns', async (req, res) => {
    const orderPublicId = publicIdSchema.parse(req.params.orderId);
    const input = returnSchema.parse(req.body);
    const idempotencyKey = req.get('idempotency-key');
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw conflict('IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.');
    }
    const idempotencyDigest = createHash('sha256').update(idempotencyKey).digest();
    const bodyDigest = returnRequestDigest(orderPublicId, input);
    const existing = await existingReturnForKey(req.app.locals.db, req.auth.userId, idempotencyDigest);
    if (existing) {
      if (!Buffer.from(existing.request_digest).equals(bodyDigest)) {
        throw conflict('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different return request.');
      }
      return res.json({
        return: await returnSummary(req.app.locals.db, req.auth.userId, existing.public_id),
        replayed: true
      });
    }

    const returnPublicId = randomUUID();
    let replayedPublicId = null;
    try {
      await inTransaction(req.app.locals.db, async (connection) => {
        const [orderRows] = await connection.execute(
          `SELECT id, status, delivered_at FROM orders
            WHERE public_id = ? AND user_id = ? LIMIT 1 FOR UPDATE`,
          [orderPublicId, req.auth.userId]
        );
        const order = orderRows[0];
        if (!order) throw notFound('ORDER_NOT_FOUND', 'The order was not found.');

        const lockedExisting = await existingReturnForKey(connection, req.auth.userId, idempotencyDigest, { lock: true });
        if (lockedExisting) {
          if (!Buffer.from(lockedExisting.request_digest).equals(bodyDigest)) {
            throw conflict('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different return request.');
          }
          replayedPublicId = lockedExisting.public_id;
          return;
        }

        if (!returnWindowMetadata(order.status, order.delivered_at).returnEligible) {
          throw conflict('RETURN_WINDOW_CLOSED', 'Returns are available for seven days after delivery.');
        }
        const ids = input.items.map((item) => item.orderItemId);
        const placeholders = ids.map(() => '?').join(',');
        const [orderItems] = await connection.execute(
          `SELECT id, public_id, quantity FROM order_items
            WHERE order_id = ? AND public_id IN (${placeholders}) FOR UPDATE`,
          [order.id, ...ids]
        );
        if (orderItems.length !== ids.length) throw conflict('RETURN_ITEMS_INVALID', 'One or more return items are invalid.');
        const [prior] = await connection.execute(
          `SELECT ri.order_item_id, COALESCE(SUM(ri.quantity), 0) AS returned_quantity
             FROM return_items ri JOIN return_requests rr ON rr.id = ri.return_id
            WHERE rr.order_id = ? AND rr.status NOT IN ('rejected', 'cancelled')
            GROUP BY ri.order_item_id FOR UPDATE`,
          [order.id]
        );
        const returned = new Map(prior.map((row) => [String(row.order_item_id), Number(row.returned_quantity)]));
        for (const item of input.items) {
          const source = orderItems.find((row) => row.public_id === item.orderItemId);
          if (item.quantity + (returned.get(String(source.id)) || 0) > source.quantity) {
            throw conflict('RETURN_QUANTITY_INVALID', 'A return quantity exceeds the purchased quantity.');
          }
        }
        const [insert] = await connection.execute(
          `INSERT INTO return_requests
            (public_id, order_id, user_id, status, reason_code, details)
           VALUES (?, ?, ?, 'requested', ?, ?)`,
          [returnPublicId, order.id, req.auth.userId, input.reason, input.details ?? null]
        );
        await connection.execute(
          `INSERT INTO return_request_idempotency
            (user_id, key_digest, request_digest, return_id)
           VALUES (?, ?, ?, ?)`,
          [req.auth.userId, idempotencyDigest, bodyDigest, insert.insertId]
        );
        for (const item of input.items) {
          const source = orderItems.find((row) => row.public_id === item.orderItemId);
          await connection.execute(
            'INSERT INTO return_items (return_id, order_item_id, quantity, reason) VALUES (?, ?, ?, ?)',
            [insert.insertId, source.id, item.quantity, item.reason || input.reason]
          );
        }
        await connection.execute(
          `INSERT INTO notifications (public_id, user_id, type, order_id, dedupe_key, payload)
           SELECT ?, ?, 'return_requested', ?, ?, JSON_OBJECT('orderId', ?, 'returnId', ?)
             FROM user_preferences WHERE user_id = ? AND order_notifications = 1`,
          [randomUUID(), req.auth.userId, order.id, `return:${returnPublicId}:requested`, orderPublicId, returnPublicId, req.auth.userId]
        );
      });
    } catch (error) {
      const replay = await existingReturnForKey(req.app.locals.db, req.auth.userId, idempotencyDigest);
      if (replay && Buffer.from(replay.request_digest).equals(bodyDigest)) {
        replayedPublicId = replay.public_id;
      } else if (error?.code === 'ER_DUP_ENTRY' || replay) {
        throw conflict('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different return request.');
      } else {
        throw error;
      }
    }

    const publicId = replayedPublicId || returnPublicId;
    res.status(replayedPublicId ? 200 : 201).json({
      return: await returnSummary(req.app.locals.db, req.auth.userId, publicId),
      replayed: Boolean(replayedPublicId)
    });
  });

  return router;
}

export function createReturnsRouter() {
  const router = Router();
  router.use(requireAuth);
  router.get('/:returnId', async (req, res) => {
    const returnId = publicIdSchema.parse(req.params.returnId);
    const [rows] = await req.app.locals.db.execute(
      `SELECT rr.id, rr.public_id, rr.status, rr.reason_code, rr.details,
              rr.requested_at, rr.updated_at, o.public_id AS order_public_id
         FROM return_requests rr JOIN orders o ON o.id = rr.order_id
        WHERE rr.public_id = ? AND rr.user_id = ? LIMIT 1`,
      [returnId, req.auth.userId]
    );
    if (!rows[0]) throw notFound('RETURN_NOT_FOUND', 'The return request was not found.');
    const row = rows[0];
    const [items] = await req.app.locals.db.execute(
      `SELECT oi.public_id AS order_item_id, oi.external_product_id, oi.product_name,
              ri.quantity, ri.reason
         FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
        WHERE ri.return_id = ?`,
      [row.id]
    );
    res.json({ return: {
      id: row.public_id, orderId: row.order_public_id, status: row.status,
      reason: row.reason_code, details: row.details,
      requestedAt: orderDateToIso(row.requested_at),
      updatedAt: orderDateToIso(row.updated_at),
      items: items.map((item) => ({ orderItemId: item.order_item_id, productId: item.external_product_id, name: item.product_name, quantity: item.quantity, reason: item.reason }))
    } });
  });
  return router;
}
