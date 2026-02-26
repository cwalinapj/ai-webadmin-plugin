export interface HeartbeatPayload {
  site_id: string;
  domain: string;
  plan?: string;
  timezone?: string;
  wp_version?: string;
  php_version?: string;
  theme?: string;
  active_plugins_count?: number;
  load_avg?: number[];
  traffic_rps?: number;
  error_counts?: Record<string, number>;
  site_url?: string;
}

export async function upsertSite(db: D1Database, payload: HeartbeatPayload): Promise<void> {
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO sites (id, domain, wp_version, plan, timezone, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(id) DO UPDATE SET
         domain = excluded.domain,
         wp_version = excluded.wp_version,
         plan = excluded.plan,
         timezone = excluded.timezone,
         updated_at = excluded.updated_at`,
    )
    .bind(
      payload.site_id,
      payload.domain,
      payload.wp_version ?? '',
      payload.plan ?? 'unknown',
      payload.timezone ?? 'UTC',
      now,
    )
    .run();
}
