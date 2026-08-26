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
- records each exact statement checksum and its `started`/`completed` state in the runner-owned `schema_migration_statements` table;
- rejects changed or missing migrations that have already been applied;
- executes each statement separately without enabling MySQL's `multipleStatements` option; and
- is safe to rerun when no files have changed.

MySQL DDL can commit before the process records the enclosing migration. The runner writes durable statement progress first, so a later run can finish that narrow crash window without editing an already-checksummed migration. An already-exists DDL error is accepted only when the same migration checksum and exact statement checksum were already left in the `started` state by an interrupted runner. A first-attempt already-exists error, orphaned progress, changed SQL, or any other error still stops the migration.

Statements inside a migration are separated by a line containing:

```sql
-- statement-breakpoint
```

Applied migrations are immutable. Add a new, monotonically numbered migration for every later schema change. MySQL DDL performs implicit commits, so every DDL statement must be independently retry-safe. The initial migration uses `CREATE TABLE IF NOT EXISTS` for this reason.

The runtime readiness endpoint requires the deployed build's complete ordered migration ledger and checksums to be an exact prefix of `schema_migrations`. Missing, reordered, or changed expected migrations make the instance unready. A checksum-valid trailing migration from a newer build is accepted so an older, schema-compatible build can remain healthy during a rolling deployment or rollback. The migration runner applies the same prefix rule and ignores only completed, well-formed trailing migration progress. Every migration must therefore preserve the previous build's reads and writes until all older instances have drained; destructive cleanup belongs in a later deployment. Migrations must be applied separately with the migration account before application traffic is enabled.

The migration account needs `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `INDEX`, `REFERENCES`, and `TRIGGER` on the application database. The runtime account needs only its documented DML access and must not receive DDL privileges. MySQL executes triggers with their definer's privileges, so keep the migration/trigger-definer account present with the `SELECT`, `UPDATE`, and `DELETE` access used by the personalization guards even after its credentials have been removed from the application process.

### Disposable migration integration test

The migration regression tests create guarded, randomized disposable databases. One applies the complete schema twice to verify a clean install and replay, then exercises the personalization triggers under a concurrent recommendation-write/opt-out race; another applies the legacy schema before exercising the payment-preference migration. Both drop their own exact database afterward. They are disabled unless explicitly enabled and require an administrator account that can create and drop databases on a disposable MySQL server:

```powershell
$env:TEST_USE_DISPOSABLE_MIGRATION_DATABASE = 'true'
$env:TEST_MYSQL_ADMIN_HOST = '127.0.0.1'
$env:TEST_MYSQL_ADMIN_PORT = '3306'
$env:TEST_MYSQL_ADMIN_USER = 'disposable_test_admin'
$env:TEST_MYSQL_ADMIN_PASSWORD = 'read-from-an-external-secret'
$env:TEST_MYSQL_ADMIN_TLS_CA_PATH = 'C:\path\outside\the\repository\mysql-ca.pem'
$env:TEST_MYSQL_ADMIN_TLS_SERVERNAME = 'localhost' # optional; defaults to localhost
npm run test:integration -- payment-preference-migration.mysql.test.js
```

Never point these variables at production or a shared database. The test's guarded database-name check allows destructive cleanup only for its randomized prefix.

## Data model

- Identity: `users`, `user_preferences`, `delivery_addresses`, `auth_sessions`, and `password_reset_tokens`. Customer login failures use the existing bounded counter and 15-minute lock window. The singleton `local_demo_accounts` registry separates the dedicated local demo identity from regular customers without relying on mutable profile fields.
- Administrator workspace: `admin_workspace_documents` stores six bounded, revisioned cross-session documents with the authenticated administrator as updater. Product/category/inventory/promotion overlays, delivery-zone text, and store contact details remain explicit drafts and never mutate the external catalog.
- Delivery policy: `store_delivery_settings` is the typed singleton used by authenticated carts, guest checkout, order creation, and the public storefront configuration endpoint. Fees and free-delivery thresholds are stored as integer cents; the server always calculates the final order totals.
- Environment safety: `application_environment` is empty after migrations and can be explicitly attested as local development only by the guarded migration script. Demo provisioning and startup fail closed without that database-level attestation.
- Catalog references: `catalog_product_refs` stores the latest verified fields needed to relate user records to the external catalog. `catalog_inventory` is the serialized application allocation ledger when the upstream publishes a finite quantity; `order_inventory_allocations` records every checkout and its finite or availability-only policy.
- Shopping: one `cart` and one `wishlist` per user, with composite-key item tables and bounded quantities.
- Orders: authenticated or token-owned guest orders, immutable address and product snapshots, exact totals, tracking events, cancellations, checkout idempotency records, returns, and return items.
- Engagement: reviews and ratings, recently viewed products, normalized search history, notifications, low-stock subscriptions, and expiring recommendation snapshots. Personalization opt-out serializes against recent-view and recommendation writes and deletes snapshots immediately. Migration `0015_personalization_opt_out_cleanup.sql` removes pre-rollout stale data; migration `0016_personalization_snapshot_guard.sql` adds a locking insert guard plus an update-trigger purge so even an older rolling instance cannot recreate opted-out snapshots.
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
- Personalization writers lock `user_preferences` before activity or snapshot writes; disabling personalization and full account deletion follow the same lock order, set personalization off, and remove the relevant activity in-transaction. MySQL independently locks the preference row before every recommendation-snapshot insert and purges snapshots after any update that leaves personalization disabled, protecting the invariant from legacy application instances and direct writes as well.
- Low-stock subscriptions can be evaluated only when the upstream catalog supplies a non-negative integer `stock_quantity`. Availability alone cannot prove that inventory is low; unknown stock leaves the last observed state unchanged.
- Guest checkout issuance, submission, and lookup use separate limits. Production always uses the MySQL `rate_limit_counters` store so limits are shared across Node instances; a store error is propagated (fail closed) instead of bypassing protection. Periodically prune expired counter rows and expired, non-completed checkout claims as routine database maintenance.

See [low-stock.md](./low-stock.md) for the evaluator lifecycle, API, configuration, and catalog limitation.

See [fulfillment-webhook.md](./fulfillment-webhook.md) for webhook signing, replay protection, order-state transitions, and operational requirements.

## TLS and secrets

The pool rejects untrusted MySQL certificates when `DB_TLS=true`. Set `DB_TLS_CA_PATH` to a trusted CA file and, when needed, `DB_TLS_SERVERNAME` to the certificate hostname. Never disable certificate verification. Database passwords, private keys, CA deployment files, dumps, and local `.env` files must stay outside Git; only `.env.example` contains placeholders.
