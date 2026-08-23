# Low-stock notifications

Low-stock notifications are server-generated from catalog inventory observations. The browser supplies only a product ID; user identity always comes from the authenticated HTTP-only session.

## Customer API

All endpoints require authentication. Unsafe requests also require the normal trusted `Origin` and CSRF token.

- `GET /api/v1/me/low-stock-subscriptions` lists the customer's subscription records and current global notification preference with bounded `page`/`limit` pagination.
- `GET /api/v1/me/low-stock-subscriptions/:productId` returns status without exposing internal user or database IDs. A product with no record is reported as unsubscribed.
- `POST /api/v1/me/low-stock-subscriptions` accepts exactly `{ "productId": "..." }` and explicitly subscribes the current customer after verifying the product through the server-side catalog service.
- `DELETE /api/v1/me/low-stock-subscriptions/:productId` is idempotent and records a direct opt-out. That opt-out prevents a still-wishlisted product from silently resubscribing; a later explicit `POST` clears it.

Adding a wishlist item records wishlist-derived subscription intent in the same database transaction. Removing it removes only that source: an explicit subscription remains active. The global `lowStockNotifications` user preference is an independent delivery gate. Disabling it preserves subscription intent but the evaluator neither observes nor alerts for that user until the preference is enabled again.

## Evaluator behavior

`src/server.js` starts one periodic evaluator after its listeners are ready and stops it before closing the MySQL pool. Runs do not overlap. Shutdown aborts in-flight catalog requests and waits for the active run to settle.

Each run:

1. reads at most the configured batch size, advancing a cursor so a large subscriber set is not starved;
2. groups subscriptions by product and refreshes each product once with bounded concurrency;
3. ignores products whose upstream `stock_quantity` is absent, fractional, or negative;
4. locks each subscription and rechecks its active user and preference before changing state; and
5. emits only a transition into the low region or a transition from low back above the threshold.

The low region is inclusive: with the default threshold of 5, quantities 0 through 5 are low and 6 is available. Repeated observations inside the same region do not notify. A durable per-subscription transition sequence forms a unique notification dedupe key, and the state update and notification insert commit in one transaction. This also prevents duplicate alerts if multiple application instances evaluate the same subscription concurrently.

Notifications expire after the configured TTL. They use the existing `low_stock` and `restocked` types and include product linkage, the known quantity, threshold, state, and a human-readable message.

## Configuration

```dotenv
LOW_STOCK_EVALUATOR_ENABLED=true
LOW_STOCK_EVALUATOR_INTERVAL_MS=300000
LOW_STOCK_EVALUATOR_RUN_TIMEOUT_MS=25000
LOW_STOCK_EVALUATOR_BATCH_SIZE=100
LOW_STOCK_EVALUATOR_CONCURRENCY=4
LOW_STOCK_DEFAULT_THRESHOLD=5
LOW_STOCK_NOTIFICATION_TTL_DAYS=30
```

Configuration parsing enforces safe bounds. Set `LOW_STOCK_EVALUATOR_ENABLED=false` only for a dedicated process where another worker owns evaluation.

## Catalog limitation

The evaluator does not infer quantity from a generic `is_available` flag. If the upstream catalog omits a numeric `stock_quantity`, the product is skipped and no low-stock or restocked claim is made. Alerts therefore become operational only for products whose catalog responses expose a trustworthy non-negative integer quantity.
