import { centsToDecimal } from '../money.js';

export const defaultStoreDeliverySettings = Object.freeze({
  defaultFeeCents: 2000,
  freeDeliveryThresholdCents: 20000,
  revision: '0'
});

export async function loadStoreDeliverySettings(database, { forUpdate = false } = {}) {
  const [rows] = await database.execute(
    `SELECT default_fee_cents, free_delivery_threshold_cents, workspace_revision
       FROM store_delivery_settings WHERE singleton_id = 1 LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`
  );
  const row = rows[0];
  if (!row) return { ...defaultStoreDeliverySettings };
  const defaultFeeCents = Number(row.default_fee_cents);
  const freeDeliveryThresholdCents = Number(row.free_delivery_threshold_cents);
  const revision = String(row.workspace_revision);
  if (!Number.isSafeInteger(defaultFeeCents) || defaultFeeCents < 0 ||
      !Number.isSafeInteger(freeDeliveryThresholdCents) || freeDeliveryThresholdCents < 0 ||
      !/^(0|[1-9][0-9]{0,19})$/.test(revision)) {
    throw new Error('Stored delivery settings are invalid.');
  }
  return { defaultFeeCents, freeDeliveryThresholdCents, revision };
}

export function publicStorefrontConfig(settings) {
  return {
    delivery: {
      currency: 'MAD',
      revision: settings.revision,
      defaultFee: centsToDecimal(settings.defaultFeeCents),
      defaultFeeCents: settings.defaultFeeCents,
      freeThreshold: centsToDecimal(settings.freeDeliveryThresholdCents),
      freeThresholdCents: settings.freeDeliveryThresholdCents
    }
  };
}
