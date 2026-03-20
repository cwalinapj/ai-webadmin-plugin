export interface ReplayResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export interface ReplayPolicyOptions {
  retentionSeconds?: number;
}

const DEFAULT_RETENTION_SECONDS = 24 * 60 * 60;

export async function cleanupReplayArtifacts(
  db: D1Database,
  options: ReplayPolicyOptions = {},
): Promise<void> {
  const retention = sanitizeRetentionSeconds(options.retentionSeconds);
  const cutoffDate = new Date(Date.now() - retention * 1000).toISOString();

  await db.prepare('DELETE FROM nonces WHERE seen_at < ?1').bind(cutoffDate).run();
  await db.prepare('DELETE FROM idempotency_keys WHERE seen_at < ?1').bind(cutoffDate).run();
}

export async function consumeNonce(
  db: D1Database,
  pluginId: string,
  nonce: string,
): Promise<ReplayResult> {
  try {
    await db
      .prepare('INSERT INTO nonces (plugin_id, nonce, seen_at) VALUES (?1, ?2, ?3)')
      .bind(pluginId, nonce, new Date().toISOString())
      .run();

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      status: 409,
      error: 'nonce_reused',
    };
  }
}

export async function consumeIdempotencyKey(
  db: D1Database,
  pluginId: string,
  idempotencyKey: string | null,
): Promise<ReplayResult> {
  const key = idempotencyKey?.trim() ?? '';
  if (key === '') {
    return {
      ok: false,
      status: 400,
      error: 'missing_idempotency_key',
    };
  }

  try {
    await db
      .prepare('INSERT INTO idempotency_keys (plugin_id, idempotency_key, seen_at) VALUES (?1, ?2, ?3)')
      .bind(pluginId, key, new Date().toISOString())
      .run();

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      status: 409,
      error: 'duplicate_idempotency_key',
    };
  }
}

function sanitizeRetentionSeconds(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_RETENTION_SECONDS;
  }
  return Math.max(60, Math.floor(value));
}
