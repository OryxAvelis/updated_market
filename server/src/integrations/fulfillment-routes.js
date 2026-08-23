import { createHash, randomUUID } from 'node:crypto';
import { Router, raw } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { ApiError, badRequest, conflict, notFound, unavailable } from '../http/errors.js';
import { publicIdSchema } from '../validation/common.js';
import { authenticateFulfillmentWebhook } from './fulfillment-auth.js';

const statusSchema = z.enum(['preparing', 'shipping', 'delivered']);
const eventSchema = z.object({
  type: z.literal('order.status.updated'),
  orderId: publicIdSchema,
  status: statusSchema,
  occurredAt: z.string().datetime({ offset: true }).optional(),
  location: z.union([z.string().trim().min(1).max(255), z.literal(''), z.null()])
    .transform((value) => value || null)
    .optional(),
  note: z.union([z.string().trim().min(1).max(500), z.literal(''), z.null()])
    .transform((value) => value || null)
    .optional()
}).strict();

export const fulfillmentTransitions = Object.freeze({
  confirmed: 'preparing',
  preparing: 'shipping',
  shipping: 'delivered'
});

const statusCopy = Object.freeze({
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
  }
});

function requireApplicationJson(req, _res, next) {
  if (!req.is('application/json')) {
    return next(new ApiError(415, 'CONTENT_TYPE_REJECTED', 'Fulfillment webhooks must use application/json.'));
  }
  return next();
}

function requireIdentityEncoding(req, _res, next) {
  const encoding = req.get('content-encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') {
    return next(new ApiError(415, 'CONTENT_ENCODING_REJECTED', 'Compressed fulfillment webhook bodies are not accepted.'));
  }
  return next();
}

function rejectBrowserOrigin(req, _res, next) {
  if (req.get('origin')) {
    return next(new ApiError(401, 'AUTH_REQUIRED', 'The fulfillment webhook credentials are invalid.'));
  }
  return next();
}

function parseEvent(rawBody) {
  let decoded;
  try {
    decoded = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw badRequest('INVALID_JSON', 'The fulfillment webhook body is not valid JSON.');
  }
  return eventSchema.parse(decoded);
}

function digestBody(rawBody) {
  return createHash('sha256').update(rawBody).digest();
}

function utcMilliseconds(value) {
  if (value instanceof Date) return value.getTime();
  const text = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text;
  return new Date(normalized).getTime();
}

function sameDigest(left, right) {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && first.equals(second);
}

function webhookResponse({ eventId, orderId, status, replayed }) {
  return {
    accepted: true,
    replayed,
    eventId,
    order: { id: orderId, status }
  };
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

export function isAllowedFulfillmentTransition(currentStatus, targetStatus) {
  return fulfillmentTransitions[currentStatus] === targetStatus;
}

async function applyStatusEvent(database, { eventId, input, requestDigest, toleranceMs }) {
  return inTransaction(database, async (connection) => {
    await connection.execute(
      `INSERT INTO fulfillment_webhook_events
        (event_id, request_digest, state, target_status, received_at)
       VALUES (?, ?, 'processing', ?, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE event_id = VALUES(event_id)`,
      [eventId, requestDigest, input.status]
    );

    const [receiptRows] = await connection.execute(
      `SELECT request_digest, state, target_status, order_id
         FROM fulfillment_webhook_events WHERE event_id = ? LIMIT 1 FOR UPDATE`,
      [eventId]
    );
    const receipt = receiptRows[0];
    if (!receipt || !sameDigest(receipt.request_digest, requestDigest)) {
      throw conflict('FULFILLMENT_EVENT_ID_REUSED', 'This fulfillment event ID was already used for a different request.');
    }
    if (receipt.state === 'completed') {
      const [completedOrders] = await connection.execute(
        'SELECT public_id, status FROM orders WHERE id = ? LIMIT 1',
        [receipt.order_id]
      );
      const completed = completedOrders[0];
      if (!completed) throw notFound('ORDER_NOT_FOUND', 'The order was not found.');
      return webhookResponse({
        eventId,
        orderId: completed.public_id,
        status: receipt.target_status,
        replayed: true
      });
    }

    const [orderRows] = await connection.execute(
      `SELECT o.id, o.public_id, o.order_number, o.user_id, o.status, o.placed_at,
              (SELECT MAX(e.occurred_at) FROM order_tracking_events e WHERE e.order_id = o.id) AS last_event_at
         FROM orders o WHERE o.public_id = ? LIMIT 1 FOR UPDATE`,
      [input.orderId]
    );
    const order = orderRows[0];
    if (!order) throw notFound('ORDER_NOT_FOUND', 'The order was not found.');
    if (!isAllowedFulfillmentTransition(order.status, input.status)) {
      throw conflict(
        'ORDER_STATUS_TRANSITION_INVALID',
        `An order in ${order.status} status cannot transition to ${input.status}.`
      );
    }

    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    const latestAllowed = Date.now() + toleranceMs;
    if (occurredAt.getTime() > latestAllowed || occurredAt.getTime() < utcMilliseconds(order.placed_at) ||
        (order.last_event_at && occurredAt.getTime() < utcMilliseconds(order.last_event_at))) {
      throw conflict('FULFILLMENT_EVENT_TIME_INVALID', 'The fulfillment event time is outside the order timeline.');
    }

    await connection.execute(
      `UPDATE orders
          SET status = ?,
              delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END,
              version = version + 1
        WHERE id = ?`,
      [input.status, input.status, occurredAt, order.id]
    );

    const copy = statusCopy[input.status];
    await connection.execute(
      `INSERT INTO order_tracking_events
        (order_id, status, event_code, source, location, public_note, dedupe_key, occurred_at)
       VALUES (?, ?, ?, 'fulfillment', ?, ?, ?, ?)`,
      [order.id, input.status, copy.eventCode, input.location ?? null,
        input.note ?? copy.note, `fulfillment:${eventId}`, occurredAt]
    );

    await connection.execute(
      `INSERT INTO notifications
        (public_id, user_id, type, order_id, dedupe_key, payload)
       SELECT ?, ?, ?, ?, ?,
              JSON_OBJECT('orderId', ?, 'orderNumber', ?, 'status', ?, 'message', ?)
         FROM user_preferences
        WHERE user_id = ? AND order_notifications = 1`,
      [randomUUID(), order.user_id, copy.eventCode, order.id,
        `order:${order.public_id}:${input.status}`, order.public_id, order.order_number,
        input.status, input.note ?? copy.note, order.user_id]
    );

    await connection.execute(
      `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
       VALUES ('order', ?, ?, JSON_OBJECT(
         'eventId', ?, 'orderId', ?, 'orderNumber', ?, 'userId', ?,
         'previousStatus', ?, 'status', ?, 'occurredAt', ?
       ))`,
      [String(order.id), copy.eventType, eventId, order.public_id, order.order_number,
        order.user_id, order.status, input.status, occurredAt]
    );

    await connection.execute(
      `UPDATE fulfillment_webhook_events
          SET state = 'completed', order_id = ?, completed_at = UTC_TIMESTAMP(3)
        WHERE event_id = ?`,
      [order.id, eventId]
    );

    return webhookResponse({ eventId, orderId: order.public_id, status: input.status, replayed: false });
  });
}

export function createFulfillmentRouter({ secret, toleranceMs = 5 * 60 * 1000 } = {}) {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false
  });

  router.post(
    '/order-status',
    limiter,
    rejectBrowserOrigin,
    requireApplicationJson,
    requireIdentityEncoding,
    raw({ type: 'application/json', limit: '16kb', inflate: false }),
    async (req, res) => {
      if (!secret) {
        throw unavailable('FULFILLMENT_NOT_CONFIGURED', 'The fulfillment integration is not configured.');
      }
      const authentication = authenticateFulfillmentWebhook({
        secret,
        toleranceMs,
        timestampHeader: req.get('x-am-fulfillment-timestamp'),
        eventIdHeader: req.get('x-am-fulfillment-event-id'),
        signatureHeader: req.get('x-am-fulfillment-signature'),
        rawBody: req.body
      });
      const input = parseEvent(req.body);
      const response = await applyStatusEvent(req.app.locals.db, {
        eventId: authentication.eventId,
        input,
        requestDigest: digestBody(req.body),
        toleranceMs
      });
      res.set('Cache-Control', 'no-store').json(response);
    }
  );

  router.use((error, _req, _res, next) => {
    if (error?.type === 'entity.too.large') {
      return next(new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The fulfillment webhook body exceeds 16 KiB.'));
    }
    return next(error);
  });

  return router;
}
