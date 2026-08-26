import { describe, expect, it } from 'vitest';
import { centsToDecimal, decimalToCents, deliveryFeeCents } from '../../src/money.js';

describe('exact money conversion', () => {
  it.each([
    ['0', 0],
    ['0.00', 0],
    ['1', 100],
    ['1.2', 120],
    ['1.23', 123],
    ['001.05', 105],
    [200, 20000],
    ['90071992547409.91', Number.MAX_SAFE_INTEGER]
  ])('converts %p to integer centimes', (input, expected) => {
    expect(decimalToCents(input)).toBe(expected);
  });

  it.each([
    '', null, undefined, '-1.00', '+1.00', '1.234', '1.', '.50',
    '1e2', '1,20', 'NaN', 'Infinity', '90071992547409.92'
  ])('rejects a non-canonical or unsafe amount: %p', (input) => {
    expect(() => decimalToCents(input)).toThrow(expect.objectContaining({ code: 'INVALID_MONEY' }));
  });

  it.each([
    [0, '0.00'],
    [1, '0.01'],
    [99, '0.99'],
    [100, '1.00'],
    [12345, '123.45'],
    [Number.MAX_SAFE_INTEGER, '90071992547409.91']
  ])('formats %i centimes without floating-point arithmetic', (input, expected) => {
    expect(centsToDecimal(input)).toBe(expected);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid centime count: %p',
    (input) => expect(() => centsToDecimal(input)).toThrow(TypeError)
  );
});

describe('delivery fee boundary', () => {
  it.each([
    [0, 2000],
    [1, 2000],
    [19999, 2000],
    [20000, 0],
    [20001, 0],
    [999999, 0]
  ])('charges the expected fee for a subtotal of %i centimes', (subtotal, expected) => {
    expect(deliveryFeeCents(subtotal)).toBe(expected);
  });

  it('uses typed store delivery settings when provided', () => {
    const settings = { defaultFeeCents: 1750, freeDeliveryThresholdCents: 25000 };
    expect(deliveryFeeCents(24999, settings)).toBe(1750);
    expect(deliveryFeeCents(25000, settings)).toBe(0);
  });
});
