import argon2 from 'argon2';
import { describe, expect, it } from 'vitest';
import { hashPassword, passwordNeedsRehash, verifyPassword } from '../../src/security/passwords.js';

describe('Argon2id password handling', () => {
  it('hashes with Argon2id, salts independently, and verifies only the right password', async () => {
    const password = 'unit-test-password-value';
    const first = await hashPassword(password);
    const second = await hashPassword(password);

    expect(first).toMatch(/^\$argon2id\$/);
    expect(second).toMatch(/^\$argon2id\$/);
    expect(first).not.toBe(second);
    await expect(verifyPassword(first, password)).resolves.toBe(true);
    await expect(verifyPassword(first, 'incorrect-password-value')).resolves.toBe(false);
    await expect(passwordNeedsRehash(first)).resolves.toBe(false);
  });

  it('identifies a weaker Argon2id hash for an upgrade', async () => {
    const weaker = await argon2.hash('rehash-test-password', {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
      hashLength: 32
    });

    await expect(passwordNeedsRehash(weaker)).resolves.toBe(true);
  });

  it('uses the dummy hash path for a missing account without accepting a password', async () => {
    await expect(verifyPassword(null, 'any-password-value')).resolves.toBe(false);
  });
});
