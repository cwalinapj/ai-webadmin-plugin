CREATE TABLE IF NOT EXISTS sandbox_budget_reservations (
  request_id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  reserved_minutes INTEGER NOT NULL,
  reserved_cost_usd REAL NOT NULL,
  cost_per_minute_usd REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',
  reserved_at TEXT NOT NULL,
  actual_minutes INTEGER,
  actual_cost_usd REAL,
  reconciled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sandbox_budget_reservations_site_status
  ON sandbox_budget_reservations (site_id, status, reserved_at);

CREATE TABLE IF NOT EXISTS sandbox_billing_ledger (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0,
  amount_usd REAL NOT NULL DEFAULT 0,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sandbox_billing_ledger_site_created
  ON sandbox_billing_ledger (site_id, created_at);

CREATE INDEX IF NOT EXISTS idx_sandbox_billing_ledger_request
  ON sandbox_billing_ledger (request_id, created_at);
