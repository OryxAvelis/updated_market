-- Enforce personalization consent in MySQL so older application instances
-- cannot recreate recommendation snapshots during a rolling deployment.
CREATE TRIGGER trg_recommendation_snapshots_require_consent
BEFORE INSERT ON recommendation_snapshots
FOR EACH ROW
SET NEW.user_id = IF(
  COALESCE((
    SELECT pref.personalization_enabled
      FROM user_preferences AS pref
     WHERE pref.user_id = NEW.user_id
     LIMIT 1
     FOR SHARE
  ), 0) = 1,
  NEW.user_id,
  NULL
);

-- statement-breakpoint

-- A legacy opt-out that only updates preferences still removes every snapshot.
CREATE TRIGGER trg_user_preferences_purge_recommendations
AFTER UPDATE ON user_preferences
FOR EACH ROW
DELETE FROM recommendation_snapshots
 WHERE user_id = NEW.user_id
   AND NEW.personalization_enabled = 0;

-- statement-breakpoint

-- Close the pre-trigger data window after both guards are active.
DELETE snapshots
  FROM recommendation_snapshots AS snapshots
  JOIN user_preferences AS pref ON pref.user_id = snapshots.user_id
 WHERE pref.personalization_enabled = 0;
