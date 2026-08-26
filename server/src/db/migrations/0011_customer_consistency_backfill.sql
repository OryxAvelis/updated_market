-- Normalize values left behind by customer flows that are now stricter.
-- Historical orders remain untouched. Only disabled defaults and completed
-- cancellation metadata are repaired.
UPDATE user_preferences
   SET default_payment = 'cod'
 WHERE default_payment = 'card';

-- statement-breakpoint

UPDATE order_cancellations
   SET processed_at = requested_at
 WHERE status IN ('accepted', 'rejected')
   AND processed_at IS NULL;
