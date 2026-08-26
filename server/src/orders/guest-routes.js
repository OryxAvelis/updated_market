import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { reserveOrderInventory } from '../catalog/inventory.js';
import { config } from '../config.js';
import { databaseDateToIso, nullableDatabaseDateToIso } from '../db/date.js';
import { ApiError, badRequest, conflict, notFound } from '../http/errors.js';
import { centsToDecimal } from '../money.js';
import { loadStoreDeliverySettings } from '../storefront/config.js';
import { createPricingQuote, pricingQuoteSchema, pricingQuotesEqual } from '../storefront/pricing.js';
import { MySqlRateLimitStore } from '../security/mysql-rate-limit-store.js';
import { tokenDigest } from '../security/tokens.js';
import {
  displayNameSchema,
  emailSchema,
  phoneSchema,
  productIdSchema,
  publicIdSchema
} from '../validation/common.js';

const guestOrderTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const RETURN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CLAIM_POLL_MS = 40;

function databaseTimeMs(value) {
  return Date.parse(databaseDateToIso(value));
}

const nullableShortText = (maximum) => z.union([
  z.string().trim().max(maximum),
  z.literal(''),
  z.null()
]).transform((value) => value || null).optional();

const deliverySchema = z.object({
  recipientName: displayNameSchema,
  phone: phoneSchema,
  email: z.union([emailSchema, z.literal(''), z.null()]).transform((value) => value || null).optional(),
  addressLine1: z.string().trim().min(4).max(255),
  addressLine2: nullableShortText(255),
  district: z.string().trim().min(2).max(100),
  city: z.string().trim().min(2).max(100),
  postalCode: nullableShortText(20),
  country: z.literal('MA').default('MA'),
  deliveryInstructions: nullableShortText(500)
}).strict();

const guestCheckoutSchema = z.object({
  items: z.array(z.object({
    productId: productIdSchema,
    quantity: z.coerce.number().int().min(1).max(99)
  }).strict()).min(1).max(100).superRefine((items, context) => {
    const seen = new Set();
    items.forEach((item, index) => {
      if (seen.has(item.productId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'productId'],
          message: 'Each product may appear only once.'
        });
      }
      seen.add(item.productId);
    });
  }),
  pricing: pricingQuoteSchema,
  delivery: deliverySchema,
  paymentMethod: z.enum(['cod', 'wafacash', 'cashplus']).default('cod'),
  note: nullableShortText(500)
}).strict();

function sameDigest(left, right) {
  if (!left || !right) return false;
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && first.equals(second);
}

export function guestCheckoutRequestDigest(input) {
  const items = [...input.items]
    .map((item) => ({ productId: item.productId, quantity: item.quantity }))
    .sort((left, right) => left.productId.localeCompare(right.productId));
  const delivery = {
    recipientName: input.delivery.recipientName,
    phone: input.delivery.phone,
    email: input.delivery.email ?? null,
    addressLine1: input.delivery.addressLine1,
    addressLine2: input.delivery.addressLine2 ?? null,
    district: input.delivery.district,
    city: input.delivery.city,
    postalCode: input.delivery.postalCode ?? null,
    country: input.delivery.country,
    deliveryInstructions: input.delivery.deliveryInstructions ?? null
  };
  return createHash('sha256').update(JSON.stringify({
    items,
    pricing: input.pricing,
    delivery,
    paymentMethod: input.paymentMethod,
    note: input.note ?? null
  })).digest();
}

export function validGuestOrderToken(value) {
  if (typeof value !== 'string' || !guestOrderTokenPattern.test(value)) return false;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.length === 32 && decoded.toString('base64url') === value;
}

function requireGuestToken(req, { concealFailure = false } = {}) {
  const rawToken = req.get('x-guest-order-token');
  if (!validGuestOrderToken(rawToken)) {
    if (concealFailure) throw notFound('ORDER_NOT_FOUND', 'The order was not found.');
    throw badRequest('GUEST_ORDER_TOKEN_REQUIRED', 'A valid guest order token is required.');
  }
  return tokenDigest(rawToken);
}

function requireIdempotencyKey(req) {
  const key = req.get('idempotency-key');
  if (!key || key.length < 8 || key.length > 128) {
    throw conflict('IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.');
  }
  return createHash('sha256').update(key).digest();
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

function returnWindowMetadata(status, deliveredAt, now = Date.now()) {
  if (!deliveredAt) return { returnEligible: false, returnDeadline: null };
  const deliveredAtMs = new Date(databaseDateToIso(deliveredAt)).getTime();
  const returnDeadlineMs = deliveredAtMs + RETURN_WINDOW_MS;
  return {
    returnEligible: status === 'delivered' && now >= deliveredAtMs && now <= returnDeadlineMs,
    returnDeadline: new Date(returnDeadlineMs).toISOString()
  };
}

async function getGuestOrder(database, accessDigest, publicId) {
  const [rows] = await database.execute(
    `SELECT o.id, o.public_id, o.order_number, o.status, o.payment_method,
            o.payment_status, o.currency, o.subtotal, o.delivery_fee, o.total,
            o.note, o.placed_at, o.cancelled_at, o.delivered_at,
            o.guest_access_expires_at,
            a.recipient_name, a.phone_e164, a.email, a.address_line1, a.address_line2,
            a.district, a.city, a.postal_code, a.country_code, a.delivery_instructions
       FROM orders o
       JOIN order_addresses a ON a.order_id = o.id
      WHERE o.user_id IS NULL
        AND o.guest_access_digest = ?
        AND o.public_id = ?
        AND o.guest_access_revoked_at IS NULL
        AND o.guest_access_expires_at > UTC_TIMESTAMP(3)
      LIMIT 1`,
    [accessDigest, publicId]
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
    placedAt: databaseDateToIso(order.placed_at),
    cancelledAt: nullableDatabaseDateToIso(order.cancelled_at),
    deliveredAt: nullableDatabaseDateToIso(order.delivered_at),
    accessExpiresAt: databaseDateToIso(order.guest_access_expires_at),
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
      occurredAt: databaseDateToIso(event.occurred_at)
    }))
  };
}

async function issueGuestCheckoutAccess(database) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomBytes(32).toString('base64url');
    const idempotencyKey = randomUUID();
    const expiresAt = new Date(Date.now() + config.guestCheckout.credentialTtlMs);
    try {
      await database.execute(
        `INSERT INTO guest_checkout_claims
          (access_digest, idempotency_digest, access_expires_at)
         VALUES (?, ?, ?)`,
        [tokenDigest(token), createHash('sha256').update(idempotencyKey).digest(), expiresAt]
      );
      return { token, idempotencyKey, expiresAt: expiresAt.toISOString() };
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY' || attempt === 2) throw error;
    }
  }
  throw new Error('Unable to issue a unique guest checkout credential.');
}

function credentialCollision() {
  return conflict(
    'GUEST_CHECKOUT_CREDENTIALS_REUSED',
    'The guest checkout credentials were already used for a different checkout.'
  );
}

function invalidCredential() {
  return badRequest(
    'GUEST_CHECKOUT_ACCESS_INVALID',
    'Request a new guest checkout access credential and try again.'
  );
}

async function acquireCheckoutClaim(database, accessDigest, idempotencyDigest, requestDigest) {
  const leaseDigest = randomBytes(32);
  return inTransaction(database, async (connection) => {
    const [rows] = await connection.execute(
      `SELECT c.id, c.access_digest, c.idempotency_digest, c.request_digest,
              c.state, c.lease_expires_at, c.access_expires_at, o.public_id
         FROM guest_checkout_claims c
         LEFT JOIN orders o ON o.id = c.order_id
        WHERE c.access_digest = ? OR c.idempotency_digest = ?
        LIMIT 2 FOR UPDATE`,
      [accessDigest, idempotencyDigest]
    );
    const claim = rows.find((row) =>
      sameDigest(row.access_digest, accessDigest) &&
      sameDigest(row.idempotency_digest, idempotencyDigest)
    );
    if (!claim) {
      if (rows.length) throw credentialCollision();
      throw invalidCredential();
    }
    if (claim.request_digest && !sameDigest(claim.request_digest, requestDigest)) {
      throw credentialCollision();
    }
    if (claim.state === 'completed') {
      if (!claim.public_id) throw invalidCredential();
      return { mode: 'completed', claimId: claim.id, publicId: claim.public_id };
    }
    if (databaseTimeMs(claim.access_expires_at) <= Date.now()) throw invalidCredential();
    if (claim.state === 'processing' &&
        databaseTimeMs(claim.lease_expires_at) > Date.now()) {
      return { mode: 'waiting', claimId: claim.id };
    }
    const leaseExpiresAt = new Date(Date.now() + config.guestCheckout.leaseMs);
    const [updated] = await connection.execute(
      `UPDATE guest_checkout_claims
          SET request_digest = ?, state = 'processing', lease_digest = ?,
              lease_expires_at = ?, failure_code = NULL, failure_status = NULL,
              failure_message = NULL, failure_details = NULL, completed_at = NULL
        WHERE id = ?`,
      [requestDigest, leaseDigest, leaseExpiresAt, claim.id]
    );
    if (updated.affectedRows !== 1) throw invalidCredential();
    return { mode: 'worker', claimId: claim.id, leaseDigest };
  });
}

function failureFromClaim(row) {
  let details = row.failure_details ?? undefined;
  if (typeof details === 'string') {
    try {
      details = JSON.parse(details);
    } catch {
      details = undefined;
    }
  }
  return new ApiError(
    Number(row.failure_status) || 500,
    row.failure_code || 'INTERNAL_ERROR',
    row.failure_message || 'Something went wrong. Please try again.',
    details
  );
}

async function waitForCheckoutClaim(database, claimId) {
  const deadline = Date.now() + config.guestCheckout.waitMs;
  do {
    await new Promise((resolve) => setTimeout(resolve, CLAIM_POLL_MS));
    const [rows] = await database.execute(
      `SELECT c.state, c.lease_expires_at, c.failure_code, c.failure_status,
              c.failure_message, c.failure_details, o.public_id
         FROM guest_checkout_claims c
         LEFT JOIN orders o ON o.id = c.order_id
        WHERE c.id = ? LIMIT 1`,
      [claimId]
    );
    const claim = rows[0];
    if (!claim) throw invalidCredential();
    if (claim.state === 'completed' && claim.public_id) {
      return { mode: 'completed', claimId, publicId: claim.public_id };
    }
    if (claim.state === 'failed') throw failureFromClaim(claim);
    if (claim.state !== 'processing' ||
        databaseTimeMs(claim.lease_expires_at) <= Date.now()) {
      return { mode: 'retry', claimId };
    }
  } while (Date.now() < deadline);
  throw conflict(
    'GUEST_CHECKOUT_IN_PROGRESS',
    'This checkout is still being processed. Retry with the same credentials.'
  );
}

function safeFailure(error) {
  if (error instanceof ApiError) {
    return {
      code: String(error.code).slice(0, 80),
      status: Number(error.status),
      message: String(error.message).slice(0, 255),
      details: error.details === undefined ? null : JSON.stringify(error.details)
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    status: 500,
    message: 'Something went wrong. Please try again.',
    details: null
  };
}

async function markCheckoutClaimFailed(database, claim, error) {
  const failure = safeFailure(error);
  const [result] = await database.execute(
    `UPDATE guest_checkout_claims
        SET state = 'failed', lease_digest = NULL, lease_expires_at = NULL,
            failure_code = ?, failure_status = ?, failure_message = ?,
            failure_details = ?
      WHERE id = ? AND state = 'processing' AND lease_digest = ?`,
    [failure.code, failure.status, failure.message, failure.details,
      claim.claimId, claim.leaseDigest]
  );
  return result.affectedRows === 1;
}

async function verifyProducts(catalog, items) {
  const verified = await Promise.all(items.map(async (item) => ({
    quantity: item.quantity,
    product: await catalog.getProduct(item.productId, { refresh: true })
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
  return verified;
}

function createLimiter(database, { scope, windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message } },
    ...(config.isProduction ? {
      store: new MySqlRateLimitStore(database, { scope, windowMs })
    } : {})
  });
}

async function createGuestOrder(database, claim, accessDigest, idempotencyDigest, bodyDigest, input, verified) {
  const subtotalCents = verified.reduce(
    (sum, item) => sum + item.product.priceCents * item.quantity,
    0
  );
  const orderPublicId = randomUUID();
  const accessExpiresAt = new Date(Date.now() + config.guestCheckout.orderAccessTtlMs);
  await inTransaction(database, async (connection) => {
    const [claimRows] = await connection.execute(
      `SELECT state, lease_digest
         FROM guest_checkout_claims
        WHERE id = ? LIMIT 1 FOR UPDATE`,
      [claim.claimId]
    );
    const lockedClaim = claimRows[0];
    if (!lockedClaim || lockedClaim.state !== 'processing' ||
        !sameDigest(lockedClaim.lease_digest, claim.leaseDigest)) {
      throw conflict(
        'GUEST_CHECKOUT_IN_PROGRESS',
        'This checkout is already being processed. Retry with the same credentials.'
      );
    }
    const deliverySettings = await loadStoreDeliverySettings(connection, { forUpdate: true });
    const pricing = createPricingQuote(deliverySettings, subtotalCents);
    if (!pricingQuotesEqual(input.pricing, pricing)) {
      throw conflict('PRICING_CHANGED', 'Pricing changed during checkout. Review the new total and try again.');
    }
    const deliveryCents = pricing.deliveryFeeCents;
    const [orderInsert] = await connection.execute(
      `INSERT INTO orders
        (public_id, order_number, user_id, guest_access_digest,
         guest_access_expires_at, status, payment_method, payment_status,
         currency, subtotal, delivery_fee, total, cart_version,
         idempotency_digest, guest_idempotency_digest, request_digest,
         note, placed_at)
       VALUES (?, ?, NULL, ?, ?, 'confirmed', ?, 'pending', 'MAD', ?, ?, ?,
               NULL, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [orderPublicId, orderNumber(), accessDigest, accessExpiresAt, input.paymentMethod,
        centsToDecimal(subtotalCents), centsToDecimal(deliveryCents),
        centsToDecimal(subtotalCents + deliveryCents), idempotencyDigest,
        idempotencyDigest, bodyDigest, input.note ?? null]
    );
    const orderId = orderInsert.insertId;
    const productRefs = await reserveOrderInventory(connection, orderId, verified);
    const delivery = input.delivery;
    await connection.execute(
      `INSERT INTO order_addresses
        (order_id, source_address_public_id, recipient_name, phone_e164, email,
         address_line1, address_line2, district, city, postal_code,
         country_code, delivery_instructions)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, delivery.recipientName, delivery.phone, delivery.email ?? null,
        delivery.addressLine1, delivery.addressLine2 ?? null, delivery.district,
        delivery.city, delivery.postalCode ?? null, delivery.country,
        delivery.deliveryInstructions ?? null]
    );
    for (let index = 0; index < verified.length; index += 1) {
      const { product, quantity } = verified[index];
      await connection.execute(
        `INSERT INTO order_items
          (public_id, order_id, line_no, product_ref_id, external_product_id,
           product_name, product_brand, product_sku, product_image_url, unit_price, quantity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), orderId, index + 1, productRefs.get(product.id), product.id,
          product.name,
          product.brand_name ? String(product.brand_name).slice(0, 160) : null,
          product.sku ? String(product.sku).slice(0, 120) : null,
          product.image_url || null, product.price, quantity]
      );
    }
    await connection.execute(
      `INSERT INTO order_tracking_events
        (order_id, status, event_code, source, public_note, occurred_at)
       VALUES (?, 'confirmed', 'order_confirmed', 'system',
               'Your order has been confirmed.', UTC_TIMESTAMP(3))`,
      [orderId]
    );
    await connection.execute(
      `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
       VALUES ('order', ?, 'order.confirmed', JSON_OBJECT(
         'orderId', ?, 'userId', NULL, 'customerType', 'guest'
       ))`,
      [String(orderId), orderPublicId]
    );
    const [completed] = await connection.execute(
      `UPDATE guest_checkout_claims
          SET state = 'completed', lease_digest = NULL, lease_expires_at = NULL,
              order_id = ?, failure_code = NULL, failure_status = NULL,
              failure_message = NULL, failure_details = NULL,
              completed_at = UTC_TIMESTAMP(3)
        WHERE id = ? AND state = 'processing' AND lease_digest = ?`,
      [orderId, claim.claimId, claim.leaseDigest]
    );
    if (completed.affectedRows !== 1) {
      throw conflict('GUEST_CHECKOUT_IN_PROGRESS', 'This checkout is already being processed.');
    }
  });
  return orderPublicId;
}

export function createGuestOrdersRouter(catalog, { database } = {}) {
  const router = Router();
  const checkoutLimiter = createLimiter(database, {
    scope: 'guest-checkout', windowMs: 15 * 60 * 1000, limit: 12,
    message: 'Too many checkout attempts. Please wait and try again.'
  });
  const accessLimiter = createLimiter(database, {
    scope: 'guest-checkout-access', windowMs: 15 * 60 * 1000, limit: 20,
    message: 'Too many checkout access requests. Please wait and try again.'
  });
  const lookupLimiter = createLimiter(database, {
    scope: 'guest-order-lookup', windowMs: 15 * 60 * 1000, limit: 120,
    message: 'Too many order lookup attempts. Please wait and try again.'
  });

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.post('/access', accessLimiter, async (req, res) => {
    const access = await issueGuestCheckoutAccess(req.app.locals.db);
    return res.status(201).json({ access });
  });

  router.post('/', checkoutLimiter, async (req, res) => {
    const input = guestCheckoutSchema.parse(req.body);
    const accessDigest = requireGuestToken(req);
    const idempotencyDigest = requireIdempotencyKey(req);
    const bodyDigest = guestCheckoutRequestDigest(input);
    let claim = await acquireCheckoutClaim(
      req.app.locals.db,
      accessDigest,
      idempotencyDigest,
      bodyDigest
    );

    while (claim.mode === 'waiting' || claim.mode === 'retry') {
      claim = claim.mode === 'waiting'
        ? await waitForCheckoutClaim(req.app.locals.db, claim.claimId)
        : await acquireCheckoutClaim(
          req.app.locals.db,
          accessDigest,
          idempotencyDigest,
          bodyDigest
        );
    }
    if (claim.mode === 'completed') {
      return res.json({
        order: await getGuestOrder(req.app.locals.db, accessDigest, claim.publicId),
        replayed: true
      });
    }

    let publicId;
    try {
      const verified = await verifyProducts(catalog, input.items);
      publicId = await createGuestOrder(
        req.app.locals.db,
        claim,
        accessDigest,
        idempotencyDigest,
        bodyDigest,
        input,
        verified
      );
    } catch (error) {
      const marked = await markCheckoutClaimFailed(req.app.locals.db, claim, error);
      if (!marked) {
        const recovered = await waitForCheckoutClaim(req.app.locals.db, claim.claimId);
        if (recovered.mode === 'completed') {
          return res.json({
            order: await getGuestOrder(req.app.locals.db, accessDigest, recovered.publicId),
            replayed: true
          });
        }
      }
      throw error;
    }

    return res.status(201).json({
      order: await getGuestOrder(req.app.locals.db, accessDigest, publicId),
      replayed: false
    });
  });

  router.delete('/:orderId/access', lookupLimiter, async (req, res) => {
    const accessDigest = requireGuestToken(req, { concealFailure: true });
    const orderId = publicIdSchema.parse(req.params.orderId);
    const [result] = await req.app.locals.db.execute(
      `UPDATE orders
          SET guest_access_revoked_at = UTC_TIMESTAMP(3)
        WHERE user_id IS NULL
          AND public_id = ?
          AND guest_access_digest = ?
          AND guest_access_revoked_at IS NULL
          AND guest_access_expires_at > UTC_TIMESTAMP(3)`,
      [orderId, accessDigest]
    );
    if (result.affectedRows !== 1) throw notFound('ORDER_NOT_FOUND', 'The order was not found.');
    return res.status(204).send();
  });

  router.get('/:orderId/tracking', lookupLimiter, async (req, res) => {
    const accessDigest = requireGuestToken(req, { concealFailure: true });
    const orderId = publicIdSchema.parse(req.params.orderId);
    const order = await getGuestOrder(req.app.locals.db, accessDigest, orderId);
    return res.json({
      orderId: order.id,
      status: order.status,
      events: order.tracking
    });
  });

  router.get('/:orderId', lookupLimiter, async (req, res) => {
    const accessDigest = requireGuestToken(req, { concealFailure: true });
    const orderId = publicIdSchema.parse(req.params.orderId);
    return res.json({
      order: await getGuestOrder(req.app.locals.db, accessDigest, orderId)
    });
  });

  return router;
}
