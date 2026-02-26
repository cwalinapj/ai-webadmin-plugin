CREATE TABLE IF NOT EXISTS idempotency_keys (
  plugin_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (plugin_id, idempotency_key)
);
