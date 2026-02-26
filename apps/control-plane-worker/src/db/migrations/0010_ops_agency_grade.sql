CREATE TABLE IF NOT EXISTS job_artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_job_artifacts_job_created
  ON job_artifacts (job_id, created_at);

CREATE INDEX IF NOT EXISTS idx_job_artifacts_site_created
  ON job_artifacts (site_id, created_at);

CREATE TABLE IF NOT EXISTS incident_reports (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  status TEXT NOT NULL,
  trigger_source TEXT NOT NULL,
  summary TEXT NOT NULL,
  timeline_json TEXT NOT NULL,
  diagnostics_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_incident_reports_site_created
  ON incident_reports (site_id, created_at);

CREATE TABLE IF NOT EXISTS site_cost_policies (
  site_id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  plan_code TEXT NOT NULL DEFAULT 'sandbox_monthly',
  monthly_budget_usd REAL NOT NULL DEFAULT 50,
  sandbox_cost_per_minute_usd REAL NOT NULL DEFAULT 0.08,
  hard_limit INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_site_cost_policies_plan_updated
  ON site_cost_policies (plan_code, updated_at);

CREATE TABLE IF NOT EXISTS site_usage_counters (
  site_id TEXT PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  sandbox_minutes INTEGER NOT NULL DEFAULT 0,
  sandbox_cost_usd REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_site_usage_counters_period
  ON site_usage_counters (period_start, period_end, updated_at);
