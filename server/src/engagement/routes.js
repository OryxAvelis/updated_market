import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/session.js';
import { upsertProductRef } from '../catalog/refs.js';
import { databaseDateToIso, nullableDatabaseDateToIso } from '../db/date.js';
import { conflict, notFound } from '../http/errors.js';
import { productIdSchema, publicIdSchema } from '../validation/common.js';

const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  title: z.union([z.string().trim().max(120), z.literal(''), z.null()]).transform((value) => value || null).optional(),
  body: z.union([z.string().trim().max(2000), z.literal(''), z.null()]).transform((value) => value || null).optional()
}).strict();
const reviewPatchSchema = reviewSchema.partial().refine((value) => Object.keys(value).length > 0, { message: 'Provide a review change.' });
const reviewListSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10)
}).strip();
const myReviewListSchema = reviewListSchema.extend({ product_id: productIdSchema.optional() });
const recentSchema = z.object({ productId: productIdSchema }).strict();
const searchSchema = z.object({
  query: z.string().trim().min(1).max(100),
  resultsCount: z.coerce.number().int().min(0).max(1000000).optional()
}).strict();

function reviewDto(row) {
  return {
    id: row.public_id,
    rating: row.rating,
    title: row.title,
    body: row.body,
    author: row.display_name,
    verifiedPurchase: Boolean(row.verified_order_item_id),
    createdAt: databaseDateToIso(row.created_at),
    updatedAt: databaseDateToIso(row.updated_at)
  };
}

async function withLockedPersonalization(database, userId, work) {
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT personalization_enabled
         FROM user_preferences
        WHERE user_id = ?
        LIMIT 1 FOR UPDATE`,
      [userId]
    );
    const enabled = Boolean(rows[0]?.personalization_enabled);
    const result = await work(connection, enabled);
    await connection.commit();
    return { enabled, result };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function createProductReviewsRouter(catalog) {
  const router = Router({ mergeParams: true });

  router.get('/', async (req, res) => {
    const productId = productIdSchema.parse(req.params.productId);
    const query = reviewListSchema.parse(req.query);
    const offset = (query.page - 1) * query.limit;
    const [summaryRows] = await req.app.locals.db.execute(
      `SELECT COUNT(*) AS review_count, COALESCE(AVG(rv.rating), 0) AS average_rating
         FROM reviews rv JOIN catalog_product_refs p ON p.id = rv.product_ref_id
        WHERE p.external_id = ? AND rv.status = 'published' AND rv.deleted_at IS NULL`,
      [productId]
    );
    const [rows] = await req.app.locals.db.execute(
      `SELECT rv.public_id, rv.rating, rv.title, rv.body, rv.verified_order_item_id,
              rv.created_at, rv.updated_at, u.display_name
         FROM reviews rv JOIN catalog_product_refs p ON p.id = rv.product_ref_id
         JOIN users u ON u.id = rv.user_id
        WHERE p.external_id = ? AND rv.status = 'published' AND rv.deleted_at IS NULL
        ORDER BY rv.created_at DESC LIMIT ${query.limit} OFFSET ${offset}`,
      [productId]
    );
    res.json({
      summary: {
        count: Number(summaryRows[0].review_count),
        average: Number(summaryRows[0].average_rating).toFixed(1)
      },
      reviews: rows.map(reviewDto),
      page: query.page
    });
  });

  router.post('/', requireAuth, async (req, res) => {
    const productId = productIdSchema.parse(req.params.productId);
    const input = reviewSchema.parse(req.body);
    const product = await catalog.getProduct(productId);
    const reviewId = randomUUID();
    const connection = await req.app.locals.db.getConnection();
    let review;
    try {
      await connection.beginTransaction();
      const productRefId = await upsertProductRef(connection, product);
      const [existingRows] = await connection.execute(
        `SELECT id, deleted_at FROM reviews
          WHERE user_id = ? AND product_ref_id = ? LIMIT 1 FOR UPDATE`,
        [req.auth.userId, productRefId]
      );
      if (existingRows[0] && !existingRows[0].deleted_at) {
        throw conflict('REVIEW_ALREADY_EXISTS', 'You have already reviewed this product.');
      }
      const [purchases] = await connection.execute(
        `SELECT oi.id FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE o.user_id = ? AND oi.product_ref_id = ? AND o.status = 'delivered'
          ORDER BY o.delivered_at DESC LIMIT 1`,
        [req.auth.userId, productRefId]
      );
      if (existingRows[0]) {
        await connection.execute(
          `UPDATE reviews
              SET public_id = ?, verified_order_item_id = ?, rating = ?, title = ?, body = ?,
                  status = 'published', deleted_at = NULL, created_at = UTC_TIMESTAMP(3)
            WHERE id = ?`,
          [reviewId, purchases[0]?.id || null, input.rating, input.title ?? null,
            input.body ?? null, existingRows[0].id]
        );
      } else {
        await connection.execute(
          `INSERT INTO reviews
            (public_id, user_id, product_ref_id, verified_order_item_id, rating, title, body, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'published')`,
          [reviewId, req.auth.userId, productRefId, purchases[0]?.id || null,
            input.rating, input.title ?? null, input.body ?? null]
        );
      }
      const [rows] = await connection.execute(
        `SELECT rv.public_id, rv.rating, rv.title, rv.body, rv.verified_order_item_id,
                rv.created_at, rv.updated_at, u.display_name
           FROM reviews rv JOIN users u ON u.id = rv.user_id
          WHERE rv.public_id = ? LIMIT 1`,
        [reviewId]
      );
      review = rows[0];
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (error?.code === 'ER_DUP_ENTRY') {
        throw conflict('REVIEW_ALREADY_EXISTS', 'You have already reviewed this product.');
      }
      throw error;
    } finally {
      connection.release();
    }
    res.status(201).json({ review: reviewDto(review) });
  });

  return router;
}

export function createReviewsRouter() {
  const router = Router();
  router.use(requireAuth);
  router.patch('/:reviewId', async (req, res) => {
    const reviewId = publicIdSchema.parse(req.params.reviewId);
    const input = reviewPatchSchema.parse(req.body);
    const mapping = { rating: 'rating', title: 'title', body: 'body' };
    const entries = Object.entries(input);
    const [result] = await req.app.locals.db.execute(
      `UPDATE reviews SET ${entries.map(([key]) => `${mapping[key]} = ?`).join(', ')}
        WHERE public_id = ? AND user_id = ? AND deleted_at IS NULL`,
      [...entries.map(([, value]) => value), reviewId, req.auth.userId]
    );
    if (!result.affectedRows) throw notFound('REVIEW_NOT_FOUND', 'The review was not found.');
    res.json({ updated: true });
  });
  router.delete('/:reviewId', async (req, res) => {
    const reviewId = publicIdSchema.parse(req.params.reviewId);
    const [result] = await req.app.locals.db.execute(
      `UPDATE reviews SET deleted_at = UTC_TIMESTAMP(3)
        WHERE public_id = ? AND user_id = ? AND deleted_at IS NULL`,
      [reviewId, req.auth.userId]
    );
    if (!result.affectedRows) throw notFound('REVIEW_NOT_FOUND', 'The review was not found.');
    res.status(204).end();
  });
  return router;
}

export function createMeReviewsRouter() {
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (req, res) => {
    const query = myReviewListSchema.parse(req.query);
    const parameters = [req.auth.userId];
    const productCondition = query.product_id ? 'AND p.external_id = ?' : '';
    if (query.product_id) parameters.push(query.product_id);
    const [rows] = await req.app.locals.db.execute(
      `SELECT rv.public_id, rv.rating, rv.title, rv.body, rv.verified_order_item_id,
              rv.created_at, rv.updated_at, u.display_name,
              p.external_id, p.last_known_name, p.last_known_image_url
         FROM reviews rv JOIN users u ON u.id = rv.user_id
          JOIN catalog_product_refs p ON p.id = rv.product_ref_id
        WHERE rv.user_id = ? AND rv.deleted_at IS NULL ${productCondition}
        ORDER BY rv.created_at DESC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      parameters
    );
    res.json({ reviews: rows.map((row) => ({
      ...reviewDto(row), productId: row.external_id, productName: row.last_known_name, productImageUrl: row.last_known_image_url
    })) });
  });
  return router;
}

export function createHistoryRouter(catalog) {
  const router = Router();
  router.use(requireAuth);

  router.get('/recently-viewed', async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(50).default(12).parse(req.query.limit);
    const [rows] = await req.app.locals.db.execute(
      `SELECT p.external_id, p.last_known_name, p.last_known_image_url, p.last_known_brand,
              p.last_verified_price, p.is_available, r.view_count, r.last_viewed_at
         FROM recently_viewed_products r JOIN catalog_product_refs p ON p.id = r.product_ref_id
        WHERE r.user_id = ? ORDER BY r.last_viewed_at DESC LIMIT ${limit}`,
      [req.auth.userId]
    );
    res.json({ products: rows.map((row) => ({
      id: row.external_id, name: row.last_known_name, imageUrl: row.last_known_image_url,
      brand: row.last_known_brand, price: row.last_verified_price,
      isAvailable: Boolean(row.is_available), viewCount: row.view_count,
      lastViewedAt: databaseDateToIso(row.last_viewed_at)
    })) });
  });

  router.post('/recently-viewed', async (req, res) => {
    const input = recentSchema.parse(req.body);
    const [prefs] = await req.app.locals.db.execute(
      'SELECT personalization_enabled FROM user_preferences WHERE user_id = ? LIMIT 1',
      [req.auth.userId]
    );
    if (!prefs[0]?.personalization_enabled) return res.status(204).end();
    const product = await catalog.getProduct(input.productId);
    await withLockedPersonalization(req.app.locals.db, req.auth.userId, async (connection, enabled) => {
      if (!enabled) return;
      const productRefId = await upsertProductRef(connection, product);
      await connection.execute(
        `INSERT INTO recently_viewed_products (user_id, product_ref_id, view_count, last_viewed_at)
         VALUES (?, ?, 1, UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE view_count = view_count + 1, last_viewed_at = UTC_TIMESTAMP(3)`,
        [req.auth.userId, productRefId]
      );
    });
    res.status(204).end();
  });

  router.delete('/recently-viewed', async (req, res) => {
    await req.app.locals.db.execute('DELETE FROM recently_viewed_products WHERE user_id = ?', [req.auth.userId]);
    res.status(204).end();
  });

  router.get('/search-history', async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(50).default(10).parse(req.query.limit);
    const [rows] = await req.app.locals.db.execute(
      `SELECT query, results_count, search_count, last_searched_at
         FROM search_history WHERE user_id = ? ORDER BY last_searched_at DESC LIMIT ${limit}`,
      [req.auth.userId]
    );
    res.json({ searches: rows.map((row) => ({
      query: row.query,
      resultsCount: row.results_count,
      count: row.search_count,
      lastSearchedAt: databaseDateToIso(row.last_searched_at)
    })) });
  });

  router.post('/search-history', async (req, res) => {
    const input = searchSchema.parse(req.body);
    const normalized = input.query.toLocaleLowerCase('en').replace(/\s+/g, ' ');
    const catalogResult = await catalog.listProducts({ page: 1, pageSize: 1, search: input.query });
    const authoritativeResultCount = Number(catalogResult.count) || 0;
    await req.app.locals.db.execute(
      `INSERT INTO search_history
        (user_id, query, query_normalized, results_count, search_count, last_searched_at)
       VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE query = VALUES(query), results_count = VALUES(results_count),
         search_count = search_count + 1, last_searched_at = UTC_TIMESTAMP(3)`,
      [req.auth.userId, input.query, normalized, authoritativeResultCount]
    );
    res.status(204).end();
  });

  router.delete('/search-history', async (req, res) => {
    await req.app.locals.db.execute('DELETE FROM search_history WHERE user_id = ?', [req.auth.userId]);
    res.status(204).end();
  });
  return router;
}

export function createSearchSuggestionsRouter(catalog) {
  const router = Router();
  router.get('/', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const q = z.string().trim().min(2).max(100).parse(req.query.q);
    const payload = await catalog.listProducts({ page: 1, pageSize: 8, search: q });
    let recentSearches = [];
    if (req.auth) {
      const [rows] = await req.app.locals.db.execute(
        `SELECT query FROM search_history WHERE user_id = ? AND query_normalized LIKE ?
          ORDER BY last_searched_at DESC LIMIT 5`,
        [req.auth.userId, `${q.toLocaleLowerCase('en')}%`]
      );
      recentSearches = rows.map((row) => row.query);
    }
    res.json({
      products: payload.results.slice(0, 8),
      resultCount: Number(payload.count) || 0,
      recentSearches
    });
  });
  return router;
}

export function createNotificationsRouter() {
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(100).default(30).parse(req.query.limit);
    const unreadOnly = req.query.unread === 'true';
    const [rows] = await req.app.locals.db.execute(
      `SELECT n.public_id, n.type, n.payload, n.read_at, n.created_at, n.expires_at,
              o.public_id AS order_public_id, p.external_id AS product_id,
              p.last_known_name AS product_name
         FROM notifications n LEFT JOIN orders o ON o.id = n.order_id
         LEFT JOIN catalog_product_refs p ON p.id = n.product_ref_id
        WHERE n.user_id = ? AND (n.expires_at IS NULL OR n.expires_at > UTC_TIMESTAMP(3))
          ${unreadOnly ? 'AND n.read_at IS NULL' : ''}
        ORDER BY n.created_at DESC LIMIT ${limit}`,
      [req.auth.userId]
    );
    const [[count]] = await req.app.locals.db.execute(
      `SELECT COUNT(*) AS total FROM notifications
        WHERE user_id = ? AND read_at IS NULL AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))`,
      [req.auth.userId]
    );
    res.json({ unreadCount: Number(count.total), notifications: rows.map((row) => ({
      id: row.public_id, type: row.type,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      orderId: row.order_public_id, productId: row.product_id, productName: row.product_name,
      readAt: nullableDatabaseDateToIso(row.read_at),
      createdAt: databaseDateToIso(row.created_at),
      expiresAt: nullableDatabaseDateToIso(row.expires_at)
    })) });
  });
  router.patch('/:notificationId/read', async (req, res) => {
    const notificationId = publicIdSchema.parse(req.params.notificationId);
    const [result] = await req.app.locals.db.execute(
      'UPDATE notifications SET read_at = COALESCE(read_at, UTC_TIMESTAMP(3)) WHERE public_id = ? AND user_id = ?',
      [notificationId, req.auth.userId]
    );
    if (!result.affectedRows) throw notFound('NOTIFICATION_NOT_FOUND', 'The notification was not found.');
    res.status(204).end();
  });
  router.post('/read-all', async (req, res) => {
    await req.app.locals.db.execute(
      'UPDATE notifications SET read_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND read_at IS NULL',
      [req.auth.userId]
    );
    res.status(204).end();
  });
  return router;
}

export function createRecommendationsRouter(catalog) {
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(30).default(12).parse(req.query.limit);
    const [prefs] = await req.app.locals.db.execute(
      'SELECT personalization_enabled FROM user_preferences WHERE user_id = ? LIMIT 1',
      [req.auth.userId]
    );
    if (!prefs[0]?.personalization_enabled) {
      const { enabled } = await withLockedPersonalization(
        req.app.locals.db,
        req.auth.userId,
        async (connection, finalEnabled) => {
          if (!finalEnabled) {
            await connection.execute(
              'DELETE FROM recommendation_snapshots WHERE user_id = ?',
              [req.auth.userId]
            );
          }
        }
      );
      return res.json({ products: [], personalized: enabled });
    }
    const [seedRows] = await req.app.locals.db.execute(
      `SELECT p.external_id FROM recently_viewed_products r
        JOIN catalog_product_refs p ON p.id = r.product_ref_id
       WHERE r.user_id = ? ORDER BY r.last_viewed_at DESC LIMIT 5`,
      [req.auth.userId]
    );
    if (!seedRows.length) {
      const { enabled } = await withLockedPersonalization(
        req.app.locals.db,
        req.auth.userId,
        (connection) => connection.execute(
          'DELETE FROM recommendation_snapshots WHERE user_id = ?',
          [req.auth.userId]
        )
      );
      return res.json({ products: [], personalized: enabled });
    }
    const seeds = await Promise.all(seedRows.map((row) => catalog.getProduct(row.external_id)));
    const categories = [...new Set(seeds.map((product) => product.category).filter(Boolean))];
    const seen = new Set(seedRows.map((row) => row.external_id));
    const candidates = [];
    for (const category of categories.slice(0, 3)) {
      const payload = await catalog.listProducts({ page: 1, pageSize: 20, category });
      for (const product of payload.results) {
        if (!seen.has(product.id) && product.is_available && !candidates.some((item) => item.id === product.id)) candidates.push(product);
      }
    }
    const selected = candidates.slice(0, limit);
    const finalState = await withLockedPersonalization(
      req.app.locals.db,
      req.auth.userId,
      async (connection, enabled) => {
        await connection.execute('DELETE FROM recommendation_snapshots WHERE user_id = ?', [req.auth.userId]);
        if (!enabled) return [];
        for (let index = 0; index < selected.length; index += 1) {
          const refId = await upsertProductRef(connection, selected[index]);
          await connection.execute(
            `INSERT INTO recommendation_snapshots
              (user_id, product_ref_id, score, reason, generated_at, expires_at)
             VALUES (?, ?, ?, 'recent_category', UTC_TIMESTAMP(3), TIMESTAMPADD(HOUR, 6, UTC_TIMESTAMP(3)))`,
            [req.auth.userId, refId, (selected.length - index) / selected.length]
          );
        }
        return selected;
      }
    );
    res.json({ products: finalState.result, personalized: finalState.enabled });
  });
  return router;
}
