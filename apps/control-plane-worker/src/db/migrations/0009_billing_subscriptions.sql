CREATE TABLE IF NOT EXISTS billing_subscriptions (
  site_id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  plan_code TEXT NOT NULL DEFAULT 'sandbox_monthly',
  status TEXT NOT NULL,
  sandbox_enabled INTEGER NOT NULL DEFAULT 1,
  current_period_end TEXT,
  grace_period_end TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_plugin_status
  ON billing_subscriptions (plugin_id, status, updated_at);
