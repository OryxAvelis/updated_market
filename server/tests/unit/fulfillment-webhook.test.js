import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  authenticateFulfillmentWebhook,
  createFulfillmentSignature
} from '../../src/integrations/fulfillment-auth.js';
import {
  fulfillmentTransitions,
  isAllowedFulfillmentTransition
} from '../../src/integrations/fulfillment-routes.js';

const secret = randomBytes(48).toString('base64url');

function signedRequest(overrides = {}) {
  const nowMs = Date.parse('2026-08-23T12:00:00.000Z');
  const timestampHeader = String(Math.floor(nowMs / 1000));
  const eventIdHeader = randomUUID();
  const rawBody = Buffer.from(JSON.stringify({
    type: 'order.status.updated',
    orderId: randomUUID(),
    status: 'preparing'
  }));
  const signatureHeader = createFulfillmentSignature({
    secret,
    timestamp: timestampHeader,
    eventId: eventIdHeader,
    rawBody
  });
  return {
    secret,
    toleranceMs: 300_000,
    nowMs,
    timestampHeader,
    eventIdHeader,
    signatureHeader,
    rawBody,
    ...overrides
  };
}

describe('fulfillment webhook HMAC authentication', () => {
  it('accepts the exact signed raw body and canonicalizes the event ID', () => {
    const request = signedRequest();
    const result = authenticateFulfillmentWebhook(request);

    expect(result.eventId).toBe(request.eventIdHeader.toLowerCase());
    expect(result.signedAt.toISOString()).toBe('2026-08-23T12:00:00.000Z');
  });

  it.each([
    ['tampered body', (request) => ({ rawBody: Buffer.concat([request.rawBody, Buffer.from(' ')]) })],
    ['wrong secret', () => ({ secret: randomBytes(48).toString('base64url') })],
    ['stale timestamp', (request) => ({ nowMs: request.nowMs + 300_001 })],
    ['malformed event ID', () => ({ eventIdHeader: 'not-a-uuid' })],
    ['malformed signature', () => ({ signatureHeader: 'v1=nope' })]
  ])('rejects a %s without revealing which credential check failed', (_label, mutate) => {
    const request = signedRequest();
    let thrown;
    try {
      authenticateFulfillmentWebhook({ ...request, ...mutate(request) });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ status: 401, code: 'AUTH_REQUIRED' });
  });
});

describe('fulfillment order state machine', () => {
  it('permits only the forward fulfillment chain', () => {
    expect(fulfillmentTransitions).toEqual({
      confirmed: 'preparing',
      preparing: 'shipping',
      shipping: 'delivered'
    });
    expect(isAllowedFulfillmentTransition('confirmed', 'preparing')).toBe(true);
    expect(isAllowedFulfillmentTransition('preparing', 'shipping')).toBe(true);
    expect(isAllowedFulfillmentTransition('shipping', 'delivered')).toBe(true);
  });

  it.each([
    ['confirmed', 'shipping'],
    ['confirmed', 'delivered'],
    ['preparing', 'delivered'],
    ['shipping', 'preparing'],
    ['delivered', 'shipping'],
    ['cancelled', 'preparing'],
    ['confirmed', 'confirmed']
  ])('rejects %s -> %s', (from, to) => {
    expect(isAllowedFulfillmentTransition(from, to)).toBe(false);
  });
});
