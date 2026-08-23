# Fulfillment order-status webhook

AM MARKET exposes one server-to-server endpoint for a trusted fulfillment service:

```text
POST /api/v1/integrations/fulfillment/order-status
Content-Type: application/json
```

This endpoint is not a browser or admin API. It does not accept a customer cookie, user ID, bearer token, or CSRF token. Instead, every request must authenticate the exact raw JSON bytes with a deployment-managed HMAC secret. All customer-facing `/api/v1` routes remain behind the existing exact-origin, session, and CSRF middleware.

## Secret configuration

Generate at least 32 random bytes. A 48-byte base64url value is a suitable default:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Store the result in the deployment secret manager, not in Git. Prefer mounting it as a file and setting:

```dotenv
FULFILLMENT_WEBHOOK_SECRET_FILE=C:\secure\am-market\fulfillment-webhook-secret.txt
FULFILLMENT_WEBHOOK_TOLERANCE_SECONDS=300
```

`FULFILLMENT_WEBHOOK_SECRET` is also supported for platforms that inject secrets directly as environment variables. Configure exactly one source. Production startup fails closed when neither is present, when both are present, or when the secret is shorter than 32 bytes.

## Signed request

Send these headers:

- `X-AM-Fulfillment-Timestamp`: current Unix time in seconds (exactly 10 digits).
- `X-AM-Fulfillment-Event-Id`: a new UUID for the fulfillment event.
- `X-AM-Fulfillment-Signature`: `v1=` followed by the lowercase hexadecimal HMAC-SHA-256 digest.

Build the signed bytes without reformatting the JSON:

```text
<timestamp>.<event-id>.<exact raw request body>
```

Then calculate:

```text
HMAC-SHA-256(secret, signed-bytes)
```

Example body:

```json
{
  "type": "order.status.updated",
  "orderId": "0e474a67-7b80-4f71-84ac-3d499b627a4e",
  "status": "shipping",
  "occurredAt": "2026-08-23T15:42:18.000Z",
  "location": "Casablanca hub",
  "note": "Your order has left the fulfillment center."
}
```

`occurredAt`, `location`, and `note` are optional. Unknown JSON properties are rejected. The body limit is 16 KiB, and compressed request bodies are rejected so both systems sign the same unambiguous byte sequence. Requests with an `Origin` header are rejected because this integration is server-to-server only. Signatures are compared in constant time, are redacted from application logs, and expire after the configured clock-skew window.

## Status state machine

The endpoint accepts only one next state at a time:

```text
confirmed -> preparing -> shipping -> delivered
```

Skipping, reversing, repeating with a new event ID, or advancing a cancelled/delivered order returns `409 ORDER_STATUS_TRANSITION_INVALID`. The service locates the order only by its opaque public order ID; it never accepts a caller-supplied customer ID.

## Atomicity and idempotency

The event UUID and SHA-256 digest of the exact body are recorded in `fulfillment_webhook_events`. Replaying the same event UUID and body returns HTTP 200 with `replayed: true` and performs no additional write. Reusing an event UUID for different bytes returns `409 FULFILLMENT_EVENT_ID_REUSED`.

The following writes commit in one MySQL transaction:

1. Lock and validate the current order state.
2. Advance the order and set `delivered_at` when appropriate.
3. Append a fulfillment-sourced tracking event.
4. Create an in-app customer notification only when `order_notifications` is enabled.
5. Append an `order.preparing`, `order.shipping`, or `order.delivered` outbox event.
6. Mark the webhook receipt completed.

Any failure rolls back every write. Consumers should retry network errors and 5xx responses with the same event UUID and exact body. Do not retry a 4xx response without correcting the request.

## Operational requirements

- Deliver the webhook only over HTTPS with a valid certificate.
- Synchronize both systems with NTP so timestamps stay inside the replay window.
- Restrict outbound webhook destinations and, when available, add network allowlisting at the reverse proxy or firewall.
- Rotate the secret atomically in the sender and deployment secret manager during a controlled release.
- Alert on repeated 401, 409, 429, and 5xx responses.
