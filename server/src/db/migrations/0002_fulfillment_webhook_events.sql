CREATE TABLE IF NOT EXISTS fulfillment_webhook_events (
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_digest BINARY(32) NOT NULL,
  state VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'processing',
  target_status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id BIGINT UNSIGNED NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (event_id),
  KEY idx_fulfillment_webhook_order (order_id, received_at),
  KEY idx_fulfillment_webhook_state (state, received_at),
  CONSTRAINT fk_fulfillment_webhook_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL,
  CONSTRAINT chk_fulfillment_webhook_state CHECK (state IN ('processing', 'completed')),
  CONSTRAINT chk_fulfillment_webhook_target CHECK (target_status IN ('preparing', 'shipping', 'delivered'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
