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
