import { createHash, randomUUID } from 'node:crypto';

export function uniqueEmail(label, trackedEmails) {
  const email = `am-market-${label}-${randomUUID()}@example.com`.toLowerCase();
  trackedEmails?.add(email);
  return email;
}

export function uniqueProduct(label, trackedProductIds, overrides = {}) {
  const id = `test-${label}-${randomUUID()}`;
  trackedProductIds?.add(id);
  const price = overrides.price || '12.34';
  const [whole, fraction = ''] = String(price).split('.');
  return {
    id,
    name: overrides.name || `Test ${label} product`,
    price,
    priceCents: Number(whole) * 100 + Number(fraction.padEnd(2, '0')),
    image_url: overrides.image_url || 'https://example.com/test-product.png',
    brand_name: overrides.brand_name || 'AM Test',
    category: overrides.category || 'test-category',
    category_name: overrides.category_name || 'Test category',
    is_available: overrides.is_available ?? true,
    stock_quantity: overrides.stock_quantity ?? 50,
    ...overrides
  };
}

export function createMockCatalog(products = []) {
  const records = new Map(products.map((product) => [String(product.id), structuredClone(product)]));
  return {
    records,
    async getProduct(productId) {
      const product = records.get(String(productId));
      if (!product) {
        throw Object.assign(new Error('The integration-test catalog received an unknown product ID.'), {
          status: 404,
          code: 'PRODUCT_NOT_FOUND'
        });
      }
      return structuredClone(product);
    },
    async listProducts({ search, category } = {}) {
      const query = String(search || '').toLowerCase();
      const results = [...records.values()].filter((product) => {
        if (query && !product.name.toLowerCase().includes(query)) return false;
        if (category && String(product.category) !== String(category)) return false;
        return true;
      });
      return { count: results.length, next: null, previous: null, results: structuredClone(results) };
    },
    async listCategories() {
      return [];
    },
    clearCache() {}
  };
}

export function createMockMailer() {
  const deliveries = [];
  return {
    deliveries,
    async sendPasswordReset(message) {
      deliveries.push({ ...message });
      return true;
    }
  };
}

function placeholders(values) {
  return values.map(() => '?').join(', ');
}

export async function cleanupIntegrationData(
  database,
  trackedEmails,
  trackedProductIds,
  trackedGuestOrderIds = new Set(),
  trackedGuestTokens = new Set()
) {
  if (!database) return;
  const emails = [...trackedEmails];
  const productIds = [...trackedProductIds];
  const guestOrderPublicIds = [...trackedGuestOrderIds];
  const guestAccessDigests = [...trackedGuestTokens]
    .map((token) => createHash('sha256').update(token).digest());
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    let userIds = [];
    if (emails.length) {
      const [users] = await connection.execute(
        `SELECT id FROM users WHERE email_normalized IN (${placeholders(emails)}) FOR UPDATE`,
        emails
      );
      userIds = users.map((row) => row.id);
    }

    let allOrderIds = [];
    if (userIds.length) {
      const userPlaceholders = placeholders(userIds);
      const [orders] = await connection.execute(
        `SELECT id FROM orders WHERE user_id IN (${userPlaceholders}) FOR UPDATE`,
        userIds
      );
      const orderIds = orders.map((row) => row.id);
      allOrderIds = [...orderIds];

      await connection.execute(
        `DELETE ri FROM return_items ri
          JOIN return_requests rr ON rr.id = ri.return_id
         WHERE rr.user_id IN (${userPlaceholders})`,
        userIds
      );
      await connection.execute(`DELETE FROM return_requests WHERE user_id IN (${userPlaceholders})`, userIds);
      await connection.execute(`DELETE FROM order_cancellations WHERE user_id IN (${userPlaceholders})`, userIds);
      await connection.execute(`DELETE FROM reviews WHERE user_id IN (${userPlaceholders})`, userIds);
      await connection.execute(`DELETE FROM notifications WHERE user_id IN (${userPlaceholders})`, userIds);
      await connection.execute(`DELETE FROM checkout_idempotency WHERE user_id IN (${userPlaceholders})`, userIds);

    }

    let guestOrderIds = [];
    if (guestOrderPublicIds.length) {
      const [guestOrders] = await connection.execute(
        `SELECT id FROM orders
          WHERE user_id IS NULL AND public_id IN (${placeholders(guestOrderPublicIds)})
          FOR UPDATE`,
        guestOrderPublicIds
      );
      guestOrderIds = guestOrders.map((row) => row.id);
      allOrderIds.push(...guestOrderIds);
    }

    if (allOrderIds.length) {
      await connection.execute(
        `DELETE FROM fulfillment_webhook_events
          WHERE order_id IN (${placeholders(allOrderIds)})`,
        allOrderIds
      );
      await connection.execute(
        `DELETE FROM outbox_events
          WHERE aggregate_type = 'order' AND aggregate_id IN (${placeholders(allOrderIds)})`,
        allOrderIds.map(String)
      );
    }
    if (userIds.length) {
      const userPlaceholders = placeholders(userIds);
      await connection.execute(`DELETE FROM orders WHERE user_id IN (${userPlaceholders})`, userIds);
      await connection.execute(`DELETE FROM local_demo_accounts WHERE user_id IN (${userPlaceholders})`, userIds);
      await connection.execute(`DELETE FROM users WHERE id IN (${userPlaceholders})`, userIds);
    }
    if (guestOrderIds.length) {
      await connection.execute(
        `DELETE FROM orders WHERE id IN (${placeholders(guestOrderIds)})`,
        guestOrderIds
      );
    }

    if (guestAccessDigests.length) {
      await connection.execute(
        `DELETE FROM guest_checkout_claims
          WHERE access_digest IN (${placeholders(guestAccessDigests)})`,
        guestAccessDigests
      );
    }

    if (productIds.length) {
      await connection.execute(
        `DELETE FROM catalog_product_refs WHERE external_id IN (${placeholders(productIds)})`,
        productIds
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
