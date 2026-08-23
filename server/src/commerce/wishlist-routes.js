import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/session.js';
import { upsertProductRef } from '../catalog/refs.js';
import { setWishlistStockSubscription } from '../engagement/low-stock.js';
import { notFound } from '../http/errors.js';
import { productIdSchema } from '../validation/common.js';

const itemSchema = z.object({ productId: productIdSchema }).strict();
const mergeSchema = z.object({
  items: z.array(z.union([productIdSchema, itemSchema])).max(100)
}).strict();

async function wishlistId(database, userId) {
  const [rows] = await database.execute('SELECT id FROM wishlists WHERE user_id = ? LIMIT 1', [userId]);
  if (!rows[0]) throw notFound('WISHLIST_NOT_FOUND', 'The wishlist was not found.');
  return rows[0].id;
}

async function renderWishlist(database, userId) {
  const id = await wishlistId(database, userId);
  const [rows] = await database.execute(
    `SELECT r.external_id, r.last_known_name, r.last_known_image_url, r.last_known_brand,
            r.last_verified_price, r.is_available, wi.created_at
       FROM wishlist_items wi
       JOIN catalog_product_refs r ON r.id = wi.product_ref_id
      WHERE wi.wishlist_id = ? ORDER BY wi.created_at DESC`,
    [id]
  );
  return rows.map((row) => ({
    productId: row.external_id,
    name: row.last_known_name,
    imageUrl: row.last_known_image_url,
    brand: row.last_known_brand,
    unitPrice: row.last_verified_price,
    isAvailable: Boolean(row.is_available),
    createdAt: row.created_at
  }));
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

export function createWishlistRouter(catalog) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    res.json({ items: await renderWishlist(req.app.locals.db, req.auth.userId) });
  });

  router.post('/items', async (req, res) => {
    const input = itemSchema.parse(req.body);
    const product = await catalog.getProduct(input.productId);
    await inTransaction(req.app.locals.db, async (connection) => {
      const id = await wishlistId(connection, req.auth.userId);
      const productRefId = await upsertProductRef(connection, product);
      await connection.execute(
        'INSERT IGNORE INTO wishlist_items (wishlist_id, product_ref_id) VALUES (?, ?)',
        [id, productRefId]
      );
      await setWishlistStockSubscription(connection, {
        userId: req.auth.userId,
        productRefId,
        subscribed: true
      });
    });
    res.status(201).json({ items: await renderWishlist(req.app.locals.db, req.auth.userId) });
  });

  router.delete('/items/:productId', async (req, res) => {
    const productId = productIdSchema.parse(req.params.productId);
    await inTransaction(req.app.locals.db, async (connection) => {
      const id = await wishlistId(connection, req.auth.userId);
      const [rows] = await connection.execute(
        `SELECT wi.product_ref_id FROM wishlist_items wi
          JOIN catalog_product_refs r ON r.id = wi.product_ref_id
         WHERE wi.wishlist_id = ? AND r.external_id = ? LIMIT 1 FOR UPDATE`,
        [id, productId]
      );
      if (!rows[0]) throw notFound('WISHLIST_ITEM_NOT_FOUND', 'The wishlist item was not found.');
      await connection.execute(
        'DELETE FROM wishlist_items WHERE wishlist_id = ? AND product_ref_id = ?',
        [id, rows[0].product_ref_id]
      );
      await setWishlistStockSubscription(connection, {
        userId: req.auth.userId,
        productRefId: rows[0].product_ref_id,
        subscribed: false
      });
    });
    res.status(204).end();
  });

  router.post('/merge', async (req, res) => {
    const input = mergeSchema.parse(req.body);
    const ids = [...new Set(input.items.map((item) => typeof item === 'string' ? item : item.productId))];
    const products = await Promise.all(ids.map((id) => catalog.getProduct(id)));
    const id = await wishlistId(req.app.locals.db, req.auth.userId);
    const connection = await req.app.locals.db.getConnection();
    try {
      await connection.beginTransaction();
      for (const product of products) {
        const productRefId = await upsertProductRef(connection, product);
        await connection.execute('INSERT IGNORE INTO wishlist_items (wishlist_id, product_ref_id) VALUES (?, ?)', [id, productRefId]);
        await setWishlistStockSubscription(connection, {
          userId: req.auth.userId,
          productRefId,
          subscribed: true
        });
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    res.json({ items: await renderWishlist(req.app.locals.db, req.auth.userId) });
  });

  return router;
}
