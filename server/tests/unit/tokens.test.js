import { describe, expect, it } from 'vitest';
import { randomToken, safeTokenEqual, tokenDigest } from '../../src/security/tokens.js';

describe('opaque security tokens', () => {
  it('creates URL-safe tokens with the requested entropy', () => {
    const first = randomToken();
    const second = randomToken();

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(first, 'base64url')).toHaveLength(32);
    expect(Buffer.from(randomToken(48), 'base64url')).toHaveLength(48);
  });

  it('stores a deterministic fixed-length digest rather than the raw token', () => {
    const token = randomToken();
    const digest = tokenDigest(token);

    expect(Buffer.isBuffer(digest)).toBe(true);
    expect(digest).toHaveLength(32);
    expect(digest.equals(tokenDigest(token))).toBe(true);
    expect(digest.equals(tokenDigest(`${token}x`))).toBe(false);
    expect(digest.toString('base64url')).not.toBe(token);
  });

  it('compares equal-length strings safely and rejects invalid inputs', () => {
    expect(safeTokenEqual('same-token', 'same-token')).toBe(true);
    expect(safeTokenEqual('same-token', 'other-token')).toBe(false);
    expect(safeTokenEqual('short', 'a-much-longer-token')).toBe(false);
    expect(safeTokenEqual(null, 'token')).toBe(false);
    expect(safeTokenEqual('token', Buffer.from('token'))).toBe(false);
  });
});
