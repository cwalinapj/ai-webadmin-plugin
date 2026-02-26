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

CREATE TABLE IF NOT EXISTS google_oauth_sessions (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  return_url TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_google_oauth_sessions_site_created
  ON google_oauth_sessions (site_id, created_at);

CREATE TABLE IF NOT EXISTS google_oauth_tokens (
  site_id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  scope TEXT,
  token_type TEXT,
  expires_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_google_oauth_tokens_plugin
  ON google_oauth_tokens (plugin_id);
