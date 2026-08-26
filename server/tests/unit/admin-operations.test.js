import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  isAllowedAdminOrderTransition,
  isAllowedAdminReturnTransition,
  isAllowedOfflinePaymentTransition
} from '../../src/admin/operations-routes.js';

describe('administrator operation state machines', () => {
  it('permits only forward order fulfillment steps and early cancellation', () => {
    expect(isAllowedAdminOrderTransition('confirmed', 'preparing')).toBe(true);
    expect(isAllowedAdminOrderTransition('confirmed', 'cancelled')).toBe(true);
    expect(isAllowedAdminOrderTransition('preparing', 'shipping')).toBe(true);
    expect(isAllowedAdminOrderTransition('preparing', 'cancelled')).toBe(true);
    expect(isAllowedAdminOrderTransition('shipping', 'delivered')).toBe(true);

    expect(isAllowedAdminOrderTransition('confirmed', 'delivered')).toBe(false);
    expect(isAllowedAdminOrderTransition('shipping', 'cancelled')).toBe(false);
    expect(isAllowedAdminOrderTransition('delivered', 'shipping')).toBe(false);
    expect(isAllowedAdminOrderTransition('cancelled', 'preparing')).toBe(false);
  });

  it('keeps return approval, receipt, and refund transitions ordered', () => {
    expect(isAllowedAdminReturnTransition('requested', 'approved')).toBe(true);
    expect(isAllowedAdminReturnTransition('requested', 'rejected')).toBe(true);
    expect(isAllowedAdminReturnTransition('approved', 'received')).toBe(true);
    expect(isAllowedAdminReturnTransition('received', 'refunded')).toBe(true);

    expect(isAllowedAdminReturnTransition('requested', 'refunded')).toBe(false);
    expect(isAllowedAdminReturnTransition('approved', 'refunded')).toBe(false);
    expect(isAllowedAdminReturnTransition('refunded', 'approved')).toBe(false);
    expect(isAllowedAdminReturnTransition('cancelled', 'received')).toBe(false);
  });

  it('settles only supported forward offline-payment states', () => {
    expect(isAllowedOfflinePaymentTransition('pending', 'paid')).toBe(true);
    expect(isAllowedOfflinePaymentTransition('pending', 'failed')).toBe(true);
    expect(isAllowedOfflinePaymentTransition('authorized', 'paid')).toBe(true);
    expect(isAllowedOfflinePaymentTransition('failed', 'paid')).toBe(true);
    expect(isAllowedOfflinePaymentTransition('paid', 'refunded')).toBe(true);

    expect(isAllowedOfflinePaymentTransition('paid', 'failed')).toBe(false);
    expect(isAllowedOfflinePaymentTransition('refunded', 'paid')).toBe(false);
    expect(isAllowedOfflinePaymentTransition('partially_refunded', 'paid')).toBe(false);
  });

  it('locks the order before the return row to match customer return creation', async () => {
    const source = await readFile(new URL('../../src/admin/operations-routes.js', import.meta.url), 'utf8');
    const orderLock = source.indexOf('FROM orders WHERE id = ? LIMIT 1 FOR UPDATE');
    const returnLock = source.indexOf('WHERE public_id = ? AND order_id = ? LIMIT 1 FOR UPDATE');

    expect(orderLock).toBeGreaterThan(-1);
    expect(returnLock).toBeGreaterThan(orderLock);
  });

  it('uses a current locking read when reconciling concurrent refunded returns', async () => {
    const source = await readFile(new URL('../../src/admin/operations-routes.js', import.meta.url), 'utf8');

    expect(source).toMatch(
      /SELECT oi\.unit_price, ri\.quantity[\s\S]*rr\.status = 'refunded'[\s\S]*ORDER BY rr\.id, ri\.id[\s\S]*FOR UPDATE/
    );
  });
});
