-- Let an order belong to either an authenticated customer or one unguessable
-- guest-order bearer token. Existing authenticated rows satisfy this invariant
-- without a data rewrite because both new digest columns default to NULL.

ALTER TABLE orders
  DROP FOREIGN KEY fk_orders_user,
  MODIFY COLUMN user_id BIGINT UNSIGNED NULL,
  MODIFY COLUMN cart_version BIGINT UNSIGNED NULL,
  ADD COLUMN guest_access_digest BINARY(32) NULL AFTER user_id,
  ADD COLUMN guest_idempotency_digest BINARY(32) NULL AFTER idempotency_digest,
  ADD UNIQUE KEY uq_orders_guest_access (guest_access_digest),
  ADD UNIQUE KEY uq_orders_guest_idempotency (guest_idempotency_digest),
  ADD CONSTRAINT chk_orders_owner CHECK (
    (
      user_id IS NOT NULL
      AND cart_version IS NOT NULL
      AND guest_access_digest IS NULL
      AND guest_idempotency_digest IS NULL
    )
    OR
    (
      user_id IS NULL
      AND cart_version IS NULL
      AND guest_access_digest IS NOT NULL
      AND guest_idempotency_digest IS NOT NULL
      AND guest_idempotency_digest = idempotency_digest
    )
  ),
  ADD CONSTRAINT fk_orders_user_optional
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT;
