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
