CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  wp_version TEXT,
  plan TEXT,
  timezone TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nonces (
  plugin_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (plugin_id, nonce)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  tab TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  risk_score REAL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  plugin_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (plugin_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS sandbox_requests (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  requested_by_agent TEXT NOT NULL,
  task_type TEXT NOT NULL,
  priority_base INTEGER NOT NULL DEFAULT 3,
  estimated_minutes INTEGER NOT NULL DEFAULT 30,
  earliest_start_at TEXT,
  status TEXT NOT NULL,
  context_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  claimed_by_agent TEXT,
  claimed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sandbox_requests_queue
  ON sandbox_requests (status, earliest_start_at, created_at);

CREATE TABLE IF NOT EXISTS sandbox_votes (
  request_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  vote INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (request_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_sandbox_votes_request
  ON sandbox_votes (request_id);

CREATE TABLE IF NOT EXISTS sandbox_allocations (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  sandbox_id TEXT NOT NULL,
  claimed_by_agent TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS host_optimizer_baselines (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  site_url TEXT NOT NULL DEFAULT '',
  provider_name TEXT NOT NULL DEFAULT '',
  region_label TEXT NOT NULL DEFAULT '',
  virtualization_os TEXT NOT NULL DEFAULT '',
  cpu_model TEXT NOT NULL DEFAULT '',
  cpu_year TEXT NOT NULL DEFAULT '',
  ram_gb TEXT NOT NULL DEFAULT '',
  memory_class TEXT NOT NULL DEFAULT '',
  webserver_type TEXT NOT NULL DEFAULT '',
  storage_type TEXT NOT NULL DEFAULT '',
  uplink_mbps TEXT NOT NULL DEFAULT '',
  gpu_acceleration_mode TEXT NOT NULL DEFAULT '',
  gpu_model TEXT NOT NULL DEFAULT '',
  gpu_count TEXT NOT NULL DEFAULT '',
  gpu_vram_gb TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  captured_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  home_ttfb_ms REAL,
  rest_ttfb_ms REAL,
  cpu_ops_per_sec REAL,
  disk_write_mb_per_sec REAL,
  disk_read_mb_per_sec REAL,
  memory_pressure_score REAL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_host_optimizer_baselines_plugin_captured
  ON host_optimizer_baselines (plugin_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_host_optimizer_baselines_region_storage
  ON host_optimizer_baselines (region_label, storage_type, uplink_mbps);

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
