import {
  countPendingTasks,
  createAnchorObject,
  createAnchorTask,
  findAnchorObjectById,
  findAnchorObjectByKey,
  findTaskWithObjectById,
  getIpfsUsedBytes,
  markObjectLocation,
  touchObjectAccess,
  updateTaskState,
} from './db/store';
import { buildPlacementPlan } from './policy';
import { getFromB2, putToB2 } from './providers/b2';
import { getFromR2, putToR2 } from './providers/r2';
import { isIpfsConfigured, pinToIpfs } from './providers/ipfs';
import type { AnchorPriority, AnchorStoreRequest, Env, RetentionClass } from './types';

const MAX_METADATA_JSON_BYTES = 20_000;
const DEFAULT_MAX_INLINE_OBJECT_BYTES = 5 * 1024 * 1024;
const DEFAULT_IPFS_FREE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

export async function handleAnchorRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'GET' && url.pathname === '/anchor/health') {
    return json({
      ok: true,
      service: 'storage-anchor-worker',
      b2_configured: isB2Configured(env),
      ipfs_configured: isIpfsConfigured(env),
      now: new Date().toISOString(),
    });
  }

  if (request.method === 'POST' && url.pathname === '/anchor/store') {
    if (!isAuthorized(request, env)) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }
    return handleStore(request, env);
  }

  if (request.method === 'GET' && url.pathname === '/anchor/object') {
    if (!isAuthorized(request, env)) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }
    return handleGetObject(url, env);
  }

  return json({ ok: false, error: 'not_found' }, 404);
}

export async function processAnchorTask(env: Env, taskId: string): Promise<void> {
  const entry = await findTaskWithObjectById(env.ANCHOR_DB, taskId);
  if (!entry) {
    return;
  }

  const { task, object } = entry;
  if (task.status === 'done') {
    return;
  }

  const attempt = task.attempts + 1;
  await updateTaskState(env.ANCHOR_DB, task.id, 'in_progress', attempt, null);

  try {
    const bytes = await readPrimaryBytes(env, object.primary_provider, object.r2_key, object.b2_file_name);

    if (task.target_provider === 'r2') {
      const key = object.object_key;
      await putToR2(env, key, bytes, object.content_type);
      await markObjectLocation(env.ANCHOR_DB, object.id, {
        r2Key: key,
        status: 'replicated',
        lastError: null,
      });
    } else if (task.target_provider === 'b2') {
      const fileName = object.object_key;
      await putToB2(env, fileName, bytes, object.content_type);
      await markObjectLocation(env.ANCHOR_DB, object.id, {
        b2FileName: fileName,
        status: 'replicated',
        lastError: null,
      });
    } else if (task.target_provider === 'ipfs') {
      const result = await pinToIpfs(env, bytes, object.content_type);
      await markObjectLocation(env.ANCHOR_DB, object.id, {
        ipfsCid: result.cid,
        ipfsGatewayUrl: result.gatewayUrl,
        ipfsSizeBytes: object.size_bytes,
        status: 'replicated',
        lastError: null,
      });
    } else {
      throw new Error('unknown_target_provider');
    }

    await updateTaskState(env.ANCHOR_DB, task.id, 'done', attempt, null);

    const pending = await countPendingTasks(env.ANCHOR_DB, object.id);
    if (pending === 0) {
      await markObjectLocation(env.ANCHOR_DB, object.id, {
        status: 'ready',
        lastError: null,
      });
    }
  } catch (error) {
    const message = sanitizeError(error);
    const shouldRetry = attempt < 3;
    await updateTaskState(env.ANCHOR_DB, task.id, shouldRetry ? 'queued' : 'failed', attempt, message);
    await markObjectLocation(env.ANCHOR_DB, object.id, {
      status: shouldRetry ? 'stored_primary' : 'failed',
      lastError: message,
    });

    if (shouldRetry) {
      await env.ANCHOR_QUEUE.send({ taskId: task.id }, { delaySeconds: 30 * attempt });
    }
  }
}

async function handleStore(request: Request, env: Env): Promise<Response> {
  const payloadResult = await parseStoreRequest(request);
  if (!payloadResult.ok) {
    return json({ ok: false, error: payloadResult.error }, 400);
  }
  const payload = payloadResult.payload;

  const existing = await findAnchorObjectByKey(env.ANCHOR_DB, payload.object_key);
  if (existing) {
    return json(
      {
        ok: false,
        error: 'object_key_exists',
        object_id: existing.id,
      },
      409,
    );
  }

  const objectBytes = decodeBase64(payload.content_base64);
  if (!objectBytes.ok) {
    return json({ ok: false, error: objectBytes.error }, 400);
  }

  const maxBytes = parsePositiveInt(env.MAX_INLINE_OBJECT_BYTES, DEFAULT_MAX_INLINE_OBJECT_BYTES);
  if (objectBytes.bytes.byteLength > maxBytes) {
    return json({ ok: false, error: 'payload_too_large' }, 413);
  }

  const priority = normalizePriority(payload.priority);
  const retentionClass = normalizeRetentionClass(payload.retention_class);
  const ipfsUsed = await getIpfsUsedBytes(env.ANCHOR_DB);
  const ipfsQuota = parsePositiveInt(env.IPFS_FREE_QUOTA_BYTES, DEFAULT_IPFS_FREE_QUOTA_BYTES);

  const plan = buildPlacementPlan({
    priority,
    retentionClass,
    sizeBytes: objectBytes.bytes.byteLength,
    b2Configured: isB2Configured(env),
    ipfsConfigured: isIpfsConfigured(env),
    forceIpfsBackup: Boolean(payload.force_ipfs_backup),
    ipfsQuotaRemainingBytes: Math.max(0, ipfsQuota - ipfsUsed),
  });

  const contentType = payload.content_type?.trim() || 'application/octet-stream';
  const metadataJson = safeMetadataJson(payload.metadata);
  const objectKey = payload.object_key.trim();
  const payloadBuffer = toArrayBuffer(objectBytes.bytes);
  const sha256 = await sha256Hex(payloadBuffer);

  let r2Key: string | null = null;
  let b2FileName: string | null = null;

  if (plan.primary === 'r2') {
    await putToR2(env, objectKey, payloadBuffer, contentType);
    r2Key = objectKey;
  } else {
    await putToB2(env, objectKey, payloadBuffer, contentType);
    b2FileName = objectKey;
  }

  const objectRecord = await createAnchorObject(env.ANCHOR_DB, {
    objectKey,
    contentType,
    sizeBytes: objectBytes.bytes.byteLength,
    sha256,
    priority,
    retentionClass,
    primaryProvider: plan.primary,
    r2Key,
    b2FileName,
    metadataJson,
  });

  const queueTaskIds: string[] = [];
  for (const replicaProvider of plan.replicas) {
    const task = await createAnchorTask(env.ANCHOR_DB, objectRecord.id, replicaProvider, 'replicate');
    await env.ANCHOR_QUEUE.send({ taskId: task.id });
    queueTaskIds.push(task.id);
  }

  if (plan.ipfsBackup) {
    const task = await createAnchorTask(env.ANCHOR_DB, objectRecord.id, 'ipfs', 'backup_ipfs');
    await env.ANCHOR_QUEUE.send({ taskId: task.id });
    queueTaskIds.push(task.id);
  }

  if (queueTaskIds.length === 0) {
    await markObjectLocation(env.ANCHOR_DB, objectRecord.id, {
      status: 'ready',
      lastError: null,
    });
  }

  return json(
    {
      ok: true,
      object_id: objectRecord.id,
      object_key: objectRecord.object_key,
      content_type: objectRecord.content_type,
      size_bytes: objectRecord.size_bytes,
      sha256: objectRecord.sha256,
      placement: plan,
      task_count: queueTaskIds.length,
      task_ids: queueTaskIds,
      status: queueTaskIds.length === 0 ? 'ready' : 'stored_primary',
    },
    201,
  );
}

async function handleGetObject(url: URL, env: Env): Promise<Response> {
  const objectId = url.searchParams.get('id')?.trim() ?? '';
  const objectKey = url.searchParams.get('key')?.trim() ?? '';

  const object =
    objectId !== ''
      ? await findAnchorObjectById(env.ANCHOR_DB, objectId)
      : objectKey !== ''
        ? await findAnchorObjectByKey(env.ANCHOR_DB, objectKey)
        : null;
  if (!object) {
    return json({ ok: false, error: 'object_not_found' }, 404);
  }

  await touchObjectAccess(env.ANCHOR_DB, object.id);
  const pendingTasks = await countPendingTasks(env.ANCHOR_DB, object.id);

  return json(
    {
      ok: true,
      object: {
        id: object.id,
        object_key: object.object_key,
        content_type: object.content_type,
        size_bytes: object.size_bytes,
        sha256: object.sha256,
        priority: object.priority,
        retention_class: object.retention_class,
        primary_provider: object.primary_provider,
        status: object.status,
        r2_key: object.r2_key,
        b2_file_name: object.b2_file_name,
        ipfs_cid: object.ipfs_cid,
        ipfs_gateway_url: object.ipfs_gateway_url,
        last_error: object.last_error,
        created_at: object.created_at,
        updated_at: object.updated_at,
        pending_tasks: pendingTasks,
      },
    },
    200,
  );
}

function isAuthorized(request: Request, env: Env): boolean {
  const header = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${env.ANCHOR_API_TOKEN ?? ''}`;
  return timingSafeEqual(header.trim(), expected.trim()) && expected.trim() !== 'Bearer';
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function isB2Configured(env: Env): boolean {
  return Boolean(env.B2_KEY_ID && env.B2_APPLICATION_KEY && env.B2_BUCKET_ID && env.B2_BUCKET_NAME);
}

async function parseStoreRequest(
  request: Request,
): Promise<{ ok: true; payload: AnchorStoreRequest } | { ok: false; error: string }> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'invalid_payload' };
  }

  const payload = parsed as Record<string, unknown>;
  const objectKey = typeof payload.object_key === 'string' ? payload.object_key.trim() : '';
  const contentBase64 = typeof payload.content_base64 === 'string' ? payload.content_base64.trim() : '';
  if (objectKey === '' || contentBase64 === '') {
    return { ok: false, error: 'missing_object_key_or_content' };
  }

  return {
    ok: true,
    payload: {
      object_key: objectKey,
      content_base64: contentBase64,
      content_type: typeof payload.content_type === 'string' ? payload.content_type : undefined,
      priority: typeof payload.priority === 'string' ? (payload.priority as AnchorPriority) : undefined,
      retention_class:
        typeof payload.retention_class === 'string'
          ? (payload.retention_class as RetentionClass)
          : undefined,
      force_ipfs_backup: Boolean(payload.force_ipfs_backup),
      metadata:
        payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
          ? (payload.metadata as Record<string, unknown>)
          : undefined,
    },
  };
}

function normalizePriority(value: AnchorPriority | undefined): AnchorPriority {
  return value === 'high' ? 'high' : 'standard';
}

function normalizeRetentionClass(value: RetentionClass | undefined): RetentionClass {
  if (value === 'hot' || value === 'cold') {
    return value;
  }
  return 'balanced';
}

function safeMetadataJson(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) {
    return null;
  }
  const text = JSON.stringify(metadata);
  if (typeof text !== 'string') {
    return null;
  }
  if (text.length > MAX_METADATA_JSON_BYTES) {
    return text.slice(0, MAX_METADATA_JSON_BYTES);
  }
  return text;
}

function decodeBase64(value: string): { ok: true; bytes: Uint8Array } | { ok: false; error: string } {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return { ok: true, bytes };
  } catch {
    return { ok: false, error: 'invalid_base64' };
  }
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function readPrimaryBytes(
  env: Env,
  primaryProvider: string,
  r2Key: string | null,
  b2FileName: string | null,
): Promise<ArrayBuffer> {
  if (primaryProvider === 'r2') {
    if (!r2Key) {
      throw new Error('missing_r2_key');
    }
    return getFromR2(env, r2Key);
  }
  if (primaryProvider === 'b2') {
    if (!b2FileName) {
      throw new Error('missing_b2_file_name');
    }
    return getFromB2(env, b2FileName);
  }
  throw new Error('invalid_primary_provider');
}

function sanitizeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.trim().slice(0, 280);
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}
