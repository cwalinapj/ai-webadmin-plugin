export type WatchdogAction = 'enable' | 'disable' | 'noop';

export interface WatchdogAutomationStateRecord {
  site_id: string;
  plugin_id: string;
  last_action: WatchdogAction;
  last_status: string;
  last_rps: number;
  last_response_json: string | null;
  last_run_at: string;
  updated_at: string;
}

export interface SaveWatchdogAutomationStateInput {
  siteId: string;
  pluginId: string;
  action: WatchdogAction;
  status: 'success' | 'failed';
  rps: number;
  responseJson: string;
}

export async function getWatchdogAutomationState(
  db: D1Database,
  siteId: string,
): Promise<WatchdogAutomationStateRecord | null> {
  const row = await db
    .prepare(
      `SELECT site_id, plugin_id, last_action, last_status, last_rps, last_response_json, last_run_at, updated_at
       FROM watchdog_automation_state
       WHERE site_id = ?1
       LIMIT 1`,
    )
    .bind(siteId)
    .first<WatchdogAutomationStateRecord>();

  if (!row) {
    return null;
  }

  return {
    site_id: String(row.site_id),
    plugin_id: String(row.plugin_id),
    last_action: normalizeAction(row.last_action),
    last_status: String(row.last_status),
    last_rps: Number(row.last_rps ?? 0),
    last_response_json: row.last_response_json ? String(row.last_response_json) : null,
    last_run_at: String(row.last_run_at),
    updated_at: String(row.updated_at),
  };
}

export async function saveWatchdogAutomationState(
  db: D1Database,
  input: SaveWatchdogAutomationStateInput,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO watchdog_automation_state (
         site_id, plugin_id, last_action, last_status, last_rps, last_response_json, last_run_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(site_id) DO UPDATE SET
         plugin_id = excluded.plugin_id,
         last_action = excluded.last_action,
         last_status = excluded.last_status,
         last_rps = excluded.last_rps,
         last_response_json = excluded.last_response_json,
         last_run_at = excluded.last_run_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.siteId,
      input.pluginId,
      input.action,
      input.status,
      Number.isFinite(input.rps) ? input.rps : 0,
      input.responseJson,
      now,
      now,
    )
    .run();
}

function normalizeAction(value: unknown): WatchdogAction {
  if (value === 'enable' || value === 'disable' || value === 'noop') {
    return value;
  }

  return 'noop';
}
