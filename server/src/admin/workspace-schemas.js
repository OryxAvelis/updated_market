import { z } from 'zod';
import { badRequest } from '../http/errors.js';
import { decimalToCents } from '../money.js';

export const adminWorkspaceResources = Object.freeze([
  'products',
  'categories',
  'inventory',
  'promotions',
  'delivery',
  'settings'
]);

export const adminWorkspaceResourceSchema = z.enum(adminWorkspaceResources);

const prototypeReservedKeys = new Set(['__proto__', 'prototype', 'constructor']);
const safeObjectKey = z.string().max(200).refine(
  (value) => !prototypeReservedKeys.has(value),
  'Prototype-reserved object keys are not allowed.'
);
const shortId = z.string().trim().min(1).max(200).refine(
  (value) => !prototypeReservedKeys.has(value),
  'Prototype-reserved identifiers are not allowed.'
);
const timestamp = z.string().datetime({ offset: true }).optional();
const version = z.literal(1).default(1);

function withoutPrototypeReservedKeys(schema) {
  return z.unknown().superRefine((value, context) => {
    const pending = [value];
    const visited = new WeakSet();
    while (pending.length) {
      const current = pending.pop();
      if (!current || typeof current !== 'object' || visited.has(current)) continue;
      visited.add(current);
      for (const key of Object.keys(current)) {
        if (prototypeReservedKeys.has(key)) {
          context.addIssue({
            code: 'custom',
            message: 'Prototype-reserved object keys are not allowed.'
          });
          return;
        }
        pending.push(current[key]);
      }
    }
  }).pipe(schema);
}

const jsonObject = withoutPrototypeReservedKeys(z.record(safeObjectKey, z.json()));

function recordWithMaximum(valueSchema, maximum, label) {
  return withoutPrototypeReservedKeys(z.record(safeObjectKey, valueSchema)).superRefine((value, context) => {
    if (Object.keys(value).length > maximum) {
      context.addIssue({ code: 'custom', message: `${label} may contain at most ${maximum} entries.` });
    }
  });
}

const productDocumentSchema = z.object({
  version,
  created: z.array(jsonObject).max(500).default([]),
  patches: recordWithMaximum(jsonObject, 1000, 'Product patches').default({}),
  hiddenIds: z.array(shortId).max(1000).default([]),
  hiddenMeta: recordWithMaximum(jsonObject, 1000, 'Hidden product metadata').default({})
}).strict();

const categoryDocumentSchema = z.object({
  version,
  created: z.array(jsonObject).max(500).default([]),
  patches: recordWithMaximum(jsonObject, 1000, 'Category patches').default({}),
  hiddenIds: z.array(shortId).max(1000).default([])
}).strict();

const inventoryOverrideSchema = z.object({
  state: z.enum(['in', 'low', 'out', 'not-tracked']),
  quantity: z.union([
    z.string().regex(/^\d{0,9}$/),
    z.number().int().min(0).max(999999999)
  ]).optional(),
  updatedAt: timestamp
}).strict();

const inventoryDocumentSchema = recordWithMaximum(
  inventoryOverrideSchema,
  1000,
  'Inventory overrides'
);

const promotionSchema = z.object({
  id: shortId,
  name: z.string().trim().min(1).max(160),
  nameKey: z.string().trim().max(160).optional().default(''),
  code: z.string().trim().min(1).max(40),
  type: z.enum(['percent', 'fixed']),
  value: z.number().finite().positive().max(10000000),
  start: z.iso.date(),
  end: z.iso.date(),
  enabled: z.boolean(),
  updatedAt: timestamp
}).strict().superRefine((promotion, context) => {
  if (promotion.type === 'percent' && promotion.value > 100) {
    context.addIssue({ code: 'custom', path: ['value'], message: 'A percentage promotion cannot exceed 100.' });
  }
  if (promotion.end < promotion.start) {
    context.addIssue({ code: 'custom', path: ['end'], message: 'The promotion end date must not precede its start date.' });
  }
});

const promotionsDocumentSchema = z.object({
  version,
  items: z.array(promotionSchema).max(500).default([])
}).strict();

function deliveryAmount(maximum) {
  return z.number().finite().min(0).max(maximum).superRefine((value, context) => {
    try {
      decimalToCents(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Use no more than two decimal places.' });
    }
  });
}

/*
 * The typed singleton stores the default fee in an INT capped at 10,000,000
 * cents and the threshold in an INT capped at 100,000,000 cents. Keep API
 * validation aligned with those database constraints.
 */
const deliveryFeeAmount = deliveryAmount(100000);
const deliveryThresholdAmount = deliveryAmount(1000000);
const deliveryZoneAmount = deliveryAmount(1000000);

const deliveryZoneSchema = z.object({
  id: shortId,
  name: z.string().trim().min(1).max(160),
  nameKey: z.string().trim().max(160).optional(),
  coverage: z.string().trim().min(1).max(1000),
  coverageKey: z.string().trim().max(160).optional(),
  fee: deliveryZoneAmount,
  enabled: z.boolean(),
  updatedAt: timestamp
}).strict();

const deliveryDocumentSchema = z.object({
  version,
  defaultFee: deliveryFeeAmount.default(20),
  freeThreshold: deliveryThresholdAmount.default(200),
  zones: z.array(deliveryZoneSchema).max(250).default([])
}).strict();

const settingsDocumentSchema = z.object({
  version,
  storeName: z.string().trim().min(1).max(160).default('AM MARKET'),
  email: z.union([z.string().trim().email().max(254), z.literal('')]).default(''),
  phone: z.string().trim().max(40).default(''),
  address: z.string().trim().max(1000).default(''),
  updatedAt: timestamp
}).strict();

export const adminWorkspaceSchemas = Object.freeze({
  products: productDocumentSchema,
  categories: categoryDocumentSchema,
  inventory: inventoryDocumentSchema,
  promotions: promotionsDocumentSchema,
  delivery: deliveryDocumentSchema,
  settings: settingsDocumentSchema
});

export const adminWorkspaceDefaults = Object.freeze({
  products: Object.freeze({ version: 1, created: [], patches: {}, hiddenIds: [], hiddenMeta: {} }),
  categories: Object.freeze({ version: 1, created: [], patches: {}, hiddenIds: [] }),
  inventory: Object.freeze({}),
  promotions: Object.freeze({ version: 1, items: [] }),
  delivery: Object.freeze({ version: 1, defaultFee: 20, freeThreshold: 200, zones: [] }),
  settings: Object.freeze({ version: 1, storeName: 'AM MARKET', email: '', phone: '', address: '' })
});

export function defaultAdminWorkspaceDocument(resource) {
  return structuredClone(adminWorkspaceDefaults[adminWorkspaceResourceSchema.parse(resource)]);
}

export function parseAdminWorkspaceDocument(resource, document) {
  const parsedResource = adminWorkspaceResourceSchema.parse(resource);
  const parsed = adminWorkspaceSchemas[parsedResource].parse(document);
  const serialized = JSON.stringify(parsed);
  if (Buffer.byteLength(serialized, 'utf8') > 24 * 1024) {
    throw badRequest(
      'ADMIN_WORKSPACE_DOCUMENT_TOO_LARGE',
      'An administrator workspace document cannot exceed 24 KiB.'
    );
  }
  return parsed;
}

export function deliveryDocumentToCents(document) {
  return {
    defaultFeeCents: decimalToCents(document.defaultFee),
    freeDeliveryThresholdCents: decimalToCents(document.freeThreshold)
  };
}
