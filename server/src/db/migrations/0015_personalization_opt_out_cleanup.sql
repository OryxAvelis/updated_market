-- Remove recommendation material that predates immediate opt-out cleanup.
-- Reapplying this data migration is safe because the delete is idempotent.
DELETE rs
  FROM recommendation_snapshots AS rs
  JOIN user_preferences AS pref ON pref.user_id = rs.user_id
 WHERE pref.personalization_enabled = 0;
