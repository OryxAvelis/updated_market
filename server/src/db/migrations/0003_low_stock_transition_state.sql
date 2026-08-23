-- Preserve the source of each low-stock subscription and a durable sequence
-- for deduplicating stock-state transition notifications.

ALTER TABLE low_stock_subscriptions
  ADD COLUMN explicit_subscription TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active,
  ADD COLUMN wishlist_subscription TINYINT(1) NOT NULL DEFAULT 0 AFTER explicit_subscription,
  ADD COLUMN user_opted_out TINYINT(1) NOT NULL DEFAULT 0 AFTER wishlist_subscription,
  ADD COLUMN last_observed_state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'unknown' AFTER last_observed_quantity,
  ADD COLUMN transition_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER last_observed_state,
  ADD CONSTRAINT chk_low_stock_subscriptions_explicit CHECK (explicit_subscription IN (0, 1)),
  ADD CONSTRAINT chk_low_stock_subscriptions_wishlist CHECK (wishlist_subscription IN (0, 1)),
  ADD CONSTRAINT chk_low_stock_subscriptions_opted_out CHECK (user_opted_out IN (0, 1)),
  ADD CONSTRAINT chk_low_stock_subscriptions_state CHECK (last_observed_state IN ('unknown', 'available', 'low'));

-- statement-breakpoint

UPDATE low_stock_subscriptions
   SET explicit_subscription = is_active
 WHERE is_active = 1;
