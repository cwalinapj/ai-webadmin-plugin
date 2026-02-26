export interface ReplayResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export async function consumeNonce(db: D1Database, pluginId: string, nonce: string): Promise<ReplayResult> {
  await db.prepare("DELETE FROM nonces WHERE seen_at < datetime('now', '-1 day')").run();

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

  await db.prepare("DELETE FROM idempotency_keys WHERE seen_at < datetime('now', '-1 day')").run();

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
