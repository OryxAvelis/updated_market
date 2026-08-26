import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createAdminWorkspaceRouter } from '../../src/admin/workspace-routes.js';
import { errorHandler } from '../../src/http/error-handler.js';
import { createStorefrontConfigRouter } from '../../src/storefront/routes.js';

function createWorkspaceDatabase() {
  const documents = new Map();
  const administrators = new Map([
    [1, { publicId: 'owner-public-id', displayName: 'Owner' }],
    [2, { publicId: 'manager-public-id', displayName: 'Manager' }],
    [3, { publicId: 'support-public-id', displayName: 'Support' }]
  ]);
  const database = {
    documents,
    delivery: {
      defaultFeeCents: 2000,
      freeDeliveryThresholdCents: 20000,
      workspaceRevision: 0,
      updatedBy: null
    },
    async execute(sql, params = []) {
      if (sql.includes('FROM admin_workspace_documents workspace')) {
        const resource = sql.includes('WHERE workspace.resource = ?') ? params[0] : null;
        return [[...documents.values()]
          .filter((row) => !resource || row.resource === resource)
          .sort((left, right) => left.resource.localeCompare(right.resource))
          .map((row) => ({
            ...row,
            admin_public_id: administrators.get(row.updated_by).publicId,
            admin_display_name: administrators.get(row.updated_by).displayName
          }))];
      }
      if (sql.includes('FROM store_delivery_settings')) {
        return [[{
          default_fee_cents: database.delivery.defaultFeeCents,
          free_delivery_threshold_cents: database.delivery.freeDeliveryThresholdCents,
          workspace_revision: database.delivery.workspaceRevision
        }]];
      }
      throw new Error(`Unexpected workspace pool SQL: ${sql}`);
    },
    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async execute(sql, params = []) {
          if (sql.includes('FROM admin_workspace_documents workspace')) {
            return database.execute(sql, params);
          }
          if (sql.includes('FROM store_delivery_settings')) {
            return database.execute(sql, params);
          }
          if (sql.includes('SELECT revision FROM admin_workspace_documents')) {
            const row = documents.get(params[0]);
            return [row ? [{ revision: row.revision }] : []];
          }
          if (sql.includes('INSERT INTO admin_workspace_documents')) {
            const [resource, revision, serialized, updatedBy] = params;
            if (documents.has(resource)) {
              throw Object.assign(new Error('Duplicate resource'), { code: 'ER_DUP_ENTRY' });
            }
            documents.set(resource, {
              resource,
              revision,
              document: JSON.parse(serialized),
              updated_by: updatedBy,
              updated_at: new Date('2026-08-26T12:00:00.000Z')
            });
            return [{ affectedRows: 1 }];
          }
          if (sql.includes('UPDATE admin_workspace_documents')) {
            const [serialized, updatedBy, resource, expectedRevision] = params;
            const current = documents.get(resource);
            if (!current || current.revision !== expectedRevision) return [{ affectedRows: 0 }];
            documents.set(resource, {
              ...current,
              revision: current.revision + 1,
              document: JSON.parse(serialized),
              updated_by: updatedBy,
              updated_at: new Date('2026-08-26T12:01:00.000Z')
            });
            return [{ affectedRows: 1 }];
          }
          if (sql.includes('INSERT INTO store_delivery_settings')) {
            const [defaultFeeCents, freeDeliveryThresholdCents, workspaceRevision, updatedBy] = params;
            database.delivery = {
              defaultFeeCents,
              freeDeliveryThresholdCents,
              workspaceRevision,
              updatedBy
            };
            return [{ affectedRows: 1 }];
          }
          throw new Error(`Unexpected workspace transaction SQL: ${sql}`);
        }
      };
    }
  };
  return database;
}

function adminApp(database) {
  const app = express();
  app.locals.db = database;
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.get('x-test-role');
    const identity = {
      owner: { adminId: 1, id: 'owner-public-id' },
      manager: { adminId: 2, id: 'manager-public-id' },
      support: { adminId: 3, id: 'support-public-id' }
    }[role];
    req.adminAuth = identity ? {
      adminId: identity.adminId,
      admin: { id: identity.id, role }
    } : null;
    next();
  });
  app.use('/api/v1/admin', createAdminWorkspaceRouter());
  app.use(errorHandler);
  return app;
}

describe('administrator workspace documents', () => {
  it('allows support reads, restricts writes, and persists revisions across sessions', async () => {
    const database = createWorkspaceDatabase();
    const app = adminApp(database);

    const initial = await request(app).get('/api/v1/admin/workspace').set('x-test-role', 'support');
    expect(initial.status).toBe(200);
    expect(Object.keys(initial.body.documents)).toEqual([
      'products', 'categories', 'inventory', 'promotions', 'delivery', 'settings'
    ]);
    expect(initial.body.documents.settings).toMatchObject({
      revision: 0,
      updatedAt: null,
      document: { version: 1, storeName: 'AM MARKET' }
    });

    const supportWrite = await request(app)
      .put('/api/v1/admin/workspace/settings')
      .set('x-test-role', 'support')
      .send({ expectedRevision: 0, document: { version: 1, storeName: 'Nope', email: '', phone: '', address: '' } });
    expect(supportWrite.status).toBe(403);
    expect(supportWrite.body.error.code).toBe('ADMIN_ROLE_REQUIRED');

    const ownerWrite = await request(app)
      .put('/api/v1/admin/workspace/settings')
      .set('x-test-role', 'owner')
      .send({
        expectedRevision: 0,
        document: { version: 1, storeName: 'AM MARKET Casablanca', email: '', phone: '', address: '' }
      });
    expect(ownerWrite.status).toBe(200);
    expect(ownerWrite.body).toMatchObject({
      resource: 'settings',
      revision: 1,
      document: { storeName: 'AM MARKET Casablanca' },
      updatedBy: { id: 'owner-public-id' }
    });
    expect(database.documents.get('settings').updated_by).toBe(1);

    const otherSessionRead = await request(app)
      .get('/api/v1/admin/workspace/settings')
      .set('x-test-role', 'manager');
    expect(otherSessionRead.status).toBe(200);
    expect(otherSessionRead.body.document.storeName).toBe('AM MARKET Casablanca');
    expect(otherSessionRead.body.revision).toBe(1);

    const managerWrite = await request(app)
      .put('/api/v1/admin/workspace/settings')
      .set('x-test-role', 'manager')
      .send({
        expectedRevision: 1,
        document: { version: 1, storeName: 'AM MARKET Maroc', email: '', phone: '', address: '' }
      });
    expect(managerWrite.status).toBe(200);
    expect(managerWrite.body.revision).toBe(2);
    expect(database.documents.get('settings').updated_by).toBe(2);

    const staleWrite = await request(app)
      .put('/api/v1/admin/workspace/settings')
      .set('x-test-role', 'owner')
      .send({
        expectedRevision: 1,
        document: { version: 1, storeName: 'Stale', email: '', phone: '', address: '' }
      });
    expect(staleWrite.status).toBe(409);
    expect(staleWrite.body.error).toMatchObject({
      code: 'ADMIN_WORKSPACE_REVISION_CONFLICT',
      details: { resource: 'settings', expectedRevision: 1, currentRevision: 2 }
    });
  });

  it('validates documents and atomically projects delivery money into typed cents', async () => {
    const database = createWorkspaceDatabase();
    const app = adminApp(database);

    const invalid = await request(app)
      .put('/api/v1/admin/workspace/delivery')
      .set('x-test-role', 'owner')
      .send({
        expectedRevision: 0,
        document: { version: 1, defaultFee: 20.123, freeThreshold: 200, zones: [] }
      });
    expect(invalid.status).toBe(422);
    expect(database.documents.has('delivery')).toBe(false);

    const saved = await request(app)
      .put('/api/v1/admin/workspace/delivery')
      .set('x-test-role', 'owner')
      .send({
        expectedRevision: 0,
        document: {
          version: 1,
          defaultFee: 17.5,
          freeThreshold: 250,
          zones: [{
            id: 'casablanca',
            name: 'Casablanca draft',
            coverage: 'Draft only; not used by checkout',
            fee: 10,
            enabled: true
          }]
        }
      });
    expect(saved.status).toBe(200);
    expect(database.delivery).toEqual({
      defaultFeeCents: 1750,
      freeDeliveryThresholdCents: 25000,
      workspaceRevision: '1',
      updatedBy: 1
    });

    const zoneOnlySave = await request(app)
      .put('/api/v1/admin/workspace/delivery')
      .set('x-test-role', 'manager')
      .send({
        expectedRevision: 1,
        document: {
          ...saved.body.document,
          zones: [{
            ...saved.body.document.zones[0],
            coverage: 'Updated planning draft only'
          }]
        }
      });
    expect(zoneOnlySave.status).toBe(200);
    expect(zoneOnlySave.body.revision).toBe(2);
    expect(database.delivery).toEqual({
      defaultFeeCents: 1750,
      freeDeliveryThresholdCents: 25000,
      workspaceRevision: '1',
      updatedBy: 1
    });
  });

  it('normalizes mysql2 string JSON and treats corrupt persisted data as a server fault', async () => {
    const database = createWorkspaceDatabase();
    database.documents.set('settings', {
      resource: 'settings',
      revision: 1,
      document: JSON.stringify({
        version: 1,
        storeName: 'Stored as JSON text',
        email: '',
        phone: '',
        address: ''
      }),
      updated_by: 1,
      updated_at: new Date('2026-08-26T12:00:00.000Z')
    });
    const app = adminApp(database);

    const parsed = await request(app)
      .get('/api/v1/admin/workspace/settings')
      .set('x-test-role', 'support');
    expect(parsed.status).toBe(200);
    expect(parsed.body.document).toMatchObject({ storeName: 'Stored as JSON text' });

    database.documents.get('settings').document = JSON.stringify({ version: 2 });
    const invalidShape = await request(app)
      .get('/api/v1/admin/workspace/settings')
      .set('x-test-role', 'support');
    expect(invalidShape.status).toBe(500);
    expect(invalidShape.body.error.code).toBe('INTERNAL_ERROR');

    database.documents.get('settings').document = '{broken';
    const corrupt = await request(app)
      .get('/api/v1/admin/workspace/settings')
      .set('x-test-role', 'support');
    expect(corrupt.status).toBe(500);
    expect(corrupt.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong. Please try again.'
      }
    });
  });

  it('rejects prototype-reserved overlay identifiers', async () => {
    const database = createWorkspaceDatabase();
    const app = adminApp(database);
    const document = JSON.parse(
      '{"version":1,"created":[],"patches":{"__proto__":{}},"hiddenIds":[],"hiddenMeta":{}}'
    );

    const response = await request(app)
      .put('/api/v1/admin/workspace/products')
      .set('x-test-role', 'manager')
      .send({ expectedRevision: 0, document });

    expect(response.status).toBe(422);
    expect(database.documents.has('products')).toBe(false);
  });
});

describe('public storefront configuration', () => {
  it('exposes only sanitized delivery values', async () => {
    const database = createWorkspaceDatabase();
    database.delivery.defaultFeeCents = 1750;
    database.delivery.freeDeliveryThresholdCents = 25000;
    const app = express();
    app.locals.db = database;
    app.use('/api/v1/storefront', createStorefrontConfigRouter());
    app.use(errorHandler);

    const response = await request(app).get('/api/v1/storefront/config');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      delivery: {
        currency: 'MAD',
        defaultFee: '17.50',
        defaultFeeCents: 1750,
        freeThreshold: '250.00',
        freeThresholdCents: 25000,
        revision: '0'
      }
    });
    expect(response.body).not.toHaveProperty('updatedBy');
  });
});
