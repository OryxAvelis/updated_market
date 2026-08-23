import argon2 from 'argon2';

const HASH_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32
});

const DUMMY_HASH = '$argon2id$v=19$m=65536,p=1,t=3$hZ47VOdmJuUxBmZqHuJfhg$3VyJrsmDfCJGkNpDvfMqylWzydBxDMB8H4i3WARVXaA';

export function hashPassword(password) {
  return argon2.hash(password, HASH_OPTIONS);
}

export function verifyPassword(hash, password) {
  return argon2.verify(hash || DUMMY_HASH, password);
}

export async function passwordNeedsRehash(hash) {
  return argon2.needsRehash(hash, HASH_OPTIONS);
}
