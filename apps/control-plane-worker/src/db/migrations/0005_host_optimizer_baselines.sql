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
  storage_type TEXT NOT NULL DEFAULT '',
  uplink_mbps TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  captured_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  home_ttfb_ms REAL,
  rest_ttfb_ms REAL,
  cpu_ops_per_sec REAL,
  disk_write_mb_per_sec REAL,
  disk_read_mb_per_sec REAL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_host_optimizer_baselines_plugin_captured
  ON host_optimizer_baselines (plugin_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_host_optimizer_baselines_region_storage
  ON host_optimizer_baselines (region_label, storage_type, uplink_mbps);
