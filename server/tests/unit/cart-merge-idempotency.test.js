import { describe, expect, it } from 'vitest';
import {
  cartMergeIdempotencyLedgerRetentionMs,
  cartMergeKeyStatus,
  cartMergeRequestDigest
} from '../../src/commerce/cart-routes.js';

function digest(items) {
  return cartMergeRequestDigest({ items }).toString('hex');
}

describe('cart merge idempotency digest', () => {
  it('canonicalizes item order and duplicate product quantities', () => {
    const canonical = [
      { productId: '101', quantity: 3 },
      { productId: '202', quantity: 1 }
    ];
    const equivalent = [
      { productId: '202', quantity: 1 },
      { productId: '101', quantity: 1 },
      { productId: '101', quantity: 2 }
    ];

    expect(digest(equivalent)).toBe(digest(canonical));
  });

  it('changes when an effective quantity changes', () => {
    expect(digest([{ productId: '101', quantity: 1 }]))
      .not.toBe(digest([{ productId: '101', quantity: 2 }]));
  });

  it('does not collapse an excessive duplicate sum into a valid quantity', () => {
    expect(digest([{ productId: '101', quantity: 99 }, { productId: '101', quantity: 1 }]))
      .not.toBe(digest([{ productId: '101', quantity: 99 }]));
  });

  it('accepts current versioned keys and rejects expired, future, or legacy keys', () => {
    const now = Date.UTC(2026, 7, 24, 12);
    const uuid = '2f093729-84af-4cad-9f27-6617eb80c67d';
    const keyAt = timestamp => `am1.${timestamp.toString(36)}.${uuid}`;
    expect(cartMergeKeyStatus(keyAt(now), now)).toBe('valid');
    expect(cartMergeKeyStatus(keyAt(now - (24 * 60 * 60 * 1000) - 1), now)).toBe('expired');
    expect(cartMergeKeyStatus(keyAt(now + (5 * 60 * 1000) + 1), now)).toBe('invalid');
    expect(cartMergeKeyStatus(uuid, now)).toBe('invalid');
  });

  it('retains the ledger through the full lifetime of a maximum-skew key', () => {
    const firstProcessedAt = Date.UTC(2026, 7, 24, 12);
    const keyTimestamp = firstProcessedAt + (5 * 60 * 1000);
    const key = `am1.${keyTimestamp.toString(36)}.2f093729-84af-4cad-9f27-6617eb80c67d`;

    expect(cartMergeIdempotencyLedgerRetentionMs).toBe((24 * 60 + 5) * 60 * 1000);
    expect(cartMergeKeyStatus(key, firstProcessedAt + cartMergeIdempotencyLedgerRetentionMs)).toBe('valid');
    expect(cartMergeKeyStatus(key, firstProcessedAt + cartMergeIdempotencyLedgerRetentionMs + 1)).toBe('expired');
  });
});
