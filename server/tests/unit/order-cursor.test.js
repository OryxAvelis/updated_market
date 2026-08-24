import { describe, expect, it } from 'vitest';
import {
  decodeOrderCursor,
  encodeOrderCursor,
  isReturnWindowOpen,
  returnWindowMetadata
} from '../../src/orders/routes.js';

describe('order history cursor', () => {
  it('round-trips a stable timestamp and public order id tie-breaker', () => {
    const cursor = encodeOrderCursor({
      placedAt: '2026-08-24T01:02:03.456Z',
      orderId: '0198d0ee-5d4c-7000-8000-000000000001'
    });

    expect(decodeOrderCursor(cursor)).toEqual({
      placedAt: new Date('2026-08-24T01:02:03.456Z'),
      orderId: '0198d0ee-5d4c-7000-8000-000000000001'
    });
  });

  it('treats MySQL dateStrings output as UTC rather than host-local time', () => {
    const cursor = encodeOrderCursor({
      placedAt: '2026-08-24 01:02:03.456',
      orderId: '0198d0ee-5d4c-7000-8000-000000000001'
    });

    expect(decodeOrderCursor(cursor).placedAt.toISOString()).toBe('2026-08-24T01:02:03.456Z');
  });

  it('accepts a legacy timestamp cursor during rolling deployments', () => {
    expect(decodeOrderCursor('2026-08-24T01:02:03.456Z')).toEqual({
      placedAt: new Date('2026-08-24T01:02:03.456Z'),
      orderId: null
    });
  });

  it('accepts the legacy raw MySQL timestamp as UTC', () => {
    expect(decodeOrderCursor('2026-08-24 01:02:03.456')).toEqual({
      placedAt: new Date('2026-08-24T01:02:03.456Z'),
      orderId: null
    });
  });

  it.each(['', 'not-a-cursor', 'e30'])('rejects an invalid cursor: %s', (cursor) => {
    expect(() => decodeOrderCursor(cursor)).toThrow();
  });
});

describe('return-window time handling', () => {
  const deliveredAt = '2026-08-17 01:02:03.456';
  const exactBoundary = Date.parse('2026-08-24T01:02:03.456Z');

  it('keeps a MySQL UTC delivery timestamp eligible through the exact seven-day boundary', () => {
    expect(isReturnWindowOpen(deliveredAt, exactBoundary)).toBe(true);
  });

  it('closes immediately after the seven-day boundary', () => {
    expect(isReturnWindowOpen(deliveredAt, exactBoundary + 1)).toBe(false);
  });

  it('does not open before the authoritative delivery timestamp', () => {
    expect(returnWindowMetadata('delivered', deliveredAt, Date.parse('2026-08-17T01:02:03.455Z'))).toEqual({
      returnEligible: false,
      returnDeadline: '2026-08-24T01:02:03.456Z'
    });
  });

  it('exposes the authoritative UTC deadline and exact-boundary eligibility', () => {
    expect(returnWindowMetadata('delivered', deliveredAt, exactBoundary)).toEqual({
      returnEligible: true,
      returnDeadline: '2026-08-24T01:02:03.456Z'
    });
    expect(returnWindowMetadata('delivered', deliveredAt, exactBoundary + 1)).toEqual({
      returnEligible: false,
      returnDeadline: '2026-08-24T01:02:03.456Z'
    });
  });

  it('uses order state as well as time and handles orders without a delivery timestamp', () => {
    expect(returnWindowMetadata('cancelled', deliveredAt, exactBoundary - 1)).toEqual({
      returnEligible: false,
      returnDeadline: '2026-08-24T01:02:03.456Z'
    });
    expect(returnWindowMetadata('delivered', null, exactBoundary)).toEqual({
      returnEligible: false,
      returnDeadline: null
    });
  });
});
