import { describe, expect, it } from 'vitest';
import {
  decodeAdminListCursor,
  encodeAdminListCursor
} from '../../src/admin/operations-routes.js';

describe('administrator list cursors', () => {
  it('round-trips the anchored composite position', () => {
    const scope = JSON.stringify({ search: 'casablanca', status: 'confirmed' });
    const token = encodeAdminListCursor({
      resource: 'orders',
      anchor: '2026-08-26T12:00:00.000Z',
      sortAt: '2026-08-25T09:30:00.000Z',
      rank: 0,
      id: '1a4f25cb-c4b7-46e8-8db5-756862542a44',
      scope
    });

    expect(decodeAdminListCursor(token, { resource: 'orders', scope })).toMatchObject({
      resource: 'orders',
      rank: 0,
      id: '1a4f25cb-c4b7-46e8-8db5-756862542a44',
      scope
    });
  });

  it('rejects malformed cursors and reuse with different filters or resources', () => {
    const token = encodeAdminListCursor({
      resource: 'customers',
      anchor: '2026-08-26T12:00:00.000Z',
      sortAt: '2026-08-25T09:30:00.000Z',
      rank: 1,
      id: '42',
      scope: '{"search":"","status":""}'
    });

    expect(() => decodeAdminListCursor(token, {
      resource: 'customers',
      scope: '{"search":"new","status":""}'
    })).toThrow();
    expect(() => decodeAdminListCursor(token, { resource: 'orders' })).toThrow();
    expect(() => decodeAdminListCursor('not-a-cursor')).toThrow();
  });
});
