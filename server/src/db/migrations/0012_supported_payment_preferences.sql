-- Keep saved customer payment preferences aligned with the methods the
-- account API and settings UI currently support. Historical orders keep
-- their original payment_method values, including card.
UPDATE user_preferences
   SET default_payment = 'cod'
 WHERE default_payment = 'card';

-- statement-breakpoint

-- MySQL 8 applies a single ALTER TABLE atomically. Keeping the original
-- constraint name makes this safe to retry if the process stops after the
-- ALTER succeeds but before schema_migrations records the migration.
ALTER TABLE user_preferences
  DROP CHECK chk_user_preferences_payment,
  ADD CONSTRAINT chk_user_preferences_payment
    CHECK (default_payment IN ('cod', 'wafacash', 'cashplus'));
