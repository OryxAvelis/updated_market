-- Guest checkout credentials are now issued by the server and claimed before
-- catalog verification. Guest-order bearer access is deliberately finite and
-- can be revoked without deleting the order.

ALTER TABLE orders
  ADD COLUMN guest_access_expires_at DATETIME(3) NULL AFTER guest_access_digest,
  ADD COLUMN guest_access_revoked_at DATETIME(3) NULL AFTER guest_access_expires_at;

-- statement-breakpoint

UPDATE orders
   SET guest_access_expires_at = DATE_ADD(placed_at, INTERVAL 30 DAY)
 WHERE user_id IS NULL
   AND guest_access_digest IS NOT NULL
   AND guest_access_expires_at IS NULL;

-- statement-breakpoint

ALTER TABLE orders
  ADD KEY idx_orders_guest_access_expiry
    (guest_access_expires_at, guest_access_revoked_at),
  ADD CONSTRAINT chk_orders_guest_access_lifecycle CHECK (
    (
      user_id IS NOT NULL
      AND guest_access_expires_at IS NULL
      AND guest_access_revoked_at IS NULL
    )
    OR
    (
      user_id IS NULL
      AND guest_access_expires_at IS NOT NULL
      AND guest_access_expires_at > placed_at
      AND (
        guest_access_revoked_at IS NULL
        OR guest_access_revoked_at >= placed_at
      )
    )
  );

-- statement-breakpoint

CREATE TABLE guest_checkout_claims (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  access_digest BINARY(32) NOT NULL,
  idempotency_digest BINARY(32) NOT NULL,
  request_digest BINARY(32) NULL,
  state VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'issued',
  lease_digest BINARY(32) NULL,
  lease_expires_at DATETIME(3) NULL,
  order_id BIGINT UNSIGNED NULL,
  failure_code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  failure_status SMALLINT UNSIGNED NULL,
  failure_message VARCHAR(255) NULL,
  failure_details JSON NULL,
  access_expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_guest_checkout_claims_access (access_digest),
  UNIQUE KEY uq_guest_checkout_claims_idempotency (idempotency_digest),
  UNIQUE KEY uq_guest_checkout_claims_order (order_id),
  KEY idx_guest_checkout_claims_state_lease (state, lease_expires_at),
  KEY idx_guest_checkout_claims_expiry (access_expires_at, state),
  CONSTRAINT fk_guest_checkout_claims_order
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT chk_guest_checkout_claims_expiry CHECK (access_expires_at > created_at),
  CONSTRAINT chk_guest_checkout_claims_state CHECK (
    (
      state = 'issued'
      AND request_digest IS NULL
      AND lease_digest IS NULL
      AND lease_expires_at IS NULL
      AND order_id IS NULL
      AND failure_code IS NULL
    )
    OR
    (
      state = 'processing'
      AND request_digest IS NOT NULL
      AND lease_digest IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND order_id IS NULL
      AND failure_code IS NULL
    )
    OR
    (
      state = 'failed'
      AND request_digest IS NOT NULL
      AND lease_digest IS NULL
      AND lease_expires_at IS NULL
      AND order_id IS NULL
      AND failure_code IS NOT NULL
      AND failure_status IS NOT NULL
    )
    OR
    (
      state = 'completed'
      AND request_digest IS NOT NULL
      AND lease_digest IS NULL
      AND lease_expires_at IS NULL
      AND order_id IS NOT NULL
      AND failure_code IS NULL
      AND completed_at IS NOT NULL
    )
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

INSERT INTO guest_checkout_claims
  (access_digest, idempotency_digest, request_digest, state, order_id,
   access_expires_at, created_at, updated_at, completed_at)
SELECT guest_access_digest, guest_idempotency_digest, request_digest, 'completed', id,
       guest_access_expires_at, placed_at, placed_at, placed_at
  FROM orders
 WHERE user_id IS NULL
   AND guest_access_digest IS NOT NULL;

-- statement-breakpoint

CREATE TABLE catalog_inventory (
  product_ref_id BIGINT UNSIGNED NOT NULL,
  available_quantity INT UNSIGNED NOT NULL,
  source_quantity INT UNSIGNED NOT NULL,
  last_observed_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (product_ref_id),
  KEY idx_catalog_inventory_available (available_quantity, last_observed_at),
  CONSTRAINT fk_catalog_inventory_product
    FOREIGN KEY (product_ref_id) REFERENCES catalog_product_refs (id) ON DELETE CASCADE,
  CONSTRAINT chk_catalog_inventory_available CHECK (available_quantity <= source_quantity)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE order_inventory_allocations (
  order_id BIGINT UNSIGNED NOT NULL,
  product_ref_id BIGINT UNSIGNED NOT NULL,
  quantity SMALLINT UNSIGNED NOT NULL,
  reserved_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (order_id, product_ref_id),
  KEY idx_order_inventory_allocations_product (product_ref_id, reserved_at),
  CONSTRAINT fk_order_inventory_allocations_order
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_order_inventory_allocations_product
    FOREIGN KEY (product_ref_id) REFERENCES catalog_product_refs (id) ON DELETE RESTRICT,
  CONSTRAINT chk_order_inventory_allocations_quantity CHECK (quantity BETWEEN 1 AND 99)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE rate_limit_counters (
  scope VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  counter_digest BINARY(32) NOT NULL,
  hits INT UNSIGNED NOT NULL,
  window_started_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY (scope, counter_digest),
  KEY idx_rate_limit_counters_expiry (expires_at),
  CONSTRAINT chk_rate_limit_counters_hits CHECK (hits > 0),
  CONSTRAINT chk_rate_limit_counters_expiry CHECK (expires_at > window_started_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
