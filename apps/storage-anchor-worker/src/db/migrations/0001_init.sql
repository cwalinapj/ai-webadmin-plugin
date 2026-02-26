CREATE TABLE IF NOT EXISTS anchor_objects (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  priority TEXT NOT NULL,
  retention_class TEXT NOT NULL,
  primary_provider TEXT NOT NULL,
  status TEXT NOT NULL,
  r2_key TEXT,
  b2_file_name TEXT,
  ipfs_cid TEXT,
  ipfs_gateway_url TEXT,
  ipfs_size_bytes INTEGER,
  metadata_json TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_accessed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_anchor_objects_created
  ON anchor_objects (created_at);

CREATE INDEX IF NOT EXISTS idx_anchor_objects_status
  ON anchor_objects (status, updated_at);

CREATE TABLE IF NOT EXISTS anchor_tasks (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL,
  target_provider TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_anchor_tasks_object_target_action
  ON anchor_tasks (object_id, target_provider, action);

CREATE INDEX IF NOT EXISTS idx_anchor_tasks_status
  ON anchor_tasks (status, updated_at);
