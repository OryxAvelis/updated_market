# AM MARKET database

The user-facing backend uses MySQL 8 with InnoDB and `utf8mb4`. Application code treats every timestamp as UTC and every money amount as an exact decimal value. Internal relations use `BIGINT UNSIGNED` IDs; API resources use UUID strings stored in `public_id` columns.

## Migrations

Run migrations from `server/` after configuring the database and its trusted CA certificate:

```bash
npm run migrate
```

The runner in `src/db/migrate.js`:

- uses the existing TLS-aware database pool;
- serializes concurrent deploys with a database-specific MySQL `GET_LOCK`;
- records a normalized SHA-256 checksum, statement count, duration and application time in `schema_migrations`;
- rejects changed or missing migrations that have already been applied;
- executes each statement separately without enabling MySQL's `multipleStatements` option; and
- is safe to rerun when no files have changed.

Statements inside a migration are separated by a line containing:

```sql
-- statement-breakpoint
```

Applied migrations are immutable. Add a new, monotonically numbered migration for every later schema change. MySQL DDL performs implicit commits, so every DDL statement must be independently retry-safe. The initial migration uses `CREATE TABLE IF NOT EXISTS` for this reason.

## Data model

- Identity: `users`, `user_preferences`, `delivery_addresses`, `auth_sessions`, and `password_reset_tokens`. The singleton `local_demo_accounts` registry separates the dedicated local demo identity from regular customers without relying on mutable profile fields.
- Environment safety: `application_environment` is empty after migrations and can be explicitly attested as local development only by the guarded migration script. Demo provisioning and startup fail closed without that database-level attestation.
- Catalog references: `catalog_product_refs` stores the latest verified fields needed to relate user records to the external catalog. `catalog_inventory` is the serialized application allocation ledger when the upstream publishes a finite quantity; `order_inventory_allocations` records every checkout and its finite or availability-only policy.
- Shopping: one `cart` and one `wishlist` per user, with composite-key item tables and bounded quantities.
- Orders: authenticated or token-owned guest orders, immutable address and product snapshots, exact totals, tracking events, cancellations, checkout idempotency records, returns, and return items.
- Engagement: reviews and ratings, recently viewed products, normalized search history, notifications, low-stock subscriptions, and expiring recommendation snapshots.
- Reliability: `guest_checkout_claims` durably claims server-issued checkout credentials before catalog work, `rate_limit_counters` is the shared production limiter store, and `outbox_events` records work in the same transaction as the business change so a worker can deliver notifications without losing events.
- Fulfillment: `fulfillment_webhook_events` stores a globally unique signed-event receipt and body digest so order-status webhooks are replay-safe and cannot reuse an event ID with different content.

## Important invariants

- `email_normalized` is unique and is the only email value used for identity lookups.
- Raw session, CSRF, and password-reset tokens are never stored; application code persists fixed-length digests.
- A generated-column unique key permits at most one non-deleted default delivery address per user.
- A cart quantity and an order-item quantity are between 1 and 99.
- Every order has exactly one owner type: an authenticated user or a guest bearer-token digest, never both.
- Authenticated checkout idempotency keys are unique per user. `POST /api/v1/guest-orders/access` issues a 256-bit bearer token and paired idempotency key; their digests are globally unique and the raw values are never stored in MySQL. A claim is acquired before catalog verification, leased to one worker, and completed in the same transaction as its order, so concurrent exact retries recover the committed order rather than producing a contradictory failure.
- Unused guest checkout credentials expire after `GUEST_CHECKOUT_CREDENTIAL_TTL_MINUTES`. A completed guest order has a separate `GUEST_ORDER_ACCESS_TTL_DAYS` lookup deadline and `guest_access_revoked_at`; expired, revoked, missing, and incorrect tokens all receive the same PII-free `ORDER_NOT_FOUND` response. `DELETE /api/v1/guest-orders/:orderId/access` revokes a valid bearer immediately.
- Finite catalog stock is reserved through a locked, monotonic `catalog_inventory` decrement shared by guest and authenticated checkout. Each decrement and its `finite` allocation audit row commits with the order, preventing oversell between concurrent AM MARKET checkouts. An upstream product with `stock_quantity = NULL` is explicitly recorded as `availability_only`: checkout remains usable, but an availability flag cannot provide a mathematical oversell guarantee. Increasing finite inventory after a trusted restock requires an explicit reconciliation process; ordinary catalog refreshes may lower but never silently replenish the application ledger.
- Order totals must equal subtotal plus delivery fee. Order item totals are generated from exact unit price and quantity.
- An address edit or deletion cannot change a historical order because checkout creates an immutable address snapshot.
- A user may create at most one review/rating per product.
- User-owned transient data cascades on a deliberate hard delete. Orders, returns, cancellations, and reviews restrict user deletion so account removal must use the service's deactivation and retention workflow.
- Low-stock subscriptions preserve explicit and wishlist-derived intent separately. A direct opt-out overrides automatic wishlist subscription until the customer explicitly subscribes again.
- Low-stock alerts use a locked transition sequence and the notification dedupe key, so concurrent evaluators cannot create the same transition twice.
- Low-stock subscriptions can be evaluated only when the upstream catalog supplies a non-negative integer `stock_quantity`. Availability alone cannot prove that inventory is low; unknown stock leaves the last observed state unchanged.
- Guest checkout issuance, submission, and lookup use separate limits. Production always uses the MySQL `rate_limit_counters` store so limits are shared across Node instances; a store error is propagated (fail closed) instead of bypassing protection. Periodically prune expired counter rows and expired, non-completed checkout claims as routine database maintenance.

See [low-stock.md](./low-stock.md) for the evaluator lifecycle, API, configuration, and catalog limitation.

See [fulfillment-webhook.md](./fulfillment-webhook.md) for webhook signing, replay protection, order-state transitions, and operational requirements.

## TLS and secrets

The pool rejects untrusted MySQL certificates when `DB_TLS=true`. Set `DB_TLS_CA_PATH` to a trusted CA file and, when needed, `DB_TLS_SERVERNAME` to the certificate hostname. Never disable certificate verification. Database passwords, private keys, CA deployment files, dumps, and local `.env` files must stay outside Git; only `.env.example` contains placeholders.
