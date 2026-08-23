import { createHmac, timingSafeEqual } from 'node:crypto';
import { unauthorized } from '../http/errors.js';

const eventIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const signaturePattern = /^v1=([0-9a-f]{64})$/i;

function authenticationFailure() {
  return unauthorized('The fulfillment webhook credentials are invalid.');
}

function secretBuffer(secret) {
  if (Buffer.isBuffer(secret)) return secret;
  if (typeof secret === 'string') return Buffer.from(secret, 'utf8');
  return Buffer.alloc(0);
}

function signaturePayload(timestamp, eventId, rawBody) {
  return Buffer.concat([
    Buffer.from(`${timestamp}.${eventId}.`, 'utf8'),
    rawBody
  ]);
}

export function createFulfillmentSignature({ secret, timestamp, eventId, rawBody }) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  return `v1=${createHmac('sha256', secretBuffer(secret))
    .update(signaturePayload(timestamp, eventId, body))
    .digest('hex')}`;
}

export function authenticateFulfillmentWebhook({
  secret,
  toleranceMs,
  nowMs = Date.now(),
  timestampHeader,
  eventIdHeader,
  signatureHeader,
  rawBody
}) {
  const key = secretBuffer(secret);
  if (key.length < 32 || !Buffer.isBuffer(rawBody)) throw authenticationFailure();

  if (typeof timestampHeader !== 'string' || !/^\d{10}$/.test(timestampHeader)) {
    throw authenticationFailure();
  }
  if (typeof eventIdHeader !== 'string' || !eventIdPattern.test(eventIdHeader)) {
    throw authenticationFailure();
  }
  const signatureMatch = typeof signatureHeader === 'string'
    ? signaturePattern.exec(signatureHeader)
    : null;
  if (!signatureMatch) throw authenticationFailure();

  const timestampSeconds = Number(timestampHeader);
  const timestampMs = timestampSeconds * 1000;
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(nowMs - timestampMs) > toleranceMs) {
    throw authenticationFailure();
  }

  const expected = Buffer.from(
    createFulfillmentSignature({
      secret: key,
      timestamp: timestampHeader,
      eventId: eventIdHeader,
      rawBody
    }).slice(3),
    'hex'
  );
  const supplied = Buffer.from(signatureMatch[1], 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw authenticationFailure();
  }

  return {
    eventId: eventIdHeader.toLowerCase(),
    signedAt: new Date(timestampMs)
  };
}
