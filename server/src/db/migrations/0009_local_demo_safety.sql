-- Local-demo identities are marked independently from mutable profile fields.
-- The environment table is intentionally left empty: a database administrator
-- must attest a local-development database explicitly after migrations run.

CREATE TABLE IF NOT EXISTS application_environment (
  singleton_id TINYINT UNSIGNED NOT NULL,
  environment_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (singleton_id),
  CONSTRAINT chk_application_environment_singleton CHECK (singleton_id = 1),
  CONSTRAINT chk_application_environment_kind CHECK (
    environment_kind IN ('local_development', 'staging', 'production')
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS local_demo_accounts (
  singleton_id TINYINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (singleton_id),
  UNIQUE KEY uq_local_demo_accounts_user (user_id),
  CONSTRAINT fk_local_demo_accounts_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_local_demo_accounts_singleton CHECK (singleton_id = 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
