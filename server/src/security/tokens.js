import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function tokenDigest(token) {
  return createHash('sha256').update(String(token), 'utf8').digest();
}

export function safeTokenEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
