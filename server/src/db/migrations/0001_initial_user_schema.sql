-- AM MARKET user-facing persistence schema.
-- MySQL 8.0+, InnoDB, UTC application timestamps, utf8mb4 text.

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email VARCHAR(254) NOT NULL,
  email_normalized VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  phone_e164 VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
  password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  failed_login_count INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME(3) NULL,
  email_verified_at DATETIME(3) NULL,
  password_changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deactivated_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_public_id (public_id),
  UNIQUE KEY uq_users_email_normalized (email_normalized),
  KEY idx_users_status_created (status, created_at),
  CONSTRAINT chk_users_status CHECK (status IN ('active', 'deactivated', 'locked', 'pending_verification')),
  CONSTRAINT chk_users_email_normalized CHECK (CHAR_LENGTH(email_normalized) > 0),
  CONSTRAINT chk_users_display_name CHECK (CHAR_LENGTH(display_name) > 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id BIGINT UNSIGNED NOT NULL,
  language CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'fr',
  theme VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'light',
  default_payment VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'cod',
  order_notifications TINYINT(1) NOT NULL DEFAULT 1,
  low_stock_notifications TINYINT(1) NOT NULL DEFAULT 1,
  personalization_enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_preferences_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_user_preferences_language CHECK (language IN ('en', 'fr')),
  CONSTRAINT chk_user_preferences_theme CHECK (theme IN ('light', 'dark')),
  CONSTRAINT chk_user_preferences_payment CHECK (default_payment IN ('cod', 'card', 'wafacash', 'cashplus')),
  CONSTRAINT chk_user_preferences_order_notif CHECK (order_notifications IN (0, 1)),
  CONSTRAINT chk_user_preferences_stock_notif CHECK (low_stock_notifications IN (0, 1)),
  CONSTRAINT chk_user_preferences_personalization CHECK (personalization_enabled IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS delivery_addresses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(80) NULL,
  recipient_name VARCHAR(120) NOT NULL,
  phone_e164 VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email VARCHAR(254) NULL,
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255) NULL,
  district VARCHAR(120) NOT NULL,
  city VARCHAR(120) NOT NULL,
  postal_code VARCHAR(24) NULL,
  country_code CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'MA',
  delivery_instructions VARCHAR(1000) NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  deleted_at DATETIME(3) NULL,
  default_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_delivery_addresses_public_id (public_id),
  UNIQUE KEY uq_delivery_addresses_default_user (default_user_id),
  KEY idx_delivery_addresses_user_live (user_id, deleted_at, updated_at),
  CONSTRAINT fk_delivery_addresses_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_delivery_addresses_default CHECK (is_default IN (0, 1)),
  CONSTRAINT chk_delivery_addresses_default_user CHECK (
    (is_default = 1 AND deleted_at IS NULL AND default_user_id = user_id)
    OR (is_default = 0 AND default_user_id IS NULL)
  ),
  CONSTRAINT chk_delivery_addresses_country CHECK (CHAR_LENGTH(country_code) = 2)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS auth_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  token_digest BINARY(32) NOT NULL,
  csrf_digest BINARY(32) NOT NULL,
  remember_me TINYINT(1) NOT NULL DEFAULT 0,
  user_agent_digest BINARY(32) NULL,
  ip_address_digest BINARY(32) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  idle_expires_at DATETIME(3) NOT NULL,
  absolute_expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  revocation_reason VARCHAR(80) NULL,
  rotated_to_session_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_sessions_public_id (public_id),
  UNIQUE KEY uq_auth_sessions_token_digest (token_digest),
  KEY idx_auth_sessions_user_active (user_id, revoked_at, absolute_expires_at),
  KEY idx_auth_sessions_expiry (absolute_expires_at, idle_expires_at),
  KEY idx_auth_sessions_rotated_to (rotated_to_session_id),
  CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_auth_sessions_rotated_to FOREIGN KEY (rotated_to_session_id) REFERENCES auth_sessions (id) ON DELETE SET NULL,
  CONSTRAINT chk_auth_sessions_remember CHECK (remember_me IN (0, 1)),
  CONSTRAINT chk_auth_sessions_expiry CHECK (idle_expires_at <= absolute_expires_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  token_digest BINARY(32) NOT NULL,
  requested_ip_digest BINARY(32) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_password_reset_tokens_public_id (public_id),
  UNIQUE KEY uq_password_reset_tokens_digest (token_digest),
  KEY idx_password_reset_tokens_user_created (user_id, created_at),
  KEY idx_password_reset_tokens_expiry (expires_at, used_at, revoked_at),
  CONSTRAINT fk_password_reset_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_password_reset_tokens_expiry CHECK (expires_at > created_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS catalog_product_refs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  external_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  last_known_name VARCHAR(255) NOT NULL,
  last_known_brand VARCHAR(160) NULL,
  last_known_image_url TEXT NULL,
  last_verified_price DECIMAL(12,2) NOT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'MAD',
  is_available TINYINT(1) NOT NULL,
  stock_quantity INT UNSIGNED NULL,
  last_verified_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_catalog_product_refs_external_id (external_id),
  KEY idx_catalog_product_refs_availability (is_available, last_verified_at),
  KEY idx_catalog_product_refs_verified (last_verified_at),
  CONSTRAINT chk_catalog_product_refs_price CHECK (last_verified_price >= 0),
  CONSTRAINT chk_catalog_product_refs_available CHECK (is_available IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS carts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_carts_public_id (public_id),
  UNIQUE KEY uq_carts_user (user_id),
  CONSTRAINT fk_carts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS cart_items (
  cart_id BIGINT UNSIGNED NOT NULL,
  product_ref_id BIGINT UNSIGNED NOT NULL,
  quantity SMALLINT UNSIGNED NOT NULL,
  last_verified_price DECIMAL(12,2) NOT NULL,
  verified_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (cart_id, product_ref_id),
  KEY idx_cart_items_product (product_ref_id),
  CONSTRAINT fk_cart_items_cart FOREIGN KEY (cart_id) REFERENCES carts (id) ON DELETE CASCADE,
  CONSTRAINT fk_cart_items_product FOREIGN KEY (product_ref_id) REFERENCES catalog_product_refs (id) ON DELETE RESTRICT,
  CONSTRAINT chk_cart_items_quantity CHECK (quantity BETWEEN 1 AND 99),
  CONSTRAINT chk_cart_items_price CHECK (last_verified_price >= 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS wishlists (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_wishlists_public_id (public_id),
  UNIQUE KEY uq_wishlists_user (user_id),
  CONSTRAINT fk_wishlists_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS wishlist_items (
  wishlist_id BIGINT UNSIGNED NOT NULL,
  product_ref_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (wishlist_id, product_ref_id),
  KEY idx_wishlist_items_product (product_ref_id),
  CONSTRAINT fk_wishlist_items_wishlist FOREIGN KEY (wishlist_id) REFERENCES wishlists (id) ON DELETE CASCADE,
  CONSTRAINT fk_wishlist_items_product FOREIGN KEY (product_ref_id) REFERENCES catalog_product_refs (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_number VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'confirmed',
  payment_method VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payment_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'MAD',
  subtotal DECIMAL(12,2) NOT NULL,
  delivery_fee DECIMAL(12,2) NOT NULL,
  total DECIMAL(12,2) NOT NULL,
  cart_version BIGINT UNSIGNED NOT NULL,
  idempotency_digest BINARY(32) NOT NULL,
  request_digest BINARY(32) NOT NULL,
  note VARCHAR(1000) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  placed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  cancelled_at DATETIME(3) NULL,
  delivered_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_public_id (public_id),
  UNIQUE KEY uq_orders_number (order_number),
  UNIQUE KEY uq_orders_user_idempotency (user_id, idempotency_digest),
  KEY idx_orders_user_placed (user_id, placed_at DESC, id DESC),
  KEY idx_orders_status_placed (status, placed_at),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_orders_status CHECK (status IN ('confirmed', 'preparing', 'shipping', 'delivered', 'cancelled')),
  CONSTRAINT chk_orders_payment_method CHECK (payment_method IN ('cod', 'card', 'wafacash', 'cashplus')),
  CONSTRAINT chk_orders_payment_status CHECK (payment_status IN ('pending', 'authorized', 'paid', 'failed', 'refunded', 'partially_refunded')),
  CONSTRAINT chk_orders_amounts CHECK (subtotal >= 0 AND delivery_fee >= 0 AND total = subtotal + delivery_fee)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS order_addresses (
  order_id BIGINT UNSIGNED NOT NULL,
  source_address_public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  recipient_name VARCHAR(120) NOT NULL,
  phone_e164 VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email VARCHAR(254) NULL,
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255) NULL,
  district VARCHAR(120) NOT NULL,
  city VARCHAR(120) NOT NULL,
  postal_code VARCHAR(24) NULL,
  country_code CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'MA',
  delivery_instructions VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (order_id),
  CONSTRAINT fk_order_addresses_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT chk_order_addresses_country CHECK (CHAR_LENGTH(country_code) = 2)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  line_no SMALLINT UNSIGNED NOT NULL,
  product_ref_id BIGINT UNSIGNED NOT NULL,
  external_product_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  product_brand VARCHAR(160) NULL,
  product_sku VARCHAR(120) NULL,
  product_image_url TEXT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  quantity SMALLINT UNSIGNED NOT NULL,
  line_total DECIMAL(12,2) GENERATED ALWAYS AS (ROUND(unit_price * quantity, 2)) STORED,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_items_public_id (public_id),
  UNIQUE KEY uq_order_items_line (order_id, line_no),
  UNIQUE KEY uq_order_items_product (order_id, external_product_id),
  KEY idx_order_items_product_ref (product_ref_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_ref_id) REFERENCES catalog_product_refs (id) ON DELETE RESTRICT,
  CONSTRAINT chk_order_items_quantity CHECK (quantity BETWEEN 1 AND 99),
  CONSTRAINT chk_order_items_price CHECK (unit_price >= 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS order_tracking_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  event_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL,
  source VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'system',
  location VARCHAR(255) NULL,
  public_note VARCHAR(1000) NULL,
  dedupe_key VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_tracking_events_dedupe (order_id, dedupe_key),
  KEY idx_order_tracking_events_timeline (order_id, occurred_at, id),
  CONSTRAINT fk_order_tracking_events_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT chk_order_tracking_events_status CHECK (status IS NULL OR status IN ('confirmed', 'preparing', 'shipping', 'delivered', 'cancelled')),
  CONSTRAINT chk_order_tracking_events_source CHECK (source IN ('system', 'customer', 'fulfillment'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS order_cancellations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'accepted',
  reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  details VARCHAR(1000) NULL,
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_cancellations_order (order_id),
  KEY idx_order_cancellations_user_requested (user_id, requested_at),
  CONSTRAINT fk_order_cancellations_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE RESTRICT,
  CONSTRAINT fk_order_cancellations_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_order_cancellations_status CHECK (status IN ('requested', 'accepted', 'rejected'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS checkout_idempotency (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  key_digest BINARY(32) NOT NULL,
  request_digest BINARY(32) NOT NULL,
  state VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'processing',
  order_id BIGINT UNSIGNED NULL,
  response_status SMALLINT UNSIGNED NULL,
  response_body JSON NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_checkout_idempotency_user_key (user_id, key_digest),
  KEY idx_checkout_idempotency_expiry (expires_at, state),
  KEY idx_checkout_idempotency_order (order_id),
  CONSTRAINT fk_checkout_idempotency_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_checkout_idempotency_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL,
  CONSTRAINT chk_checkout_idempotency_state CHECK (state IN ('processing', 'completed', 'failed')),
  CONSTRAINT chk_checkout_idempotency_response_status CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS return_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'requested',
  reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  details VARCHAR(2000) NULL,
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_return_requests_public_id (public_id),
  KEY idx_return_requests_user_created (user_id, created_at DESC, id DESC),
  KEY idx_return_requests_order_status (order_id, status),
  CONSTRAINT fk_return_requests_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE RESTRICT,
  CONSTRAINT fk_return_requests_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_return_requests_status CHECK (status IN ('requested', 'approved', 'rejected', 'received', 'refunded', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS return_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  return_id BIGINT UNSIGNED NOT NULL,
  order_item_id BIGINT UNSIGNED NOT NULL,
  quantity SMALLINT UNSIGNED NOT NULL,
  reason VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_return_items_request_item (return_id, order_item_id),
  KEY idx_return_items_order_item (order_item_id),
  CONSTRAINT fk_return_items_request FOREIGN KEY (return_id) REFERENCES return_requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_return_items_order_item FOREIGN KEY (order_item_id) REFERENCES order_items (id) ON DELETE RESTRICT,
  CONSTRAINT chk_return_items_quantity CHECK (quantity BETWEEN 1 AND 99)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  product_ref_id BIGINT UNSIGNED NOT NULL,
  verified_order_item_id BIGINT UNSIGNED NULL,
  rating TINYINT UNSIGNED NOT NULL,
  title VARCHAR(160) NULL,
  body VARCHAR(3000) NULL,
  status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'published',
  deleted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_reviews_public_id (public_id),
  UNIQUE KEY uq_reviews_user_product (user_id, product_ref_id),
  KEY idx_reviews_product_status_created (product_ref_id, status, created_at DESC),
  KEY idx_reviews_user_created (user_id, created_at DESC),
  KEY idx_reviews_verified_order_item (verified_order_item_id),
  CONSTRAINT fk_reviews_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_reviews_product FOREIGN KEY (product_ref_id) REFERENCES catalog_product_refs (id) ON DELETE RESTRICT,
  CONSTRAINT fk_reviews_verified_order_item FOREIGN KEY (verified_order_item_id) REFERENCES order_items (id) ON DELETE SET NULL,
  CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT chk_reviews_status CHECK (status IN ('published', 'pending', 'rejected'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS recently_viewed_products (
  user_id BIGINT UNSIGNED NOT NULL,
  product_ref_id BIGINT UNSIGNED NOT NULL,
  view_count INT UNSIGNED NOT NULL DEFAULT 1,
  first_viewed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_viewed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, product_ref_id),
  KEY idx_recently_viewed_user_time (user_id, last_viewed_at DESC),
  KEY idx_recently_viewed_product_time (product_ref_id, last_viewed_at),
  CONSTRAINT fk_recently_viewed_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_recently_viewed_product FOREIGN KEY (product_ref_id) REFERENCES catalog_product_refs (id) ON DELETE RESTRICT,
  CONSTRAINT chk_recently_viewed_count CHECK (view_count > 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS search_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  query VARCHAR(255) NOT NULL,
  query_normalized VARCHAR(255) NOT NULL,
  results_count INT UNSIGNED NULL,
  search_count INT UNSIGNED NOT NULL DEFAULT 1,
  first_searched_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_searched_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_search_history_user_query (user_id, query_normalized),
  KEY idx_search_history_user_recent (user_id, last_searched_at DESC),
  CONSTRAINT fk_search_history_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_search_history_query CHECK (CHAR_LENGTH(query_normalized) > 0),
  CONSTRAINT chk_search_history_count CHECK (search_count > 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload JSON NOT NULL,
  order_id BIGINT UNSIGNED NULL,
  product_ref_id BIGINT UNSIGNED NULL,
  dedupe_key VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NULL,
  read_at DATETIME(3) NULL,
  expires_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_notifications_public_id (public_id),
  UNIQUE KEY uq_notifications_user_dedupe (user_id, dedupe_key),
  KEY idx_notifications_user_unread (user_id, read_at, created_at DESC),
  KEY idx_notifications_expiry (expires_at),
  KEY idx_notifications_order (order_id),
  KEY idx_notifications_product (product_ref_id),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL,
  CONSTRAINT fk_notifications_product FOREIGN KEY (product_ref_id) REFERENCES catalog_product_refs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS low_stock_subscriptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  product_ref_id BIGINT UNSIGNED NOT NULL,
  threshold_quantity INT UNSIGNED NOT NULL DEFAULT 5,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_observed_quantity INT UNSIGNED NULL,
  last_notified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_low_stock_subscriptions_user_product (user_id, product_ref_id),
  KEY idx_low_stock_subscriptions_poll (is_active, product_ref_id, last_notified_at),
  CONSTRAINT fk_low_stock_subscriptions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_low_stock_subscriptions_product FOREIGN KEY (product_ref_id) REFERENCES catalog_product_refs (id) ON DELETE RESTRICT,
  CONSTRAINT chk_low_stock_subscriptions_threshold CHECK (threshold_quantity > 0),
  CONSTRAINT chk_low_stock_subscriptions_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS recommendation_snapshots (
  user_id BIGINT UNSIGNED NOT NULL,
  product_ref_id BIGINT UNSIGNED NOT NULL,
  score DECIMAL(9,6) NOT NULL,
  reason VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  generated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, product_ref_id),
  KEY idx_recommendation_snapshots_user_rank (user_id, expires_at, score DESC),
  KEY idx_recommendation_snapshots_expiry (expires_at),
  CONSTRAINT fk_recommendation_snapshots_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_recommendation_snapshots_product FOREIGN KEY (product_ref_id) REFERENCES catalog_product_refs (id) ON DELETE RESTRICT,
  CONSTRAINT chk_recommendation_snapshots_score CHECK (score >= 0),
  CONSTRAINT chk_recommendation_snapshots_expiry CHECK (expires_at > generated_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS outbox_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  aggregate_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  aggregate_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload JSON NOT NULL,
  state VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  locked_at DATETIME(3) NULL,
  locked_by VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NULL,
  published_at DATETIME(3) NULL,
  last_error VARCHAR(2000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_outbox_events_dispatch (state, available_at, id),
  KEY idx_outbox_events_aggregate (aggregate_type, aggregate_id, id),
  CONSTRAINT chk_outbox_events_state CHECK (state IN ('pending', 'processing', 'published', 'dead_letter'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
