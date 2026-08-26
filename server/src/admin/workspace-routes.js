import { Router } from 'express';
import { z } from 'zod';
import { databaseDateToIso } from '../db/date.js';
import { conflict, forbidden } from '../http/errors.js';
import { requireAdmin } from './session.js';
import {
  adminWorkspaceResourceSchema,
  adminWorkspaceResources,
  defaultAdminWorkspaceDocument,
  deliveryDocumentToCents,
  parseAdminWorkspaceDocument
} from './workspace-schemas.js';

const writeSchema = z.object({
  expectedRevision: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  document: z.unknown()
}).strict();

function requireAdminWorkspaceMutation(req, _res, next) {
  if (['owner', 'manager'].includes(req.adminAuth?.admin?.role)) return next();
  return next(forbidden(
    'ADMIN_ROLE_REQUIRED',
    'An owner or manager role is required for this action.'
  ));
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

function serializeWorkspaceRow(resource, row) {
  return {
    resource,
    revision: row ? Number(row.revision) : 0,
    document: row
      ? parsePersistedWorkspaceDocument(resource, row.document)
      : defaultAdminWorkspaceDocument(resource),
    updatedAt: row ? databaseDateToIso(row.updated_at) : null,
    updatedBy: row ? {
      id: row.admin_public_id,
      displayName: row.admin_display_name
    } : null
  };
}

function parsePersistedWorkspaceDocument(resource, storedDocument) {
  let decoded = storedDocument;
  if (typeof storedDocument === 'string') {
    try {
      decoded = JSON.parse(storedDocument);
    } catch (cause) {
      throw new Error(`The stored ${resource} workspace document is not valid JSON.`, { cause });
    }
  }

  try {
    return parseAdminWorkspaceDocument(resource, decoded);
  } catch (cause) {
    // Persisted data is server state, so it must never be reported as a client
    // request validation error. The global error handler deliberately maps this
    // wrapper to its generic 500 response without leaking document contents.
    throw new Error(`The stored ${resource} workspace document is invalid.`, { cause });
  }
}

async function loadWorkspaceRows(database, resource = null) {
  const params = resource ? [resource] : [];
  const [rows] = await database.execute(
    `SELECT workspace.resource, workspace.revision, workspace.document,
            workspace.updated_at, admin.public_id AS admin_public_id,
            admin.display_name AS admin_display_name
       FROM admin_workspace_documents workspace
       JOIN admin_identities admin ON admin.id = workspace.updated_by
      ${resource ? 'WHERE workspace.resource = ?' : ''}
      ORDER BY workspace.resource`,
    params
  );
  return rows;
}

function revisionConflict(resource, expectedRevision, currentRevision) {
  return conflict(
    'ADMIN_WORKSPACE_REVISION_CONFLICT',
    'This workspace document changed in another administrator session. Reload it and try again.',
    { resource, expectedRevision, currentRevision }
  );
}

async function writeWorkspaceDocument(database, adminId, resource, input) {
  const document = parseAdminWorkspaceDocument(resource, input.document);
  const delivery = resource === 'delivery' ? deliveryDocumentToCents(document) : null;

  const row = await inTransaction(database, async (connection) => {
    let currentDelivery = null;
    if (delivery) {
      const [deliveryRows] = await connection.execute(
        `SELECT default_fee_cents, free_delivery_threshold_cents, workspace_revision
           FROM store_delivery_settings WHERE singleton_id = 1 LIMIT 1 FOR UPDATE`
      );
      currentDelivery = deliveryRows[0] || null;
    }
    const revision = input.expectedRevision + 1;
    if (input.expectedRevision === 0) {
      try {
        await connection.execute(
          `INSERT INTO admin_workspace_documents
            (resource, revision, document, updated_by)
           VALUES (?, ?, CAST(? AS JSON), ?)`,
          [resource, revision, JSON.stringify(document), adminId]
        );
      } catch (error) {
        if (error?.code !== 'ER_DUP_ENTRY') throw error;
        const [rows] = await connection.execute(
          'SELECT revision FROM admin_workspace_documents WHERE resource = ? LIMIT 1',
          [resource]
        );
        throw revisionConflict(resource, 0, Number(rows[0]?.revision || 0));
      }
    } else {
      const [result] = await connection.execute(
        `UPDATE admin_workspace_documents
            SET revision = revision + 1, document = CAST(? AS JSON), updated_by = ?
          WHERE resource = ? AND revision = ?`,
        [JSON.stringify(document), adminId, resource, input.expectedRevision]
      );
      if (result.affectedRows !== 1) {
        const [rows] = await connection.execute(
          'SELECT revision FROM admin_workspace_documents WHERE resource = ? LIMIT 1',
          [resource]
        );
        throw revisionConflict(
          resource,
          input.expectedRevision,
          Number(rows[0]?.revision || 0)
        );
      }
    }

    const deliveryChanged = delivery && (!currentDelivery ||
      Number(currentDelivery.default_fee_cents) !== delivery.defaultFeeCents ||
      Number(currentDelivery.free_delivery_threshold_cents) !== delivery.freeDeliveryThresholdCents);
    if (deliveryChanged) {
      const pricingRevision = (BigInt(currentDelivery?.workspace_revision || 0) + 1n).toString();
      await connection.execute(
        `INSERT INTO store_delivery_settings
          (singleton_id, default_fee_cents, free_delivery_threshold_cents,
           workspace_revision, updated_by)
         VALUES (1, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           default_fee_cents = VALUES(default_fee_cents),
           free_delivery_threshold_cents = VALUES(free_delivery_threshold_cents),
           workspace_revision = VALUES(workspace_revision),
           updated_by = VALUES(updated_by)`,
        [delivery.defaultFeeCents, delivery.freeDeliveryThresholdCents, pricingRevision, adminId]
      );
    }

    const [savedRow] = await loadWorkspaceRows(connection, resource);
    if (!savedRow) throw new Error(`The saved ${resource} workspace document could not be read.`);
    return savedRow;
  });

  return serializeWorkspaceRow(resource, row);
}

export function createAdminWorkspaceRouter() {
  const router = Router();
  router.use(requireAdmin);

  router.get('/workspace', async (req, res) => {
    const rows = await loadWorkspaceRows(req.app.locals.db);
    const byResource = new Map(rows.map((row) => [row.resource, row]));
    const documents = Object.fromEntries(adminWorkspaceResources.map((resource) => {
      const serialized = serializeWorkspaceRow(resource, byResource.get(resource));
      return [resource, {
        document: serialized.document,
        revision: serialized.revision,
        updatedAt: serialized.updatedAt,
        updatedBy: serialized.updatedBy
      }];
    }));
    res.set('Cache-Control', 'no-store').json({ documents });
  });

  router.get('/workspace/:resource', async (req, res) => {
    const resource = adminWorkspaceResourceSchema.parse(req.params.resource);
    const [row] = await loadWorkspaceRows(req.app.locals.db, resource);
    res.set('Cache-Control', 'no-store').json(serializeWorkspaceRow(resource, row));
  });

  router.put('/workspace/:resource', requireAdminWorkspaceMutation, async (req, res) => {
    const resource = adminWorkspaceResourceSchema.parse(req.params.resource);
    const input = writeSchema.parse(req.body);
    const result = await writeWorkspaceDocument(
      req.app.locals.db,
      req.adminAuth.adminId,
      resource,
      input
    );
    res.set('Cache-Control', 'no-store').json(result);
  });

  return router;
}
