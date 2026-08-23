import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/session.js';
import { upsertProductRef } from '../catalog/refs.js';
import { config } from '../config.js';
import { logger as defaultLogger } from '../logger.js';
import { productIdSchema } from '../validation/common.js';

const subscriptionSchema = z.object({ productId: productIdSchema }).strict();
const subscriptionListSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50)
}).strip();

function bool(value) {
  return Boolean(value);
}

export function classifyStock(quantity, threshold) {
  if (!Number.isInteger(quantity) || quantity < 0) return 'unknown';
  if (!Number.isInteger(threshold) || threshold < 1) throw new TypeError('A positive integer stock threshold is required.');
  return quantity <= threshold ? 'low' : 'available';
}

export function stockTransition(previousState, nextState) {
  if (nextState === 'low' && previousState !== 'low') return 'low_stock';
  if (nextState === 'available' && previousState === 'low') return 'restocked';
  return null;
}

function subscriptionDto(row, notificationsEnabled) {
  if (!row) return null;
  return {
    productId: row.external_id,
    subscribed: bool(row.is_active),
    notificationsEnabled: bool(notificationsEnabled),
    sources: {
      explicit: bool(row.explicit_subscription),
      wishlist: bool(row.wishlist_subscription)
    },
    userOptedOut: bool(row.user_opted_out),
    thresholdQuantity: Number(row.threshold_quantity),
    lastObservedQuantity: row.last_observed_quantity == null ? null : Number(row.last_observed_quantity),
    lastObservedState: row.last_observed_state,
    lastNotifiedAt: row.last_notified_at,
    updatedAt: row.updated_at
  };
}

const subscriptionSelect = `SELECT s.is_active, s.explicit_subscription, s.wishlist_subscription,
  s.user_opted_out, s.threshold_quantity, s.last_observed_quantity,
  s.last_observed_state, s.last_notified_at, s.updated_at, p.external_id
  FROM low_stock_subscriptions s
  JOIN catalog_product_refs p ON p.id = s.product_ref_id`;

export async function setWishlistStockSubscription(connection, {
  userId,
  productRefId,
  subscribed,
  thresholdQuantity = config.lowStock.defaultThreshold
}) {
  if (subscribed) {
    await connection.execute(
      `INSERT INTO low_stock_subscriptions
        (user_id, product_ref_id, threshold_quantity, is_active, wishlist_subscription)
       VALUES (?, ?, ?, 1, 1)
       ON DUPLICATE KEY UPDATE
         wishlist_subscription = 1,
         is_active = IF(user_opted_out = 1 AND explicit_subscription = 0, 0, 1)`,
      [userId, productRefId, thresholdQuantity]
    );
    return;
  }

  await connection.execute(
    `UPDATE low_stock_subscriptions
        SET wishlist_subscription = 0,
            is_active = IF(explicit_subscription = 1 AND user_opted_out = 0, 1, 0)
      WHERE user_id = ? AND product_ref_id = ?`,
    [userId, productRefId]
  );
}

async function renderSubscription(database, userId, productId) {
  const [preferenceRows] = await database.execute(
    'SELECT low_stock_notifications FROM user_preferences WHERE user_id = ? LIMIT 1',
    [userId]
  );
  const [rows] = await database.execute(
    `${subscriptionSelect} WHERE s.user_id = ? AND p.external_id = ? LIMIT 1`,
    [userId, productId]
  );
  return {
    productId,
    subscribed: bool(rows[0]?.is_active),
    notificationsEnabled: bool(preferenceRows[0]?.low_stock_notifications),
    ...(rows[0] ? subscriptionDto(rows[0], preferenceRows[0]?.low_stock_notifications) : {
      sources: { explicit: false, wishlist: false },
      userOptedOut: false,
      thresholdQuantity: config.lowStock.defaultThreshold,
      lastObservedQuantity: null,
      lastObservedState: 'unknown',
      lastNotifiedAt: null,
      updatedAt: null
    })
  };
}

export function createLowStockSubscriptionsRouter(catalog) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const query = subscriptionListSchema.parse(req.query);
    const [preferenceRows] = await req.app.locals.db.execute(
      'SELECT low_stock_notifications FROM user_preferences WHERE user_id = ? LIMIT 1',
      [req.auth.userId]
    );
    const enabled = bool(preferenceRows[0]?.low_stock_notifications);
    const [rows] = await req.app.locals.db.execute(
      `${subscriptionSelect} WHERE s.user_id = ? ORDER BY s.updated_at DESC, p.external_id
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      [req.auth.userId]
    );
    res.json({
      notificationsEnabled: enabled,
      subscriptions: rows.map((row) => subscriptionDto(row, enabled)),
      page: query.page
    });
  });

  router.get('/:productId', async (req, res) => {
    const productId = productIdSchema.parse(req.params.productId);
    res.json({ subscription: await renderSubscription(req.app.locals.db, req.auth.userId, productId) });
  });

  router.post('/', async (req, res) => {
    const input = subscriptionSchema.parse(req.body);
    const product = await catalog.getProduct(input.productId);
    const connection = await req.app.locals.db.getConnection();
    try {
      await connection.beginTransaction();
      const productRefId = await upsertProductRef(connection, product);
      await connection.execute(
        `INSERT INTO low_stock_subscriptions
          (user_id, product_ref_id, threshold_quantity, is_active, explicit_subscription)
         VALUES (?, ?, ?, 1, 1)
         ON DUPLICATE KEY UPDATE
           last_observed_quantity = IF(user_opted_out = 1, NULL, last_observed_quantity),
           last_observed_state = IF(user_opted_out = 1, 'unknown', last_observed_state),
           explicit_subscription = 1, user_opted_out = 0, is_active = 1`,
        [req.auth.userId, productRefId, config.lowStock.defaultThreshold]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    res.status(201).json({
      subscription: await renderSubscription(req.app.locals.db, req.auth.userId, input.productId)
    });
  });

  router.delete('/:productId', async (req, res) => {
    const productId = productIdSchema.parse(req.params.productId);
    await req.app.locals.db.execute(
      `UPDATE low_stock_subscriptions s
        JOIN catalog_product_refs p ON p.id = s.product_ref_id
         SET s.explicit_subscription = 0, s.user_opted_out = 1, s.is_active = 0
       WHERE s.user_id = ? AND p.external_id = ?`,
      [req.auth.userId, productId]
    );
    res.status(204).end();
  });

  return router;
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

export async function recordKnownStockObservation({
  database,
  subscriptionId,
  stockQuantity,
  notificationTtlDays = config.lowStock.notificationTtlDays
}) {
  if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
    return { evaluated: false, reason: 'unknown_quantity' };
  }

  return inTransaction(database, async (connection) => {
    const [rows] = await connection.execute(
      `SELECT s.id, s.user_id, s.is_active, s.threshold_quantity,
              s.last_observed_state, s.transition_sequence,
              p.external_id, p.last_known_name
         FROM low_stock_subscriptions s
         JOIN catalog_product_refs p ON p.id = s.product_ref_id
        WHERE s.id = ? LIMIT 1 FOR UPDATE`,
      [subscriptionId]
    );
    const subscription = rows[0];
    if (!subscription?.is_active) return { evaluated: false, reason: 'inactive' };

    const [preferenceRows] = await connection.execute(
      `SELECT p.low_stock_notifications, u.status
         FROM user_preferences p JOIN users u ON u.id = p.user_id
        WHERE p.user_id = ? LIMIT 1 FOR UPDATE`,
      [subscription.user_id]
    );
    if (!preferenceRows[0]?.low_stock_notifications || preferenceRows[0].status !== 'active') {
      return { evaluated: false, reason: 'preference_disabled' };
    }

    const nextState = classifyStock(stockQuantity, Number(subscription.threshold_quantity));
    const transition = stockTransition(subscription.last_observed_state, nextState);
    let sequence = Number(subscription.transition_sequence);

    if (transition) {
      sequence += 1;
      const payload = transition === 'low_stock'
        ? {
            message: `${subscription.last_known_name} has only ${stockQuantity} left in stock.`,
            stockQuantity,
            thresholdQuantity: Number(subscription.threshold_quantity),
            stockState: nextState
          }
        : {
            message: `${subscription.last_known_name} is back in stock.`,
            stockQuantity,
            thresholdQuantity: Number(subscription.threshold_quantity),
            stockState: nextState
          };
      const dedupeKey = `stock:${subscription.id}:${sequence}:${transition}`;
      await connection.execute(
        `INSERT INTO notifications
          (public_id, user_id, type, product_ref_id, dedupe_key, payload, expires_at)
         SELECT ?, ?, ?, s.product_ref_id, ?, ?, TIMESTAMPADD(DAY, ?, UTC_TIMESTAMP(3))
           FROM low_stock_subscriptions s WHERE s.id = ?`,
        [randomUUID(), subscription.user_id, transition, dedupeKey, JSON.stringify(payload), notificationTtlDays, subscription.id]
      );
    }

    await connection.execute(
      `UPDATE low_stock_subscriptions
          SET last_observed_quantity = ?, last_observed_state = ?, transition_sequence = ?,
              last_notified_at = ${transition ? 'UTC_TIMESTAMP(3)' : 'last_notified_at'}
        WHERE id = ?`,
      [stockQuantity, nextState, sequence, subscription.id]
    );
    return { evaluated: true, transition, state: nextState };
  });
}

async function mapWithConcurrency(items, concurrency, work) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await work(items[index]);
    }
  });
  await Promise.all(workers);
}

export function createLowStockEvaluator({
  database,
  catalog,
  logger = defaultLogger,
  options = config.lowStock
}) {
  if (!database || !catalog) throw new TypeError('The low-stock evaluator requires a database and catalog service.');

  let timer = null;
  let activeRun = null;
  let activeController = null;
  let afterSubscriptionId = 0;
  let stopping = false;

  async function evaluateBatch(signal) {
    let [rows] = await database.execute(
      `SELECT s.id, s.product_ref_id, p.external_id
         FROM low_stock_subscriptions s
         JOIN catalog_product_refs p ON p.id = s.product_ref_id
         JOIN user_preferences pref ON pref.user_id = s.user_id
         JOIN users u ON u.id = s.user_id
        WHERE s.is_active = 1 AND pref.low_stock_notifications = 1
          AND u.status = 'active' AND s.id > ?
        ORDER BY s.id LIMIT ${options.batchSize}`,
      [afterSubscriptionId]
    );
    if (!rows.length && afterSubscriptionId !== 0) {
      afterSubscriptionId = 0;
      [rows] = await database.execute(
        `SELECT s.id, s.product_ref_id, p.external_id
           FROM low_stock_subscriptions s
           JOIN catalog_product_refs p ON p.id = s.product_ref_id
           JOIN user_preferences pref ON pref.user_id = s.user_id
           JOIN users u ON u.id = s.user_id
          WHERE s.is_active = 1 AND pref.low_stock_notifications = 1
            AND u.status = 'active' AND s.id > 0
          ORDER BY s.id LIMIT ${options.batchSize}`
      );
    }
    if (!rows.length) return { subscriptions: 0, products: 0, notifications: 0, errors: 0 };

    afterSubscriptionId = rows.length < options.batchSize ? 0 : Number(rows.at(-1).id);
    const byProduct = new Map();
    for (const row of rows) {
      const key = String(row.external_id);
      if (!byProduct.has(key)) byProduct.set(key, []);
      byProduct.get(key).push(row);
    }

    const stats = { subscriptions: rows.length, products: byProduct.size, notifications: 0, errors: 0 };
    await mapWithConcurrency([...byProduct.entries()], options.concurrency, async ([productId, subscriptions]) => {
      if (signal.aborted) return;
      try {
        const product = await catalog.getProduct(productId, { refresh: true, signal });
        await upsertProductRef(database, product);
        if (!Number.isInteger(product.stock_quantity) || product.stock_quantity < 0) return;
        for (const subscription of subscriptions) {
          if (signal.aborted) return;
          const result = await recordKnownStockObservation({
            database,
            subscriptionId: subscription.id,
            stockQuantity: product.stock_quantity,
            notificationTtlDays: options.notificationTtlDays
          });
          if (result.transition) stats.notifications += 1;
        }
      } catch (error) {
        if (!signal.aborted) {
          stats.errors += 1;
          logger.warn({ err: error, productId }, 'Low-stock product evaluation failed');
        }
      }
    });
    return stats;
  }

  async function runNow() {
    if (!options.enabled || stopping) return { skipped: true, reason: 'disabled' };
    if (activeRun) return { skipped: true, reason: 'already_running' };
    activeController = new AbortController();
    const deadline = setTimeout(() => activeController.abort(), options.runTimeoutMs).unref();
    activeRun = evaluateBatch(activeController.signal)
      .then((stats) => {
        logger.debug(stats, 'Low-stock evaluation completed');
        return stats;
      })
      .catch((error) => {
        if (!activeController.signal.aborted) logger.error({ err: error }, 'Low-stock evaluation failed');
        return { subscriptions: 0, products: 0, notifications: 0, errors: 1 };
      })
      .finally(() => {
        clearTimeout(deadline);
        activeRun = null;
        activeController = null;
      });
    return activeRun;
  }

  function start() {
    if (!options.enabled || timer) return;
    stopping = false;
    timer = setInterval(() => { void runNow(); }, options.intervalMs);
    timer.unref();
    logger.info({ intervalMs: options.intervalMs }, 'Low-stock evaluator started');
    void runNow();
  }

  async function stop() {
    stopping = true;
    if (timer) clearInterval(timer);
    timer = null;
    activeController?.abort();
    await activeRun;
    logger.info('Low-stock evaluator stopped');
  }

  return { start, stop, runNow };
}
