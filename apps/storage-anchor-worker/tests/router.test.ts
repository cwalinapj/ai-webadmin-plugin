import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnchorObjectRecord, AnchorTaskWithObject } from '../src/db/store';
import { handleAnchorRequest, processAnchorTask } from '../src/router';
import type { Env } from '../src/types';

vi.mock('../src/db/store', () => ({
  countPendingTasks: vi.fn(),
  createAnchorObject: vi.fn(),
  createAnchorTask: vi.fn(),
  findAnchorObjectById: vi.fn(),
  findAnchorObjectByKey: vi.fn(),
  findTaskWithObjectById: vi.fn(),
  getIpfsUsedBytes: vi.fn(),
  markObjectLocation: vi.fn(),
  touchObjectAccess: vi.fn(),
  updateTaskState: vi.fn(),
}));

vi.mock('../src/policy', () => ({
  buildPlacementPlan: vi.fn(),
}));

vi.mock('../src/providers/r2', () => ({
  getFromR2: vi.fn(),
  putToR2: vi.fn(),
}));

vi.mock('../src/providers/b2', () => ({
  getFromB2: vi.fn(),
  putToB2: vi.fn(),
}));

vi.mock('../src/providers/ipfs', () => ({
  isIpfsConfigured: vi.fn(),
  pinToIpfs: vi.fn(),
}));

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
} from '../src/db/store';
import { buildPlacementPlan } from '../src/policy';
import { getFromR2, putToR2 } from '../src/providers/r2';
import { isIpfsConfigured } from '../src/providers/ipfs';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ANCHOR_DB: {} as D1Database,
    ANCHOR_R2: {} as R2Bucket,
    ANCHOR_API_TOKEN: 'test-secret',
    ANCHOR_QUEUE: { send: vi.fn() } as unknown as Queue,
    ...overrides,
  };
}

function makeStoreRequest(
  body: unknown,
  authToken?: string,
): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authToken !== undefined) {
    headers['authorization'] = `Bearer ${authToken}`;
  }
  return new Request('https://worker.example.com/anchor/store', {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const SAMPLE_OBJECT_RECORD: AnchorObjectRecord = {
  id: 'obj-1',
  object_key: 'file.txt',
  content_type: 'application/octet-stream',
  size_bytes: 5,
  sha256: 'abc123',
  priority: 'standard',
  retention_class: 'balanced',
  primary_provider: 'r2',
  status: 'ready',
  r2_key: 'file.txt',
  b2_file_name: null,
  ipfs_cid: null,
  ipfs_gateway_url: null,
  ipfs_size_bytes: null,
  metadata_json: null,
  last_error: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  last_accessed_at: null,
};

// ─── Authorization ────────────────────────────────────────────────────────────

describe('handleAnchorRequest – authorization', () => {
  it('returns 401 when no authorization header is provided', async () => {
    const res = await handleAnchorRequest(
      new Request('https://worker.example.com/anchor/store', { method: 'POST', body: '{}' }),
      makeEnv(),
    );
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('unauthorized');
  });

  it('returns 401 with wrong bearer token', async () => {
    const res = await handleAnchorRequest(makeStoreRequest({}, 'wrong-token'), makeEnv());
    expect(res.status).toBe(401);
  });

  it('returns 401 when ANCHOR_API_TOKEN is empty (prevents empty-token bypass)', async () => {
    const env = makeEnv({ ANCHOR_API_TOKEN: '' });
    const res = await handleAnchorRequest(makeStoreRequest({}, ''), env);
    expect(res.status).toBe(401);
  });

  it('returns 401 for GET /anchor/object without token', async () => {
    const res = await handleAnchorRequest(
      new Request('https://worker.example.com/anchor/object?id=obj-1'),
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });
});

// ─── Payload validation ───────────────────────────────────────────────────────

describe('handleAnchorRequest – /anchor/store payload validation', () => {
  let env: Env;

  beforeEach(() => {
    env = makeEnv();
    vi.mocked(findAnchorObjectByKey).mockResolvedValue(null);
    vi.mocked(getIpfsUsedBytes).mockResolvedValue(0);
    vi.mocked(isIpfsConfigured).mockReturnValue(false);
    vi.mocked(buildPlacementPlan).mockReturnValue({
      primary: 'r2',
      replicas: [],
      ipfsBackup: false,
      reason: 'test',
    });
    vi.mocked(createAnchorObject).mockResolvedValue(SAMPLE_OBJECT_RECORD);
    vi.mocked(countPendingTasks).mockResolvedValue(0);
    vi.mocked(markObjectLocation).mockResolvedValue(undefined);
    vi.mocked(putToR2).mockResolvedValue({ key: 'file.txt' });
  });

  it('returns 400 when body is not valid JSON', async () => {
    const req = new Request('https://worker.example.com/anchor/store', {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
      body: '{not-json',
    });
    const res = await handleAnchorRequest(req, env);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_json');
  });

  it('returns 400 when object_key is missing', async () => {
    const res = await handleAnchorRequest(
      makeStoreRequest({ content_base64: btoa('hello') }, 'test-secret'),
      env,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('missing_object_key_or_content');
  });

  it('returns 400 when content_base64 is missing', async () => {
    const res = await handleAnchorRequest(
      makeStoreRequest({ object_key: 'file.txt' }, 'test-secret'),
      env,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('missing_object_key_or_content');
  });

  it('returns 400 for invalid base64 content', async () => {
    const res = await handleAnchorRequest(
      makeStoreRequest({ object_key: 'file.txt', content_base64: '!!!not-base64!!!' }, 'test-secret'),
      env,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_base64');
  });

  it('returns 413 when payload exceeds max inline object size', async () => {
    // Decoded content slightly over the 5 MiB default limit (5 MiB + 1 byte).
    const overLimit = 'A'.repeat(5 * 1024 * 1024 + 1);
    const encoded = btoa(overLimit);
    const res = await handleAnchorRequest(
      makeStoreRequest({ object_key: 'large.bin', content_base64: encoded }, 'test-secret'),
      env,
    );
    expect(res.status).toBe(413);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('payload_too_large');
  });

  it('returns 409 when object_key already exists', async () => {
    vi.mocked(findAnchorObjectByKey).mockResolvedValue({ ...SAMPLE_OBJECT_RECORD, id: 'existing-obj' });
    const res = await handleAnchorRequest(
      makeStoreRequest({ object_key: 'file.txt', content_base64: btoa('hello') }, 'test-secret'),
      env,
    );
    expect(res.status).toBe(409);
    const body = await res.json() as { ok: boolean; error: string; object_id: string };
    expect(body.error).toBe('object_key_exists');
    expect(body.object_id).toBe('existing-obj');
  });

  it('returns 201 and stores object when request is valid', async () => {
    const res = await handleAnchorRequest(
      makeStoreRequest({ object_key: 'file.txt', content_base64: btoa('hello') }, 'test-secret'),
      env,
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { ok: boolean; status: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe('ready');
    expect(putToR2).toHaveBeenCalledOnce();
  });
});

// ─── /anchor/object ───────────────────────────────────────────────────────────

describe('handleAnchorRequest – GET /anchor/object', () => {
  let env: Env;

  beforeEach(() => {
    env = makeEnv();
    vi.mocked(touchObjectAccess).mockResolvedValue(undefined);
    vi.mocked(countPendingTasks).mockResolvedValue(0);
  });

  it('returns 404 when neither id nor key is provided', async () => {
    const res = await handleAnchorRequest(
      new Request('https://worker.example.com/anchor/object', {
        headers: { authorization: 'Bearer test-secret' },
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 when object is not found by id', async () => {
    vi.mocked(findAnchorObjectByKey).mockResolvedValue(null);
    const res = await handleAnchorRequest(
      new Request('https://worker.example.com/anchor/object?id=missing-id', {
        headers: { authorization: 'Bearer test-secret' },
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 with object data when found by key', async () => {
    vi.mocked(findAnchorObjectById).mockResolvedValue(SAMPLE_OBJECT_RECORD);
    const res = await handleAnchorRequest(
      new Request('https://worker.example.com/anchor/object?id=obj-1', {
        headers: { authorization: 'Bearer test-secret' },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; object: { id: string } };
    expect(body.ok).toBe(true);
    expect(body.object.id).toBe('obj-1');
  });
});

// ─── Queue task processing ────────────────────────────────────────────────────

describe('processAnchorTask – retry and state transitions', () => {
  let env: Env;

  beforeEach(() => {
    env = makeEnv();
    vi.mocked(markObjectLocation).mockResolvedValue(undefined);
    vi.mocked(updateTaskState).mockResolvedValue(undefined);
    vi.mocked(countPendingTasks).mockResolvedValue(0);
  });

  it('does nothing when task is already done', async () => {
    vi.mocked(findTaskWithObjectById).mockResolvedValue({
      task: { id: 't1', status: 'done', attempts: 1, target_provider: 'r2' },
      object: { ...SAMPLE_OBJECT_RECORD },
    } as AnchorTaskWithObject);

    await processAnchorTask(env, 't1');
    expect(updateTaskState).not.toHaveBeenCalled();
  });

  it('does nothing when task is not found', async () => {
    vi.mocked(findTaskWithObjectById).mockResolvedValue(null);
    await processAnchorTask(env, 'missing');
    expect(updateTaskState).not.toHaveBeenCalled();
  });

  it('requeues task with delay on provider failure when attempts < 3', async () => {
    vi.mocked(findTaskWithObjectById).mockResolvedValue({
      task: { id: 't1', status: 'queued', attempts: 1, target_provider: 'r2', object_id: 'o1', action: 'replicate', last_error: null, created_at: '', updated_at: '' },
      object: { ...SAMPLE_OBJECT_RECORD, id: 'o1', primary_provider: 'r2', r2_key: 'file.txt' },
    } as AnchorTaskWithObject);
    vi.mocked(getFromR2).mockRejectedValue(new Error('R2 unavailable'));

    const queueSend = vi.fn();
    env.ANCHOR_QUEUE = { send: queueSend } as unknown as Queue;

    await processAnchorTask(env, 't1');

    expect(updateTaskState).toHaveBeenCalledWith(
      env.ANCHOR_DB, 't1', 'queued', 2, expect.any(String),
    );
    expect(queueSend).toHaveBeenCalledWith({ taskId: 't1' }, expect.objectContaining({ delaySeconds: 60 }));
  });

  it('marks task as failed after third attempt', async () => {
    vi.mocked(findTaskWithObjectById).mockResolvedValue({
      task: { id: 't1', status: 'queued', attempts: 2, target_provider: 'r2', object_id: 'o1', action: 'replicate', last_error: null, created_at: '', updated_at: '' },
      object: { ...SAMPLE_OBJECT_RECORD, id: 'o1', primary_provider: 'r2', r2_key: 'file.txt' },
    } as AnchorTaskWithObject);
    vi.mocked(getFromR2).mockRejectedValue(new Error('R2 unavailable'));

    await processAnchorTask(env, 't1');

    expect(updateTaskState).toHaveBeenCalledWith(
      env.ANCHOR_DB, 't1', 'failed', 3, expect.any(String),
    );
    expect(markObjectLocation).toHaveBeenCalledWith(
      env.ANCHOR_DB, 'o1', expect.objectContaining({ status: 'failed' }),
    );
    expect((env.ANCHOR_QUEUE.send as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
