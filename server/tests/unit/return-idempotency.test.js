import { describe, expect, it } from 'vitest';
import { returnRequestDigest } from '../../src/orders/routes.js';

const orderId = '0198d0ee-5d4c-7000-8000-000000000001';
const firstItem = '0198d0ee-5d4c-7000-8000-000000000002';
const secondItem = '0198d0ee-5d4c-7000-8000-000000000003';

function digest(input) {
  return returnRequestDigest(orderId, input).toString('hex');
}

describe('return request idempotency digest', () => {
  const request = {
    reason: 'damaged',
    details: 'Outer packaging was torn.',
    items: [
      { orderItemId: firstItem, quantity: 1 },
      { orderItemId: secondItem, quantity: 2, reason: 'quality' }
    ]
  };

  it('is stable when equivalent return items arrive in a different order', () => {
    expect(digest(request)).toBe(digest({ ...request, items: [...request.items].reverse() }));
  });

  it.each([
    { label: 'reason', changed: { ...request, reason: 'quality' } },
    { label: 'details', changed: { ...request, details: 'Different details.' } },
    { label: 'quantity', changed: { ...request, items: [{ ...request.items[0], quantity: 2 }, request.items[1]] } },
    { label: 'items', changed: { ...request, items: [request.items[0]] } }
  ])('changes when the $label payload changes', ({ changed }) => {
    expect(digest(changed)).not.toBe(digest(request));
  });
});
