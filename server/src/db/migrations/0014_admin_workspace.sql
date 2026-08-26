-- Cross-session administrator workspace documents. These records are drafts:
-- product/category/inventory/promotion overlays and delivery zones do not
-- change the external catalog or storefront behavior. Only the two typed
-- delivery-rule values are synchronized into store_delivery_settings.
CREATE TABLE IF NOT EXISTS admin_workspace_documents (
  resource VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  document JSON NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (resource),
  KEY idx_admin_workspace_updated_by (updated_by),
  CONSTRAINT fk_admin_workspace_updated_by
    FOREIGN KEY (updated_by) REFERENCES admin_identities (id) ON DELETE RESTRICT,
  CONSTRAINT chk_admin_workspace_resource CHECK (
    resource IN ('products', 'categories', 'inventory', 'promotions', 'delivery', 'settings')
  ),
  CONSTRAINT chk_admin_workspace_revision CHECK (revision >= 1),
  CONSTRAINT chk_admin_workspace_document_object CHECK (JSON_TYPE(document) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS store_delivery_settings (
  singleton_id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  default_fee_cents INT UNSIGNED NOT NULL DEFAULT 2000,
  free_delivery_threshold_cents INT UNSIGNED NOT NULL DEFAULT 20000,
  workspace_revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (singleton_id),
  KEY idx_store_delivery_updated_by (updated_by),
  CONSTRAINT fk_store_delivery_updated_by
    FOREIGN KEY (updated_by) REFERENCES admin_identities (id) ON DELETE SET NULL,
  CONSTRAINT chk_store_delivery_singleton CHECK (singleton_id = 1),
  CONSTRAINT chk_store_delivery_default_fee CHECK (default_fee_cents <= 10000000),
  CONSTRAINT chk_store_delivery_free_threshold CHECK (free_delivery_threshold_cents <= 100000000)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- statement-breakpoint

INSERT INTO store_delivery_settings
  (singleton_id, default_fee_cents, free_delivery_threshold_cents, workspace_revision)
VALUES (1, 2000, 20000, 0)
ON DUPLICATE KEY UPDATE singleton_id = VALUES(singleton_id);
