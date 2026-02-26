import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAnchorRequest, processAnchorTask } from '../src/router';
import type { Env } from '../src/types';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../src/db/store', () => ({
  findAnchorObjectByKey: vi.fn(),
  findAnchorObjectById: vi.fn(),
  findTaskWithObjectById: vi.fn(),
  createAnchorObject: vi.fn(),
  createAnchorTask: vi.fn(),
  touchObjectAccess: vi.fn(),
  countPendingTasks: vi.fn(),
  getIpfsUsedBytes: vi.fn(),
  updateTaskState: vi.fn(),
  markObjectLocation: vi.fn(),
}));

vi.mock('../src/providers/r2', () => ({
  putToR2: vi.fn(),
  getFromR2: vi.fn(),
}));

vi.mock('../src/providers/b2', () => ({
  putToB2: vi.fn(),
  getFromB2: vi.fn(),
  isB2Configured: vi.fn(() => false),
}));

vi.mock('../src/providers/ipfs', () => ({
  pinToIpfs: vi.fn(),
  isIpfsConfigured: vi.fn(() => false),
}));

import * as store from '../src/db/store';
import * as r2 from '../src/providers/r2';
import * as ipfs from '../src/providers/ipfs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ANCHOR_API_TOKEN: 'test-token',
    ANCHOR_DB: {} as D1Database,
    ANCHOR_R2: {} as R2Bucket,
    ANCHOR_QUEUE: {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue,
    ...overrides,
  };
}

function makeRequest(
  method: string,
  path: string,
  body?: unknown,
  token?: string | null,
): Request {
  const url = `https://worker.example.com${path}`;
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (token !== null) {
    headers['authorization'] = token !== undefined ? `Bearer ${token}` : '';
  }
  return new Request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function base64(text: string): string {
  return btoa(text);
}

const VALID_STORE_BODY = {
  object_key: 'test/key.json',
  content_base64: base64('{"hello":"world"}'),
  content_type: 'application/json',
};

const MOCK_OBJECT_RECORD = {
  id: 'obj-1',
  object_key: 'test/key.json',
  content_type: 'application/json',
  size_bytes: 16,
  sha256: 'abc123',
  priority: 'standard' as const,
  retention_class: 'balanced' as const,
  primary_provider: 'r2' as const,
  status: 'stored_primary',
  r2_key: 'test/key.json',
  b2_file_name: null,
  ipfs_cid: null,
  ipfs_gateway_url: null,
  ipfs_size_bytes: null,
  metadata_json: null,
  last_error: null,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
  last_accessed_at: null,
};

// ---------------------------------------------------------------------------
// Authorization tests
// ---------------------------------------------------------------------------

describe('handleAnchorRequest – authorization', () => {
  let env: Env;

  beforeEach(() => {
    env = makeEnv();
    vi.mocked(store.getIpfsUsedBytes).mockResolvedValue(0);
    vi.mocked(store.findAnchorObjectByKey).mockResolvedValue(null);
    vi.mocked(store.createAnchorObject).mockResolvedValue(MOCK_OBJECT_RECORD);
    vi.mocked(store.createAnchorTask).mockResolvedValue({
      id: 'task-1',
      object_id: 'obj-1',
      target_provider: 'b2',
      action: 'replicate',
      status: 'queued',
      attempts: 0,
      last_error: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    });
    vi.mocked(store.markObjectLocation).mockResolvedValue(undefined);
    vi.mocked(r2.putToR2).mockResolvedValue({ key: 'test/key.json' });
    vi.mocked(ipfs.isIpfsConfigured).mockReturnValue(false);
  });

  it('returns 401 for missing Authorization header', async () => {
    const req = makeRequest('POST', '/anchor/store', VALID_STORE_BODY, null);
    const res = await handleAnchorRequest(req, env);
    expect(res.status).toBe(401);
    const body = await res.json<{ ok: boolean; error: string }>();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('unauthorized');
  });

  it('returns 401 for wrong token', async () => {
    const req = makeRequest('POST', '/anchor/store', VALID_STORE_BODY, 'wrong-token');
    const res = await handleAnchorRequest(req, env);
    expect(res.status).toBe(401);
  });

  it('returns 401 when ANCHOR_API_TOKEN env var is empty', async () => {
    const emptyEnv = makeEnv({ ANCHOR_API_TOKEN: '' });
    const req = makeRequest('POST', '/anchor/store', VALID_STORE_BODY, '');
    const res = await handleAnchorRequest(req, emptyEnv);
    expect(res.status).toBe(401);
  });

  it('allows request with correct token', async () => {
    const req = makeRequest('POST', '/anchor/store', VALID_STORE_BODY, 'test-token');
    const res = await handleAnchorRequest(req, env);
    // 201 = store succeeded; not a 401
    expect(res.status).not.toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /anchor/store – payload validation
// ---------------------------------------------------------------------------

describe('handleAnchorRequest – POST /anchor/store payload validation', () => {
  let env: Env;

  beforeEach(() => {
    env = makeEnv();
    vi.mocked(store.getIpfsUsedBytes).mockResolvedValue(0);
    vi.mocked(store.findAnchorObjectByKey).mockResolvedValue(null);
    vi.mocked(store.createAnchorObject).mockResolvedValue(MOCK_OBJECT_RECORD);
    vi.mocked(store.markObjectLocation).mockResolvedValue(undefined);
    vi.mocked(r2.putToR2).mockResolvedValue({ key: 'test/key.json' });
    vi.mocked(ipfs.isIpfsConfigured).mockReturnValue(false);
  });

  it('returns 400 when body is not JSON', async () => {
    const req = new Request('https://worker.example.com/anchor/store', {
      method: 'POST',
      headers: { 'authorization': 'Bearer test-token', 'content-type': 'application/json' },
      body: 'not json',
    });
    const res = await handleAnchorRequest(req, env);
    expect(res.status).toBe(400);
    const body = await res.json<{ ok: boolean; error: string }>();
    expect(body.ok).toBe(false);
  });

  it('returns 400 when object_key is missing', async () => {
    const req = makeRequest('POST', '/anchor/store', { content_base64: base64('hi') }, 'test-token');
    const res = await handleAnchorRequest(req, env);
    expect(res.status).toBe(400);
    const body = await res.json<{ ok: boolean; error: string }>();
    expect(body.error).toBe('missing_object_key_or_content');
  });

  it('returns 400 when content_base64 is missing', async () => {
    const req = makeRequest('POST', '/anchor/store', { object_key: 'some/key' }, 'test-token');
    const res = await handleAnchorRequest(req, env);
    expect(res.status).toBe(400);
    const body = await res.json<{ ok: boolean; error: string }>();
    expect(body.error).toBe('missing_object_key_or_content');
  });

  it('returns 400 for invalid base64 content', async () => {
    const req = makeRequest(
      'POST',
      '/anchor/store',
      { object_key: 'some/key', content_base64: '!!!not-valid-base64!!!' },
      'test-token',
    );
    const res = await handleAnchorRequest(req, env);
    expect(res.status).toBe(400);
    const body = await res.json<{ ok: boolean; error: string }>();
    expect(body.error).toBe('invalid_base64');
  });

  it('returns 413 when payload exceeds size limit', async () => {
    // Generate a base64 string whose decoded size exceeds 1 byte limit
    const bigContent = 'A'.repeat(200);
    const req = makeRequest(
      'POST',
      '/anchor/store',
      { object_key: 'some/key', content_base64: base64(bigContent) },
      'test-token',
    );
    const smallEnv = makeEnv({ MAX_INLINE_OBJECT_BYTES: '10' });
    vi.mocked(store.findAnchorObjectByKey).mockResolvedValue(null);
    const res = await handleAnchorRequest(req, smallEnv);
    expect(res.status).toBe(413);
    const body = await res.json<{ ok: boolean; error: string }>();
    expect(body.error).toBe('payload_too_large');
  });

  it('returns 201 for a valid store request', async () => {
    const req = makeRequest('POST', '/anchor/store', VALID_STORE_BODY, 'test-token');
    const res = await handleAnchorRequest(req, env);
    expect(res.status).toBe(201);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /anchor/store – object-key conflict
// ---------------------------------------------------------------------------

describe('handleAnchorRequest – object-key conflict', () => {
  it('returns 409 when object_key already exists', async () => {
    const env = makeEnv();
    vi.mocked(store.findAnchorObjectByKey).mockResolvedValue(MOCK_OBJECT_RECORD);

    const req = makeRequest('POST', '/anchor/store', VALID_STORE_BODY, 'test-token');
    const res = await handleAnchorRequest(req, env);
    expect(res.status).toBe(409);
    const body = await res.json<{ ok: boolean; error: string; object_id: string }>();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('object_key_exists');
    expect(body.object_id).toBe('obj-1');
  });
});

// ---------------------------------------------------------------------------
// GET /anchor/object
// ---------------------------------------------------------------------------

describe('handleAnchorRequest – GET /anchor/object', () => {
  let env: Env;

  beforeEach(() => {
    env = makeEnv();
    vi.mocked(store.touchObjectAccess).mockResolvedValue(undefined);
    vi.mocked(store.countPendingTasks).mockResolvedValue(0);
  });

  it('returns 404 when neither id nor key provided', async () => {
    const req = makeRequest('GET', '/anchor/object', undefined, 'test-token');
    const res = await handleAnchorRequest(req, env);
    expect(res.status).toBe(404);
  });

  it('returns 404 when object not found by id', async () => {
    vi.mocked(store.findAnchorObjectById).mockResolvedValue(null);
    const req = makeRequest('GET', '/anchor/object?id=missing-id', undefined, 'test-token');
    const res = await handleAnchorRequest(req, env);
    expect(res.status).toBe(404);
  });

  it('returns 200 with object when found by id', async () => {
    vi.mocked(store.findAnchorObjectById).mockResolvedValue(MOCK_OBJECT_RECORD);
    const req = makeRequest('GET', '/anchor/object?id=obj-1', undefined, 'test-token');
    const res = await handleAnchorRequest(req, env);
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean; object: { id: string } }>();
    expect(body.ok).toBe(true);
    expect(body.object.id).toBe('obj-1');
  });

  it('returns 200 with object when found by key', async () => {
    vi.mocked(store.findAnchorObjectByKey).mockResolvedValue(MOCK_OBJECT_RECORD);
    const req = makeRequest('GET', '/anchor/object?key=test%2Fkey.json', undefined, 'test-token');
    const res = await handleAnchorRequest(req, env);
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean; object: { object_key: string } }>();
    expect(body.ok).toBe(true);
    expect(body.object.object_key).toBe('test/key.json');
  });
});

// ---------------------------------------------------------------------------
// processAnchorTask – task retry and state transitions
// ---------------------------------------------------------------------------

describe('processAnchorTask – task retry / state changes', () => {
  let env: Env;

  interface TaskOverrides {
    status?: 'queued' | 'in_progress' | 'done' | 'failed';
    attempts?: number;
    target_provider?: 'r2' | 'b2' | 'ipfs';
  }

  const makeTaskEntry = (overrides: TaskOverrides = {}) => ({
    task: {
      id: 'task-1',
      object_id: 'obj-1',
      target_provider: 'r2' as const,
      action: 'replicate' as const,
      status: 'queued' as const,
      attempts: 0,
      last_error: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      ...overrides,
    },
    object: { ...MOCK_OBJECT_RECORD },
  });

  beforeEach(() => {
    env = makeEnv();
    vi.mocked(store.updateTaskState).mockResolvedValue(undefined);
    vi.mocked(store.markObjectLocation).mockResolvedValue(undefined);
    vi.mocked(store.countPendingTasks).mockResolvedValue(0);
  });

  it('does nothing when task is not found', async () => {
    vi.mocked(store.findTaskWithObjectById).mockResolvedValue(null);
    await processAnchorTask(env, 'nonexistent');
    expect(store.updateTaskState).not.toHaveBeenCalled();
  });

  it('does nothing when task is already done', async () => {
    vi.mocked(store.findTaskWithObjectById).mockResolvedValue(
      makeTaskEntry({ status: 'done' }) as any,
    );
    await processAnchorTask(env, 'task-1');
    expect(store.updateTaskState).not.toHaveBeenCalled();
  });

  it('marks task done and object ready on successful r2 replication', async () => {
    vi.mocked(store.findTaskWithObjectById).mockResolvedValue(makeTaskEntry() as any);
    vi.mocked(r2.getFromR2).mockResolvedValue(new ArrayBuffer(8));
    vi.mocked(r2.putToR2).mockResolvedValue({ key: 'test/key.json' });

    await processAnchorTask(env, 'task-1');

    expect(store.updateTaskState).toHaveBeenCalledWith(
      env.ANCHOR_DB, 'task-1', 'in_progress', 1, null,
    );
    expect(store.updateTaskState).toHaveBeenCalledWith(
      env.ANCHOR_DB, 'task-1', 'done', 1, null,
    );
    expect(store.markObjectLocation).toHaveBeenCalledWith(
      env.ANCHOR_DB,
      'obj-1',
      expect.objectContaining({ status: 'ready' }),
    );
  });

  it('queues retry on first failure (attempts < 3)', async () => {
    vi.mocked(store.findTaskWithObjectById).mockResolvedValue(makeTaskEntry() as any);
    vi.mocked(r2.getFromR2).mockRejectedValue(new Error('r2_error'));

    const sendMock = vi.fn().mockResolvedValue(undefined);
    env = makeEnv({ ANCHOR_QUEUE: { send: sendMock } as unknown as Queue });

    await processAnchorTask(env, 'task-1');

    // Should re-queue with delay
    expect(sendMock).toHaveBeenCalledWith({ taskId: 'task-1' }, { delaySeconds: 30 });
    // Should set status back to queued (retry)
    expect(store.updateTaskState).toHaveBeenCalledWith(
      env.ANCHOR_DB, 'task-1', 'queued', 1, expect.any(String),
    );
  });

  it('marks task failed after exhausting retries (attempt >= 3)', async () => {
    vi.mocked(store.findTaskWithObjectById).mockResolvedValue(
      makeTaskEntry({ attempts: 2 }) as any,
    );
    vi.mocked(r2.getFromR2).mockRejectedValue(new Error('persistent_error'));

    await processAnchorTask(env, 'task-1');

    expect(store.updateTaskState).toHaveBeenCalledWith(
      env.ANCHOR_DB, 'task-1', 'failed', 3, expect.any(String),
    );
    expect(store.markObjectLocation).toHaveBeenCalledWith(
      env.ANCHOR_DB,
      'obj-1',
      expect.objectContaining({ status: 'failed' }),
    );
    // Should NOT re-queue
    const queueSend = vi.mocked(env.ANCHOR_QUEUE.send);
    expect(queueSend).not.toHaveBeenCalled();
  });
});
