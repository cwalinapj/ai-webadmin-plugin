export interface SandboxBudgetDecision {
  allowed: boolean;
  reason: string;
  budget_usd: number;
  current_cost_usd: number;
  projected_cost_usd: number;
  estimated_cost_usd: number;
  hard_limit: boolean;
  period_start: string;
  period_end: string;
}

export interface EvaluateSandboxBudgetInput {
  siteId: string;
  pluginId: string;
  requestId: string;
  estimatedMinutes: number;
  allowOverage: boolean;
  defaultBudgetUsd: number;
  defaultCostPerMinuteUsd: number;
  defaultHardLimit: boolean;
}

export async function evaluateAndReserveSandboxBudget(
  db: D1Database,
  input: EvaluateSandboxBudgetInput,
): Promise<SandboxBudgetDecision> {
  const period = currentMonthPeriod();
  const policy = await getSiteCostPolicy(db, input.siteId);

  const budgetUsd = policy ? Number(policy.monthly_budget_usd) : input.defaultBudgetUsd;
  const costPerMinuteUsd = policy
    ? Number(policy.sandbox_cost_per_minute_usd)
    : input.defaultCostPerMinuteUsd;
  const hardLimit = policy ? Number(policy.hard_limit) === 1 : input.defaultHardLimit;

  const usage = await getOrResetUsageCounter(db, input.siteId, period.start, period.end);
  const reservedCostUsd = await getReservedCostUsd(db, input.siteId);
  const estimatedCostUsd = roundMoney(Math.max(0, input.estimatedMinutes) * Math.max(0, costPerMinuteUsd));
  const projectedCostUsd = roundMoney(usage.sandbox_cost_usd + reservedCostUsd + estimatedCostUsd);

  const budgetActive = budgetUsd > 0;
  if (budgetActive && projectedCostUsd > budgetUsd && hardLimit && !input.allowOverage) {
    return {
      allowed: false,
      reason: 'sandbox_budget_exceeded',
      budget_usd: budgetUsd,
      current_cost_usd: roundMoney(usage.sandbox_cost_usd),
      projected_cost_usd: projectedCostUsd,
      estimated_cost_usd: estimatedCostUsd,
      hard_limit: hardLimit,
      period_start: period.start,
      period_end: period.end,
    };
  }

  await ensureSitePolicySeeded(db, {
    siteId: input.siteId,
    pluginId: input.pluginId,
    budgetUsd,
    costPerMinuteUsd,
    hardLimit,
  });

  await createBudgetReservation(db, {
    requestId: input.requestId,
    siteId: input.siteId,
    reservedMinutes: input.estimatedMinutes,
    reservedCostUsd: estimatedCostUsd,
    costPerMinuteUsd,
  });

  return {
    allowed: true,
    reason: budgetActive ? 'sandbox_budget_reserved' : 'sandbox_budget_unlimited',
    budget_usd: budgetUsd,
    current_cost_usd: roundMoney(usage.sandbox_cost_usd + reservedCostUsd),
    projected_cost_usd: projectedCostUsd,
    estimated_cost_usd: estimatedCostUsd,
    hard_limit: hardLimit,
    period_start: period.start,
    period_end: period.end,
  };
}

export async function reconcileSandboxBudgetReservation(
  db: D1Database,
  input: {
    requestId: string;
    siteId: string;
    actualMinutes: number;
    outcome: 'completed' | 'failed' | 'requeue';
  },
): Promise<
  | {
      ok: true;
      reservedMinutes: number;
      actualMinutes: number;
      reservedCostUsd: number;
      actualCostUsd: number;
      adjustmentCostUsd: number;
    }
  | {
      ok: false;
      reason: 'reservation_not_found' | 'reservation_already_reconciled';
    }
> {
  const reservation =
    (await db
      .prepare(
        `SELECT request_id, site_id, reserved_minutes, reserved_cost_usd, cost_per_minute_usd, status
         FROM sandbox_budget_reservations
         WHERE request_id = ?1
         LIMIT 1`,
      )
      .bind(input.requestId)
      .first<{
        request_id: string;
        site_id: string;
        reserved_minutes: number;
        reserved_cost_usd: number;
        cost_per_minute_usd: number;
        status: string;
      }>()) ?? null;

  if (!reservation) {
    return { ok: false, reason: 'reservation_not_found' };
  }

  if (reservation.status !== 'reserved') {
    return { ok: false, reason: 'reservation_already_reconciled' };
  }

  const reservedMinutes = Math.max(0, Math.floor(Number(reservation.reserved_minutes ?? 0)));
  const reservedCostUsd = roundMoney(Number(reservation.reserved_cost_usd ?? 0));
  const costPerMinuteUsd = Math.max(0, Number(reservation.cost_per_minute_usd ?? 0));
  const actualMinutes =
    input.outcome === 'requeue' ? 0 : Math.max(0, Math.floor(Number(input.actualMinutes ?? 0)));
  const actualCostUsd = roundMoney(actualMinutes * costPerMinuteUsd);
  const adjustmentCostUsd = roundMoney(actualCostUsd - reservedCostUsd);
  const adjustmentMinutes = Math.max(0, actualMinutes - reservedMinutes);
  const now = new Date().toISOString();

  const period = currentMonthPeriod();
  const usage = await getOrResetUsageCounter(db, input.siteId, period.start, period.end);
  await upsertUsageCounter(db, {
    siteId: input.siteId,
    periodStart: period.start,
    periodEnd: period.end,
    sandboxMinutes: usage.sandbox_minutes + actualMinutes,
    sandboxCostUsd: usage.sandbox_cost_usd + actualCostUsd,
  });

  await db
    .prepare(
      `UPDATE sandbox_budget_reservations
       SET status = ?1,
           actual_minutes = ?2,
           actual_cost_usd = ?3,
           reconciled_at = ?4
       WHERE request_id = ?5`,
    )
    .bind(input.outcome, actualMinutes, actualCostUsd, now, input.requestId)
    .run();

  const kind = adjustmentCostUsd > 0 ? 'overage' : adjustmentCostUsd < 0 ? 'refund' : 'reconcile';
  await db
    .prepare(
      `INSERT INTO sandbox_billing_ledger (
         id, site_id, request_id, kind, minutes, amount_usd, details_json, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      crypto.randomUUID(),
      input.siteId,
      input.requestId,
      kind,
      adjustmentMinutes,
      Math.abs(adjustmentCostUsd),
      JSON.stringify({
        reserved_minutes: reservedMinutes,
        actual_minutes: actualMinutes,
        reserved_cost_usd: reservedCostUsd,
        actual_cost_usd: actualCostUsd,
      }),
      now,
    )
    .run();

  return {
    ok: true,
    reservedMinutes,
    actualMinutes,
    reservedCostUsd,
    actualCostUsd,
    adjustmentCostUsd,
  };
}

interface CostPolicyRow {
  site_id: string;
  plugin_id: string;
  plan_code: string;
  monthly_budget_usd: number;
  sandbox_cost_per_minute_usd: number;
  hard_limit: number;
  updated_at: string;
}

interface UsageRow {
  site_id: string;
  period_start: string;
  period_end: string;
  sandbox_minutes: number;
  sandbox_cost_usd: number;
  updated_at: string;
}

async function getReservedCostUsd(db: D1Database, siteId: string): Promise<number> {
  const row =
    (await db
      .prepare(
        `SELECT COALESCE(SUM(reserved_cost_usd), 0) AS total_reserved_cost_usd
         FROM sandbox_budget_reservations
         WHERE site_id = ?1
           AND status = 'reserved'`,
      )
      .bind(siteId)
      .first<{ total_reserved_cost_usd: number }>()) ?? null;

  return roundMoney(Number(row?.total_reserved_cost_usd ?? 0));
}

async function getSiteCostPolicy(db: D1Database, siteId: string): Promise<CostPolicyRow | null> {
  return (
    (await db
      .prepare(
        `SELECT site_id, plugin_id, plan_code, monthly_budget_usd, sandbox_cost_per_minute_usd, hard_limit, updated_at
         FROM site_cost_policies
         WHERE site_id = ?1
         LIMIT 1`,
      )
      .bind(siteId)
      .first<CostPolicyRow>()) ?? null
  );
}

async function getOrResetUsageCounter(
  db: D1Database,
  siteId: string,
  periodStart: string,
  periodEnd: string,
): Promise<UsageRow> {
  const existing =
    (await db
      .prepare(
        `SELECT site_id, period_start, period_end, sandbox_minutes, sandbox_cost_usd, updated_at
         FROM site_usage_counters
         WHERE site_id = ?1
         LIMIT 1`,
      )
      .bind(siteId)
      .first<UsageRow>()) ?? null;

  if (!existing || existing.period_start !== periodStart || existing.period_end !== periodEnd) {
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO site_usage_counters (site_id, period_start, period_end, sandbox_minutes, sandbox_cost_usd, updated_at)
         VALUES (?1, ?2, ?3, 0, 0, ?4)
         ON CONFLICT(site_id) DO UPDATE SET
           period_start = excluded.period_start,
           period_end = excluded.period_end,
           sandbox_minutes = 0,
           sandbox_cost_usd = 0,
           updated_at = excluded.updated_at`,
      )
      .bind(siteId, periodStart, periodEnd, now)
      .run();

    return {
      site_id: siteId,
      period_start: periodStart,
      period_end: periodEnd,
      sandbox_minutes: 0,
      sandbox_cost_usd: 0,
      updated_at: now,
    };
  }

  return {
    ...existing,
    sandbox_minutes: Number(existing.sandbox_minutes ?? 0),
    sandbox_cost_usd: Number(existing.sandbox_cost_usd ?? 0),
  };
}

async function upsertUsageCounter(
  db: D1Database,
  input: {
    siteId: string;
    periodStart: string;
    periodEnd: string;
    sandboxMinutes: number;
    sandboxCostUsd: number;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO site_usage_counters (site_id, period_start, period_end, sandbox_minutes, sandbox_cost_usd, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(site_id) DO UPDATE SET
         period_start = excluded.period_start,
         period_end = excluded.period_end,
         sandbox_minutes = excluded.sandbox_minutes,
         sandbox_cost_usd = excluded.sandbox_cost_usd,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.siteId,
      input.periodStart,
      input.periodEnd,
      Math.max(0, Math.floor(input.sandboxMinutes)),
      roundMoney(input.sandboxCostUsd),
      now,
    )
    .run();
}

async function ensureSitePolicySeeded(
  db: D1Database,
  input: {
    siteId: string;
    pluginId: string;
    budgetUsd: number;
    costPerMinuteUsd: number;
    hardLimit: boolean;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO site_cost_policies (
         site_id, plugin_id, plan_code, monthly_budget_usd, sandbox_cost_per_minute_usd, hard_limit, updated_at
       ) VALUES (?1, ?2, 'sandbox_monthly', ?3, ?4, ?5, ?6)
       ON CONFLICT(site_id) DO NOTHING`,
    )
    .bind(
      input.siteId,
      input.pluginId,
      roundMoney(input.budgetUsd),
      roundMoney(input.costPerMinuteUsd),
      input.hardLimit ? 1 : 0,
      now,
    )
    .run();
}

async function createBudgetReservation(
  db: D1Database,
  input: {
    requestId: string;
    siteId: string;
    reservedMinutes: number;
    reservedCostUsd: number;
    costPerMinuteUsd: number;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO sandbox_budget_reservations (
         request_id, site_id, reserved_minutes, reserved_cost_usd, cost_per_minute_usd, status, reserved_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, 'reserved', ?6)`,
    )
    .bind(
      input.requestId,
      input.siteId,
      Math.max(0, Math.floor(input.reservedMinutes)),
      roundMoney(input.reservedCostUsd),
      roundMoney(input.costPerMinuteUsd),
      now,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO sandbox_billing_ledger (
         id, site_id, request_id, kind, minutes, amount_usd, details_json, created_at
       ) VALUES (?1, ?2, ?3, 'reserve', ?4, ?5, ?6, ?7)`,
    )
    .bind(
      crypto.randomUUID(),
      input.siteId,
      input.requestId,
      Math.max(0, Math.floor(input.reservedMinutes)),
      roundMoney(input.reservedCostUsd),
      JSON.stringify({
        phase: 'reservation',
      }),
      now,
    )
    .run();
}

function currentMonthPeriod(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function roundMoney(value: number): number {
  return Number((Math.max(0, value) + Number.EPSILON).toFixed(4));
}
