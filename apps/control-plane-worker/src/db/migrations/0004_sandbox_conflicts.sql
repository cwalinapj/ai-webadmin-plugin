CREATE TABLE IF NOT EXISTS sandbox_conflicts (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  request_id TEXT,
  agent_id TEXT NOT NULL,
  conflict_type TEXT NOT NULL,
  severity INTEGER NOT NULL DEFAULT 3,
  summary TEXT NOT NULL,
  details_json TEXT,
  blocked_by_request_id TEXT,
  sandbox_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolution_note TEXT,
  resolved_by_agent TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sandbox_conflicts_plugin_status_created
  ON sandbox_conflicts (plugin_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_sandbox_conflicts_request_status
  ON sandbox_conflicts (request_id, status);
