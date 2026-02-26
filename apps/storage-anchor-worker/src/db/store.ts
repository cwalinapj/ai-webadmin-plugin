import type { AnchorProvider, AnchorPriority, RetentionClass } from '../types';

export interface AnchorObjectRecord {
  id: string;
  object_key: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  priority: AnchorPriority;
  retention_class: RetentionClass;
  primary_provider: AnchorProvider;
  status: string;
  r2_key: string | null;
  b2_file_name: string | null;
  ipfs_cid: string | null;
  ipfs_gateway_url: string | null;
  ipfs_size_bytes: number | null;
  metadata_json: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
}

export interface CreateAnchorObjectInput {
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  priority: AnchorPriority;
  retentionClass: RetentionClass;
  primaryProvider: 'r2' | 'b2';
  r2Key: string | null;
  b2FileName: string | null;
  metadataJson: string | null;
}

export interface AnchorTaskRecord {
  id: string;
  object_id: string;
  target_provider: AnchorProvider;
  action: 'replicate' | 'backup_ipfs';
  status: 'queued' | 'in_progress' | 'done' | 'failed';
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnchorTaskWithObject {
  task: AnchorTaskRecord;
  object: AnchorObjectRecord;
}

export async function findAnchorObjectByKey(
  db: D1Database,
  objectKey: string,
): Promise<AnchorObjectRecord | null> {
  const row = await db
    .prepare('SELECT * FROM anchor_objects WHERE object_key = ?1 LIMIT 1')
    .bind(objectKey)
    .first<AnchorObjectRecord>();
  return row ?? null;
}

export async function findAnchorObjectById(
  db: D1Database,
  objectId: string,
): Promise<AnchorObjectRecord | null> {
  const row = await db
    .prepare('SELECT * FROM anchor_objects WHERE id = ?1 LIMIT 1')
    .bind(objectId)
    .first<AnchorObjectRecord>();
  return row ?? null;
}

export async function createAnchorObject(
  db: D1Database,
  input: CreateAnchorObjectInput,
): Promise<AnchorObjectRecord> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO anchor_objects (
        id, object_key, content_type, size_bytes, sha256, priority, retention_class, primary_provider, status,
        r2_key, b2_file_name, metadata_json, created_at, updated_at
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'stored_primary',
        ?9, ?10, ?11, ?12, ?13
      )`,
    )
    .bind(
      id,
      input.objectKey,
      input.contentType,
      input.sizeBytes,
      input.sha256,
      input.priority,
      input.retentionClass,
      input.primaryProvider,
      input.r2Key,
      input.b2FileName,
      input.metadataJson,
      now,
      now,
    )
    .run();

  return {
    id,
    object_key: input.objectKey,
    content_type: input.contentType,
    size_bytes: input.sizeBytes,
    sha256: input.sha256,
    priority: input.priority,
    retention_class: input.retentionClass,
    primary_provider: input.primaryProvider,
    status: 'stored_primary',
    r2_key: input.r2Key,
    b2_file_name: input.b2FileName,
    ipfs_cid: null,
    ipfs_gateway_url: null,
    ipfs_size_bytes: null,
    metadata_json: input.metadataJson,
    last_error: null,
    created_at: now,
    updated_at: now,
    last_accessed_at: null,
  };
}

export async function createAnchorTask(
  db: D1Database,
  objectId: string,
  targetProvider: AnchorProvider,
  action: 'replicate' | 'backup_ipfs',
): Promise<AnchorTaskRecord> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO anchor_tasks (
        id, object_id, target_provider, action, status, attempts, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, 'queued', 0, ?5, ?6)`,
    )
    .bind(id, objectId, targetProvider, action, now, now)
    .run();

  return {
    id,
    object_id: objectId,
    target_provider: targetProvider,
    action,
    status: 'queued',
    attempts: 0,
    last_error: null,
    created_at: now,
    updated_at: now,
  };
}

export async function findAnchorTaskById(
  db: D1Database,
  taskId: string,
): Promise<AnchorTaskRecord | null> {
  const row = await db
    .prepare('SELECT * FROM anchor_tasks WHERE id = ?1 LIMIT 1')
    .bind(taskId)
    .first<AnchorTaskRecord>();
  return row ?? null;
}

export async function findTaskWithObjectById(
  db: D1Database,
  taskId: string,
): Promise<AnchorTaskWithObject | null> {
  const row = await db
    .prepare(
      `SELECT
         t.id AS task_id,
         t.object_id AS task_object_id,
         t.target_provider AS task_target_provider,
         t.action AS task_action,
         t.status AS task_status,
         t.attempts AS task_attempts,
         t.last_error AS task_last_error,
         t.created_at AS task_created_at,
         t.updated_at AS task_updated_at,
         o.*
       FROM anchor_tasks t
       JOIN anchor_objects o ON o.id = t.object_id
       WHERE t.id = ?1
       LIMIT 1`,
    )
    .bind(taskId)
    .first<Record<string, unknown>>();
  if (!row) {
    return null;
  }

  const task: AnchorTaskRecord = {
    id: String(row.task_id),
    object_id: String(row.task_object_id),
    target_provider: row.task_target_provider as AnchorProvider,
    action: row.task_action as AnchorTaskRecord['action'],
    status: row.task_status as AnchorTaskRecord['status'],
    attempts: Number(row.task_attempts ?? 0),
    last_error: row.task_last_error ? String(row.task_last_error) : null,
    created_at: String(row.task_created_at),
    updated_at: String(row.task_updated_at),
  };

  const object: AnchorObjectRecord = {
    id: String(row.id),
    object_key: String(row.object_key),
    content_type: String(row.content_type),
    size_bytes: Number(row.size_bytes ?? 0),
    sha256: String(row.sha256),
    priority: row.priority as AnchorPriority,
    retention_class: row.retention_class as RetentionClass,
    primary_provider: row.primary_provider as AnchorProvider,
    status: String(row.status),
    r2_key: row.r2_key ? String(row.r2_key) : null,
    b2_file_name: row.b2_file_name ? String(row.b2_file_name) : null,
    ipfs_cid: row.ipfs_cid ? String(row.ipfs_cid) : null,
    ipfs_gateway_url: row.ipfs_gateway_url ? String(row.ipfs_gateway_url) : null,
    ipfs_size_bytes:
      row.ipfs_size_bytes === null || row.ipfs_size_bytes === undefined
        ? null
        : Number(row.ipfs_size_bytes),
    metadata_json: row.metadata_json ? String(row.metadata_json) : null,
    last_error: row.last_error ? String(row.last_error) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    last_accessed_at: row.last_accessed_at ? String(row.last_accessed_at) : null,
  };

  return { task, object };
}

export async function updateTaskState(
  db: D1Database,
  taskId: string,
  status: AnchorTaskRecord['status'],
  attempts: number,
  lastError: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE anchor_tasks
       SET status = ?1,
           attempts = ?2,
           last_error = ?3,
           updated_at = ?4
       WHERE id = ?5`,
    )
    .bind(status, attempts, lastError, new Date().toISOString(), taskId)
    .run();
}

export async function markObjectLocation(
  db: D1Database,
  objectId: string,
  input: {
    r2Key?: string | null;
    b2FileName?: string | null;
    ipfsCid?: string | null;
    ipfsGatewayUrl?: string | null;
    ipfsSizeBytes?: number | null;
    status?: string;
    lastError?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE anchor_objects
       SET r2_key = COALESCE(?1, r2_key),
           b2_file_name = COALESCE(?2, b2_file_name),
           ipfs_cid = COALESCE(?3, ipfs_cid),
           ipfs_gateway_url = COALESCE(?4, ipfs_gateway_url),
           ipfs_size_bytes = COALESCE(?5, ipfs_size_bytes),
           status = COALESCE(?6, status),
           last_error = ?7,
           updated_at = ?8
       WHERE id = ?9`,
    )
    .bind(
      input.r2Key ?? null,
      input.b2FileName ?? null,
      input.ipfsCid ?? null,
      input.ipfsGatewayUrl ?? null,
      input.ipfsSizeBytes ?? null,
      input.status ?? null,
      input.lastError ?? null,
      new Date().toISOString(),
      objectId,
    )
    .run();
}

export async function getIpfsUsedBytes(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(ipfs_size_bytes), 0) AS total FROM anchor_objects WHERE ipfs_cid IS NOT NULL')
    .first<{ total: number | string | null }>();
  if (!row || row.total === null || row.total === undefined) {
    return 0;
  }
  const value = Number(row.total);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export async function touchObjectAccess(db: D1Database, objectId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE anchor_objects
       SET last_accessed_at = ?1,
           updated_at = ?2
       WHERE id = ?3`,
    )
    .bind(now, now, objectId)
    .run();
}

export async function countPendingTasks(db: D1Database, objectId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM anchor_tasks
       WHERE object_id = ?1
         AND status IN ('queued', 'in_progress')`,
    )
    .bind(objectId)
    .first<{ count: number | string | null }>();
  if (!row || row.count === null || row.count === undefined) {
    return 0;
  }
  const value = Number(row.count);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
