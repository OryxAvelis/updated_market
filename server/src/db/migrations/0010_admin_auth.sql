-- Administrator identities and sessions are deliberately separate from
-- customer users and customer sessions. No foreign key or role flag joins the
-- two authentication domains.

CREATE TABLE IF NOT EXISTS admin_identities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email VARCHAR(254) NOT NULL,
  email_normalized VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'owner',
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  failed_login_count INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME(3) NULL,
  password_changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_login_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_identities_public_id (public_id),
  UNIQUE KEY uq_admin_identities_email_normalized (email_normalized),
  KEY idx_admin_identities_status_created (status, created_at),
  CONSTRAINT chk_admin_identities_role CHECK (role IN ('owner', 'manager', 'support')),
  CONSTRAINT chk_admin_identities_status CHECK (status IN ('active', 'disabled', 'locked')),
  CONSTRAINT chk_admin_identities_email CHECK (CHAR_LENGTH(email_normalized) > 0),
  CONSTRAINT chk_admin_identities_display_name CHECK (CHAR_LENGTH(display_name) > 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS admin_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  admin_id BIGINT UNSIGNED NOT NULL,
  token_digest BINARY(32) NOT NULL,
  csrf_digest BINARY(32) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  idle_expires_at DATETIME(3) NOT NULL,
  absolute_expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  revocation_reason VARCHAR(80) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_sessions_public_id (public_id),
  UNIQUE KEY uq_admin_sessions_token_digest (token_digest),
  KEY idx_admin_sessions_admin_active (admin_id, revoked_at, absolute_expires_at),
  KEY idx_admin_sessions_expiry (absolute_expires_at, idle_expires_at),
  CONSTRAINT fk_admin_sessions_admin FOREIGN KEY (admin_id) REFERENCES admin_identities (id) ON DELETE CASCADE,
  CONSTRAINT chk_admin_sessions_expiry CHECK (idle_expires_at <= absolute_expires_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
