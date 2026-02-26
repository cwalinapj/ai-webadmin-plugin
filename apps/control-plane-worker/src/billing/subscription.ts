export type BillingStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid';

export interface BillingSubscriptionRecord {
  site_id: string;
  plugin_id: string;
  plan_code: string;
  status: BillingStatus;
  sandbox_enabled: number;
  current_period_end: string | null;
  grace_period_end: string | null;
  updated_at: string;
}

export interface UpsertBillingSubscriptionInput {
  siteId: string;
  pluginId: string;
  planCode: string;
  status: BillingStatus;
  sandboxEnabled: boolean;
  currentPeriodEnd: string | null;
  gracePeriodEnd: string | null;
}

export interface SandboxBillingCheckResult {
  allowed: boolean;
  reason: string;
  status: BillingStatus | 'missing';
  subscription: BillingSubscriptionRecord | null;
}

export async function upsertBillingSubscription(
  db: D1Database,
  input: UpsertBillingSubscriptionInput,
): Promise<void> {
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO billing_subscriptions (
         site_id, plugin_id, plan_code, status, sandbox_enabled, current_period_end, grace_period_end, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(site_id) DO UPDATE SET
         plugin_id = excluded.plugin_id,
         plan_code = excluded.plan_code,
         status = excluded.status,
         sandbox_enabled = excluded.sandbox_enabled,
         current_period_end = excluded.current_period_end,
         grace_period_end = excluded.grace_period_end,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.siteId,
      input.pluginId,
      input.planCode,
      input.status,
      input.sandboxEnabled ? 1 : 0,
      input.currentPeriodEnd,
      input.gracePeriodEnd,
      now,
    )
    .run();
}

export async function getBillingSubscriptionBySite(
  db: D1Database,
  siteId: string,
): Promise<BillingSubscriptionRecord | null> {
  const row = await db
    .prepare(
      `SELECT site_id, plugin_id, plan_code, status, sandbox_enabled, current_period_end, grace_period_end, updated_at
       FROM billing_subscriptions
       WHERE site_id = ?1
       LIMIT 1`,
    )
    .bind(siteId)
    .first<BillingSubscriptionRecord>();

  return normalizeRecord(row);
}

export async function getBillingSubscriptionByPlugin(
  db: D1Database,
  pluginId: string,
): Promise<BillingSubscriptionRecord | null> {
  const row = await db
    .prepare(
      `SELECT site_id, plugin_id, plan_code, status, sandbox_enabled, current_period_end, grace_period_end, updated_at
       FROM billing_subscriptions
       WHERE plugin_id = ?1
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .bind(pluginId)
    .first<BillingSubscriptionRecord>();

  return normalizeRecord(row);
}

export async function checkSandboxBillingAccess(
  db: D1Database,
  input: {
    siteId: string;
    pluginId: string;
    defaultAllow: boolean;
  },
): Promise<SandboxBillingCheckResult> {
  let record: BillingSubscriptionRecord | null = null;
  try {
    record = await getBillingSubscriptionBySite(db, input.siteId);
    if (!record && input.pluginId.trim() !== '') {
      record = await getBillingSubscriptionByPlugin(db, input.pluginId);
    }
  } catch {
    return {
      allowed: false,
      reason: 'billing_lookup_failed',
      status: 'missing',
      subscription: null,
    };
  }

  if (!record) {
    return {
      allowed: input.defaultAllow,
      reason: input.defaultAllow ? 'missing_subscription_default_allow' : 'missing_subscription',
      status: 'missing',
      subscription: null,
    };
  }

  if (Number(record.sandbox_enabled) !== 1) {
    return {
      allowed: false,
      reason: 'sandbox_disabled',
      status: record.status,
      subscription: record,
    };
  }

  if (record.status === 'active' || record.status === 'trialing') {
    return {
      allowed: true,
      reason: 'subscription_active',
      status: record.status,
      subscription: record,
    };
  }

  if (record.status === 'past_due' && isGracePeriodValid(record.grace_period_end)) {
    return {
      allowed: true,
      reason: 'past_due_within_grace_period',
      status: record.status,
      subscription: record,
    };
  }

  return {
    allowed: false,
    reason: 'subscription_inactive',
    status: record.status,
    subscription: record,
  };
}

function isGracePeriodValid(isoValue: string | null): boolean {
  if (!isoValue || isoValue.trim() === '') {
    return false;
  }
  const parsed = Date.parse(isoValue);
  if (!Number.isFinite(parsed)) {
    return false;
  }

  return parsed >= Date.now();
}

function normalizeRecord(row: BillingSubscriptionRecord | null): BillingSubscriptionRecord | null {
  if (!row) {
    return null;
  }

  return {
    site_id: String(row.site_id),
    plugin_id: String(row.plugin_id),
    plan_code: String(row.plan_code || 'sandbox_monthly'),
    status: normalizeStatus(row.status),
    sandbox_enabled: Number(row.sandbox_enabled ?? 0),
    current_period_end: row.current_period_end ? String(row.current_period_end) : null,
    grace_period_end: row.grace_period_end ? String(row.grace_period_end) : null,
    updated_at: String(row.updated_at),
  };
}

function normalizeStatus(value: unknown): BillingStatus {
  if (
    value === 'active' ||
    value === 'trialing' ||
    value === 'past_due' ||
    value === 'canceled' ||
    value === 'unpaid'
  ) {
    return value;
  }

  return 'unpaid';
}
