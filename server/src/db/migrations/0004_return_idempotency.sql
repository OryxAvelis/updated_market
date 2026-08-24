CREATE TABLE IF NOT EXISTS return_request_idempotency (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  key_digest BINARY(32) NOT NULL,
  request_digest BINARY(32) NOT NULL,
  return_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_return_request_idempotency_user_key (user_id, key_digest),
  UNIQUE KEY uq_return_request_idempotency_return (return_id),
  CONSTRAINT fk_return_request_idempotency_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_return_request_idempotency_return FOREIGN KEY (return_id) REFERENCES return_requests (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
