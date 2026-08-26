import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/session.js';
import { upsertProductRef } from '../catalog/refs.js';
import { conflict, notFound } from '../http/errors.js';
import { centsToDecimal, decimalToCents, deliveryFeeCents } from '../money.js';
import { productIdSchema } from '../validation/common.js';

const itemSchema = z.object({
  productId: productIdSchema,
  quantity: z.coerce.number().int().min(1).max(99)
}).strict();
const quantitySchema = z.object({ quantity: z.coerce.number().int().min(1).max(99) }).strict();
const mergeSchema = z.object({ items: z.array(itemSchema).max(100) }).strict();
const cartMergeIdempotencyRetentionHours = 24;
const cartMergeIdempotencyRetentionMs = cartMergeIdempotencyRetentionHours * 60 * 60 * 1000;
const cartMergeClockSkewMs = 5 * 60 * 1000;
export const cartMergeIdempotencyLedgerRetentionMs = cartMergeIdempotencyRetentionMs + cartMergeClockSkewMs;
const cartMergeIdempotencyLedgerRetentionMinutes = Math.ceil(cartMergeIdempotencyLedgerRetentionMs / (60 * 1000));

export function cartMergeKeyStatus(key, now = Date.now()) {
  const match = /^am1\.([0-9a-z]+)\.([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(String(key || ''));
  if (!match) return 'invalid';
  const createdAt = Number.parseInt(match[1], 36);
  if (!Number.isSafeInteger(createdAt) || createdAt < 0 || createdAt > now + cartMergeClockSkewMs) return 'invalid';
  if (createdAt < now - cartMergeIdempotencyRetentionMs) return 'expired';
  return 'valid';
}

export function cartMergeRequestDigest(input) {
  const quantities = new Map();
  input.items.forEach((item) => {
    quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
  });
  const items = [...quantities].map(([productId, quantity]) => ({ productId, quantity }))
    .sort((left, right) => left.productId.localeCompare(right.productId));
  return createHash('sha256').update(JSON.stringify({ items })).digest();
}

async function existingMergeForKey(database, userId, keyDigest, { lock = false } = {}) {
  const [rows] = await database.execute(
    `SELECT request_digest FROM cart_merge_idempotency
      WHERE user_id = ? AND key_digest = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [userId, keyDigest]
  );
  return rows[0] || null;
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

async function cartForUpdate(connection, userId) {
  const [rows] = await connection.execute(
    'SELECT id, public_id, version FROM carts WHERE user_id = ? LIMIT 1 FOR UPDATE',
    [userId]
  );
  if (!rows[0]) throw notFound('CART_NOT_FOUND', 'The cart was not found.');
  return rows[0];
}

async function renderCart(database, catalog, userId) {
  const [cartRows] = await database.execute(
    'SELECT id, public_id, version, updated_at FROM carts WHERE user_id = ? LIMIT 1',
    [userId]
  );
  const cart = cartRows[0];
  if (!cart) throw notFound('CART_NOT_FOUND', 'The cart was not found.');
  const [rows] = await database.execute(
    `SELECT ci.quantity, r.id AS product_ref_id, r.external_id, r.last_known_name,
            r.last_known_image_url, r.last_known_brand, r.last_verified_price,
            r.is_available, r.stock_quantity, r.last_verified_at
       FROM cart_items ci
       JOIN catalog_product_refs r ON r.id = ci.product_ref_id
      WHERE ci.cart_id = ?
      ORDER BY ci.created_at`,
    [cart.id]
  );

  const items = await Promise.all(rows.map(async (row) => {
    try {
      const product = await catalog.getProduct(row.external_id);
      await upsertProductRef(database, product);
      return {
        productId: product.id,
        quantity: row.quantity,
        name: product.name,
        imageUrl: product.image_url,
        brand: product.brand_name,
        unitPrice: product.price,
        isAvailable: product.is_available,
        stockQuantity: product.stock_quantity,
        quantityAvailable: product.stock_quantity == null || row.quantity <= product.stock_quantity,
        verified: true
      };
    } catch (error) {
      if (!['CATALOG_UNAVAILABLE', 'CATALOG_RESPONSE_INVALID', 'PRODUCT_NOT_FOUND'].includes(error?.code)) throw error;
      const productRemoved = error?.code === 'PRODUCT_NOT_FOUND';
      if (productRemoved) {
        await database.execute(
          `UPDATE catalog_product_refs
              SET is_available = 0, stock_quantity = 0, last_verified_at = UTC_TIMESTAMP(3)
            WHERE id = ?`,
          [row.product_ref_id]
        );
      }
      return {
        productId: row.external_id,
        quantity: row.quantity,
        name: row.last_known_name,
        imageUrl: row.last_known_image_url,
        brand: row.last_known_brand,
        unitPrice: row.last_verified_price,
        isAvailable: productRemoved ? false : Boolean(row.is_available),
        stockQuantity: productRemoved ? 0 : row.stock_quantity,
        quantityAvailable: productRemoved ? false : row.stock_quantity == null || row.quantity <= Number(row.stock_quantity),
        verified: productRemoved
      };
    }
  }));

  const pricedItems = items.filter((item) => item.verified && item.isAvailable && item.quantityAvailable);
  const subtotalCents = pricedItems.reduce((sum, item) => sum + decimalToCents(item.unitPrice) * item.quantity, 0);
  const feeCents = items.length && pricedItems.length === items.length ? deliveryFeeCents(subtotalCents) : 0;
  return {
    id: cart.public_id,
    version: cart.version,
    items,
    currency: 'MAD',
    subtotal: centsToDecimal(subtotalCents),
    deliveryFee: centsToDecimal(feeCents),
    total: centsToDecimal(subtotalCents + feeCents),
    checkoutReady: items.length > 0 && pricedItems.length === items.length,
    updatedAt: cart.updated_at
  };
}

export function createCartRouter(catalog) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    res.set('Cache-Control', 'no-store').json({ cart: await renderCart(req.app.locals.db, catalog, req.auth.userId) });
  });

  router.post('/items', async (req, res) => {
    const input = itemSchema.parse(req.body);
    const product = await catalog.getProduct(input.productId, { refresh: true });
    if (!product.is_available) throw conflict('PRODUCT_UNAVAILABLE', 'This product is currently unavailable.');
    if (product.stock_quantity != null && input.quantity > product.stock_quantity) {
      throw conflict('QUANTITY_UNAVAILABLE', 'The requested quantity is unavailable.', { available: product.stock_quantity });
    }
    await inTransaction(req.app.locals.db, async (connection) => {
      const cart = await cartForUpdate(connection, req.auth.userId);
      const productRefId = await upsertProductRef(connection, product);
      const [existingRows] = await connection.execute(
        'SELECT quantity FROM cart_items WHERE cart_id = ? AND product_ref_id = ? LIMIT 1 FOR UPDATE',
        [cart.id, productRefId]
      );
      const inCart = Number(existingRows[0]?.quantity || 0);
      const quantity = inCart + input.quantity;
      if (quantity > 99) {
        throw conflict('QUANTITY_LIMIT_EXCEEDED', 'A cart item cannot exceed 99 units.', {
          maximum: 99,
          inCart
        });
      }
      if (product.stock_quantity != null && quantity > product.stock_quantity) {
        throw conflict('QUANTITY_UNAVAILABLE', 'The requested quantity is unavailable.', {
          available: product.stock_quantity,
          inCart
        });
      }
      await connection.execute(
        `INSERT INTO cart_items (cart_id, product_ref_id, quantity, last_verified_price, verified_at)
         VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE quantity = VALUES(quantity),
           last_verified_price = VALUES(last_verified_price), verified_at = UTC_TIMESTAMP(3)`,
        [cart.id, productRefId, quantity, product.price]
      );
      await connection.execute('UPDATE carts SET version = version + 1 WHERE id = ?', [cart.id]);
    });
    res.status(201).json({ cart: await renderCart(req.app.locals.db, catalog, req.auth.userId) });
  });

  router.put('/items/:productId', async (req, res) => {
    const productId = productIdSchema.parse(req.params.productId);
    const input = quantitySchema.parse(req.body);
    const product = await catalog.getProduct(productId, { refresh: true });
    if (!product.is_available) throw conflict('PRODUCT_UNAVAILABLE', 'This product is currently unavailable.');
    if (product.stock_quantity != null && input.quantity > product.stock_quantity) {
      throw conflict('QUANTITY_UNAVAILABLE', 'The requested quantity is unavailable.', { available: product.stock_quantity });
    }
    const changed = await inTransaction(req.app.locals.db, async (connection) => {
      const cart = await cartForUpdate(connection, req.auth.userId);
      const productRefId = await upsertProductRef(connection, product);
      const [result] = await connection.execute(
        `UPDATE cart_items SET quantity = ?, last_verified_price = ?, verified_at = UTC_TIMESTAMP(3)
          WHERE cart_id = ? AND product_ref_id = ?`,
        [input.quantity, product.price, cart.id, productRefId]
      );
      if (result.affectedRows) await connection.execute('UPDATE carts SET version = version + 1 WHERE id = ?', [cart.id]);
      return result.affectedRows;
    });
    if (!changed) throw notFound('CART_ITEM_NOT_FOUND', 'The cart item was not found.');
    res.json({ cart: await renderCart(req.app.locals.db, catalog, req.auth.userId) });
  });

  router.delete('/items/:productId', async (req, res) => {
    const productId = productIdSchema.parse(req.params.productId);
    const changed = await inTransaction(req.app.locals.db, async (connection) => {
      const cart = await cartForUpdate(connection, req.auth.userId);
      const [result] = await connection.execute(
        `DELETE ci FROM cart_items ci
          JOIN catalog_product_refs r ON r.id = ci.product_ref_id
         WHERE ci.cart_id = ? AND r.external_id = ?`,
        [cart.id, productId]
      );
      if (result.affectedRows) await connection.execute('UPDATE carts SET version = version + 1 WHERE id = ?', [cart.id]);
      return result.affectedRows;
    });
    if (!changed) throw notFound('CART_ITEM_NOT_FOUND', 'The cart item was not found.');
    res.status(204).end();
  });

  router.delete('/', async (req, res) => {
    await inTransaction(req.app.locals.db, async (connection) => {
      const cart = await cartForUpdate(connection, req.auth.userId);
      await connection.execute('DELETE FROM cart_items WHERE cart_id = ?', [cart.id]);
      await connection.execute('UPDATE carts SET version = version + 1 WHERE id = ?', [cart.id]);
    });
    res.status(204).end();
  });

  router.post('/merge', async (req, res) => {
    const input = mergeSchema.parse(req.body);
    const idempotencyKey = req.get('idempotency-key');
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw conflict('IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.');
    }
    const keyStatus = cartMergeKeyStatus(idempotencyKey);
    if (keyStatus === 'invalid') {
      throw conflict('IDEMPOTENCY_KEY_INVALID', 'The cart merge idempotency key is invalid.');
    }
    if (keyStatus === 'expired') {
      throw conflict('IDEMPOTENCY_KEY_EXPIRED', 'This cart merge attempt has expired and was not applied.');
    }
    const keyDigest = createHash('sha256').update(idempotencyKey).digest();
    const bodyDigest = cartMergeRequestDigest(input);
    await req.app.locals.db.execute(
      `DELETE FROM cart_merge_idempotency
        WHERE created_at < UTC_TIMESTAMP(3) - INTERVAL ${cartMergeIdempotencyLedgerRetentionMinutes} MINUTE
        ORDER BY created_at LIMIT 500`
    );
    const existing = await existingMergeForKey(req.app.locals.db, req.auth.userId, keyDigest);
    if (existing) {
      if (!Buffer.from(existing.request_digest).equals(bodyDigest)) {
        throw conflict('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different cart merge.');
      }
      return res.json({ cart: await renderCart(req.app.locals.db, catalog, req.auth.userId), replayed: true });
    }

    const quantities = new Map();
    input.items.forEach((item) => quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity));
    const excessive = [...quantities].find(([, quantity]) => quantity > 99);
    if (excessive) {
      throw conflict('QUANTITY_LIMIT_EXCEEDED', 'A merged product quantity exceeds the limit of 99.', {
        productId: excessive[0], maximum: 99
      });
    }
    if (quantities.size === 0) {
      return res.json({ cart: await renderCart(req.app.locals.db, catalog, req.auth.userId), replayed: false });
    }
    const products = (await Promise.all([...quantities.keys()].map((id) => catalog.getProduct(id, { refresh: true }))))
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));
    const unavailable = products.filter((product) => !product.is_available).map((product) => product.id);
    if (unavailable.length) throw conflict('PRODUCTS_UNAVAILABLE', 'Some products are currently unavailable.', { productIds: unavailable });

    let replayed = false;
    await inTransaction(req.app.locals.db, async (connection) => {
      const cart = await cartForUpdate(connection, req.auth.userId);
      const lockedExisting = await existingMergeForKey(connection, req.auth.userId, keyDigest, { lock: true });
      if (lockedExisting) {
        if (!Buffer.from(lockedExisting.request_digest).equals(bodyDigest)) {
          throw conflict('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different cart merge.');
        }
        replayed = true;
        return;
      }
      for (const product of products) {
        const requested = quantities.get(product.id);
        const productRefId = await upsertProductRef(connection, product);
        const [existingRows] = await connection.execute(
          'SELECT quantity FROM cart_items WHERE cart_id = ? AND product_ref_id = ? LIMIT 1 FOR UPDATE',
          [cart.id, productRefId]
        );
        const quantity = Number(existingRows[0]?.quantity || 0) + requested;
        if (quantity > 99) {
          throw conflict('QUANTITY_LIMIT_EXCEEDED', 'The merged quantity exceeds the limit of 99.', {
            productId: product.id,
            maximum: 99,
            inCart: Number(existingRows[0]?.quantity || 0)
          });
        }
        if (product.stock_quantity != null && quantity > product.stock_quantity) {
          throw conflict('QUANTITY_UNAVAILABLE', 'The merged quantity is unavailable.', {
            productId: product.id,
            available: product.stock_quantity,
            inCart: Number(existingRows[0]?.quantity || 0)
          });
        }
        await connection.execute(
          `INSERT INTO cart_items (cart_id, product_ref_id, quantity, last_verified_price, verified_at)
           VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE quantity = VALUES(quantity),
              last_verified_price = VALUES(last_verified_price), verified_at = UTC_TIMESTAMP(3)`,
          [cart.id, productRefId, quantity, product.price]
        );
      }
      if (products.length) await connection.execute('UPDATE carts SET version = version + 1 WHERE id = ?', [cart.id]);
      await connection.execute(
        'INSERT INTO cart_merge_idempotency (user_id, key_digest, request_digest) VALUES (?, ?, ?)',
        [req.auth.userId, keyDigest, bodyDigest]
      );
    });
    res.json({ cart: await renderCart(req.app.locals.db, catalog, req.auth.userId), replayed });
  });

  return router;
}
