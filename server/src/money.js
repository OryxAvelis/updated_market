import { badRequest } from './http/errors.js';

export function decimalToCents(value) {
  const text = String(value ?? '').trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw badRequest('INVALID_MONEY', 'A catalog price was invalid.');
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] || '').padEnd(2, '0'));
  const cents = whole * 100n + fraction;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw badRequest('INVALID_MONEY', 'A catalog price was too large.');
  return Number(cents);
}

export function centsToDecimal(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new TypeError('cents must be a non-negative safe integer');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function deliveryFeeCents(subtotalCents, settings = {}) {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) {
    throw new TypeError('subtotalCents must be a non-negative safe integer');
  }
  const defaultFeeCents = settings.defaultFeeCents ?? 2000;
  const freeDeliveryThresholdCents = settings.freeDeliveryThresholdCents ?? 20000;
  if (!Number.isSafeInteger(defaultFeeCents) || defaultFeeCents < 0 ||
      !Number.isSafeInteger(freeDeliveryThresholdCents) || freeDeliveryThresholdCents < 0) {
    throw new TypeError('delivery settings must contain non-negative safe integer cents');
  }
  return subtotalCents >= freeDeliveryThresholdCents ? 0 : defaultFeeCents;
}
