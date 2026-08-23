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

export function deliveryFeeCents(subtotalCents) {
  return subtotalCents >= 20000 ? 0 : 2000;
}
