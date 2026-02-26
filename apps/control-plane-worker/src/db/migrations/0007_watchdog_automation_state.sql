CREATE TABLE IF NOT EXISTS watchdog_automation_state (
  site_id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  last_action TEXT NOT NULL,
  last_status TEXT NOT NULL,
  last_rps REAL NOT NULL DEFAULT 0,
  last_response_json TEXT,
  last_run_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_watchdog_automation_plugin_updated
  ON watchdog_automation_state (plugin_id, updated_at);
