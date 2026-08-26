import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createAccountRouter } from '../../src/account/routes.js';
import { createHistoryRouter, createRecommendationsRouter } from '../../src/engagement/routes.js';
import { hashPassword } from '../../src/security/passwords.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function racingDatabase({ passwordHash = '' } = {}) {
  const state = {
    personalizationEnabled: true,
    snapshots: 1,
    recentViews: 0,
    events: []
  };
  const connection = {
    async beginTransaction() { state.events.push('begin'); },
    async commit() { state.events.push('commit'); },
    async rollback() { state.events.push('rollback'); },
    release() { state.events.push('release'); },
    async execute(statement) {
      const query = statement.replace(/\s+/g, ' ').trim();
      if (query.startsWith('SELECT personalization_enabled FROM user_preferences') && query.endsWith('FOR UPDATE')) {
        state.events.push('lock-preference-writer');
        return [[{ personalization_enabled: state.personalizationEnabled ? 1 : 0 }]];
      }
      if (query === 'SELECT user_id FROM user_preferences WHERE user_id = ? LIMIT 1 FOR UPDATE') {
        state.events.push('lock-preference-account');
        return [[{ user_id: 42 }]];
      }
      if (query === 'UPDATE user_preferences SET personalization_enabled = 0 WHERE user_id = ?') {
        state.events.push('disable-personalization');
        state.personalizationEnabled = false;
        return [{ affectedRows: 1 }];
      }
      if (query === 'DELETE FROM recommendation_snapshots WHERE user_id = ?') {
        state.events.push('delete-snapshots');
        state.snapshots = 0;
        return [{ affectedRows: 1 }];
      }
      if (query.startsWith("UPDATE users SET status = 'deactivated'")) {
        state.events.push('anonymize-user');
        return [{ affectedRows: 1 }];
      }
      if (query.startsWith('UPDATE delivery_addresses SET deleted_at')) {
        state.events.push('delete-addresses');
        return [{ affectedRows: 1 }];
      }
      if (query === 'DELETE FROM recently_viewed_products WHERE user_id = ?') {
        state.events.push('delete-recent-views');
        state.recentViews = 0;
        return [{ affectedRows: 1 }];
      }
      if (query === 'DELETE FROM search_history WHERE user_id = ?') {
        state.events.push('delete-search-history');
        return [{ affectedRows: 1 }];
      }
      if (query === 'DELETE FROM notifications WHERE user_id = ?') {
        state.events.push('delete-notifications');
        return [{ affectedRows: 1 }];
      }
      if (query.startsWith('DELETE ci FROM cart_items')) {
        state.events.push('delete-cart-items');
        return [{ affectedRows: 1 }];
      }
      if (query.startsWith('DELETE wi FROM wishlist_items')) {
        state.events.push('delete-wishlist-items');
        return [{ affectedRows: 1 }];
      }
      if (query.startsWith('UPDATE auth_sessions SET revoked_at')) {
        state.events.push('revoke-sessions');
        return [{ affectedRows: 1 }];
      }
      if (/INSERT INTO (?:catalog_product_refs|recommendation_snapshots|recently_viewed_products)/.test(query)) {
        state.events.push('late-personalization-write');
        throw new Error('An opted-out request attempted a late personalization write.');
      }
      throw new Error(`Unexpected personalization transaction query: ${query}`);
    }
  };
  const database = {
    async getConnection() { return connection; },
    async execute(statement) {
      const query = statement.replace(/\s+/g, ' ').trim();
      if (query === 'SELECT personalization_enabled FROM user_preferences WHERE user_id = ? LIMIT 1') {
        state.events.push('read-preference');
        return [[{ personalization_enabled: state.personalizationEnabled ? 1 : 0 }]];
      }
      if (query.includes('SELECT p.external_id FROM recently_viewed_products')) {
        state.events.push('read-seeds');
        return [[{ external_id: 'seed-product' }]];
      }
      if (query === "SELECT password_hash FROM users WHERE id = ? AND status = 'active' LIMIT 1") {
        state.events.push('read-password');
        return [[{ password_hash: passwordHash }]];
      }
      throw new Error(`Unexpected personalization query: ${query}`);
    }
  };
  return { database, state };
}

function authenticatedApp(database, path, router) {
  const app = express();
  app.locals.db = database;
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: 42, accountKind: 'customer', user: { id: 'customer-public-id' } };
    next();
  });
  app.use(path, router);
  return app;
}

function product(id) {
  return {
    id,
    name: id,
    category: 'tea',
    image_url: null,
    brand_name: 'AM Test',
    price: '10.00',
    is_available: true,
    stock_quantity: 10
  };
}

describe('personalization opt-out concurrency', () => {
  it('does not recreate recommendation snapshots when opt-out commits during catalog work', async () => {
    const { database, state } = racingDatabase();
    const catalogStarted = deferred();
    const continueCatalog = deferred();
    const catalog = {
      async getProduct() {
        catalogStarted.resolve();
        await continueCatalog.promise;
        return product('seed-product');
      },
      async listProducts() {
        return { count: 1, results: [product('recommended-product')] };
      }
    };
    const app = authenticatedApp(
      database,
      '/api/v1/me/recommendations',
      createRecommendationsRouter(catalog)
    );

    const responsePromise = request(app).get('/api/v1/me/recommendations?limit=1').then((response) => response);
    await catalogStarted.promise;
    state.personalizationEnabled = false;
    state.snapshots = 0;
    state.events.push('opt-out-committed');
    continueCatalog.resolve();
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ products: [], personalized: false });
    expect(state.snapshots).toBe(0);
    expect(state.events).toEqual([
      'read-preference', 'read-seeds', 'opt-out-committed',
      'begin', 'lock-preference-writer', 'delete-snapshots', 'commit', 'release'
    ]);
  });

  it('does not record a recently viewed product when opt-out commits during catalog work', async () => {
    const { database, state } = racingDatabase();
    const catalogStarted = deferred();
    const continueCatalog = deferred();
    const catalog = {
      async getProduct(productId) {
        catalogStarted.resolve();
        await continueCatalog.promise;
        return product(productId);
      }
    };
    const app = authenticatedApp(database, '/api/v1/me', createHistoryRouter(catalog));

    const responsePromise = request(app)
      .post('/api/v1/me/recently-viewed')
      .send({ productId: 'viewed-product' })
      .then((response) => response);
    await catalogStarted.promise;
    state.personalizationEnabled = false;
    state.events.push('opt-out-committed');
    continueCatalog.resolve();
    const response = await responsePromise;

    expect(response.status).toBe(204);
    expect(state.recentViews).toBe(0);
    expect(state.events).toEqual([
      'read-preference', 'opt-out-committed',
      'begin', 'lock-preference-writer', 'commit', 'release'
    ]);
  });

  it('prevents an authenticated in-flight recommendation from repopulating a fully deleted account', async () => {
    const password = 'AM-delete-race-password-2026';
    const passwordHash = await hashPassword(password);
    const { database, state } = racingDatabase({ passwordHash });
    state.recentViews = 1;
    const catalogStarted = deferred();
    const continueCatalog = deferred();
    const catalog = {
      async getProduct() {
        catalogStarted.resolve();
        await continueCatalog.promise;
        return product('seed-product');
      },
      async listProducts() {
        return { count: 1, results: [product('recommended-product')] };
      }
    };
    const app = express();
    app.locals.db = database;
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { userId: 42, accountKind: 'customer', user: { id: 'customer-public-id' } };
      next();
    });
    app.use('/api/v1/me/recommendations', createRecommendationsRouter(catalog));
    app.use('/api/v1/me', createAccountRouter());

    const recommendationPromise = request(app)
      .get('/api/v1/me/recommendations?limit=1')
      .then((response) => response);
    await catalogStarted.promise;
    const deleted = await request(app)
      .delete('/api/v1/me')
      .send({ password, action: 'delete' });
    expect(deleted.status).toBe(204);
    continueCatalog.resolve();
    const recommendation = await recommendationPromise;

    expect(recommendation.status).toBe(200);
    expect(recommendation.body).toEqual({ products: [], personalized: false });
    expect(state.personalizationEnabled).toBe(false);
    expect(state.snapshots).toBe(0);
    expect(state.recentViews).toBe(0);
    expect(state.events).not.toContain('late-personalization-write');
    expect(state.events.indexOf('lock-preference-account')).toBeLessThan(
      state.events.indexOf('disable-personalization')
    );
    expect(state.events.indexOf('disable-personalization')).toBeLessThan(
      state.events.indexOf('delete-recent-views')
    );
    expect(state.events.lastIndexOf('lock-preference-writer')).toBeGreaterThan(
      state.events.indexOf('disable-personalization')
    );
  });
});
