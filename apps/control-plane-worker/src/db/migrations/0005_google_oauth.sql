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
