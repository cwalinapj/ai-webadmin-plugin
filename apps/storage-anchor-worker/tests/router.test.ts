import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAnchorRequest, processAnchorTask } from '../src/router';
import type { Env } from '../src/types';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

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

vi.mock('../src/providers/b2', () => ({
  getFromB2: vi.fn(),
  putToB2: vi.fn(),
}));

vi.mock('../src/providers/r2', () => ({
  getFromR2: vi.fn(),
  putToR2: vi.fn(),
}));

vi.mock('../src/providers/ipfs', () => ({
  isIpfsConfigured: vi.fn().mockReturnValue(false),
  pinToIpfs: vi.fn(),
}));

import * as store from '../src/db/store';
import * as b2 from '../src/providers/b2';
import * as r2 from '../src/providers/r2';
import * as ipfs from '../src/providers/ipfs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_TOKEN = 'test-token-abc';
const CONTENT_BASE64 = btoa('hello world'); // "aGVsbG8gd29ybGQ="

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ANCHOR_API_TOKEN: VALID_TOKEN,
    ANCHOR_DB: {} as Env['ANCHOR_DB'],
    ANCHOR_QUEUE: { send: vi.fn() } as unknown as Env['ANCHOR_QUEUE'],
    ANCHOR_R2: {} as Env['ANCHOR_R2'],
    ...overrides,
  };
}

function makeRequest(method: string, url: string, body?: unknown, token?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) {
    headers['authorization'] = `Bearer ${token}`;
  }
  return new Request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

type AnchorObjectRecord = NonNullable<Awaited<ReturnType<typeof store.findAnchorObjectByKey>>>;

function makeObjectRecord(overrides: Partial<AnchorObjectRecord> = {}) {
  return {
    id: 'obj-1',
    object_key: 'test/key.txt',
    content_type: 'text/plain',
    size_bytes: 11,
    sha256: 'abc',
    priority: 'standard' as const,
    retention_class: 'balanced' as const,
    primary_provider: 'r2' as const,
    status: 'ready',
    r2_key: 'test/key.txt',
    b2_file_name: null,
    ipfs_cid: null,
    ipfs_gateway_url: null,
    ipfs_size_bytes: null,
    metadata_json: null,
    last_error: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    last_accessed_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// /anchor/store - Authorization
// ---------------------------------------------------------------------------

describe('/anchor/store authorization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when Authorization header is missing', async () => {
    const req = makeRequest('POST', 'https://worker.example.com/anchor/store', {
      object_key: 'test/file.bin',
      content_base64: CONTENT_BASE64,
    });
    const res = await handleAnchorRequest(req, makeEnv());
    expect(res.status).toBe(401);
    const body = await res.json<{ ok: boolean; error: string }>();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('unauthorized');
  });

  it('returns 401 when Bearer token is wrong', async () => {
    const req = makeRequest(
      'POST',
      'https://worker.example.com/anchor/store',
      { object_key: 'test/file.bin', content_base64: CONTENT_BASE64 },
      'wrong-token',
    );
    const res = await handleAnchorRequest(req, makeEnv());
    expect(res.status).toBe(401);
  });

  it('returns 401 when ANCHOR_API_TOKEN env var is empty', async () => {
    const req = makeRequest(
      'POST',
      'https://worker.example.com/anchor/store',
      { object_key: 'test/file.bin', content_base64: CONTENT_BASE64 },
      '',
    );
    const env = makeEnv({ ANCHOR_API_TOKEN: '' });
    const res = await handleAnchorRequest(req, env);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// /anchor/store - Payload validation
// ---------------------------------------------------------------------------

describe('/anchor/store payload validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(store.findAnchorObjectByKey).mockResolvedValue(null);
    vi.mocked(store.getIpfsUsedBytes).mockResolvedValue(0);
    vi.mocked(r2.putToR2).mockResolvedValue({ key: 'test/key.txt' });
    vi.mocked(store.createAnchorObject).mockResolvedValue(makeObjectRecord());
    vi.mocked(store.countPendingTasks).mockResolvedValue(0);
    vi.mocked(store.markObjectLocation).mockResolvedValue(undefined);
  });

  it('returns 400 when body is not valid JSON', async () => {
    const req = new Request('https://worker.example.com/anchor/store', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${VALID_TOKEN}`,
      },
      body: 'not-json',
    });
    const res = await handleAnchorRequest(req, makeEnv());
    expect(res.status).toBe(400);
    const body = await res.json<{ ok: boolean; error: string }>();
    expect(body.ok).toBe(false);
  });

  it('returns 400 when object_key is missing', async () => {
    const req = makeRequest(
      'POST',
      'https://worker.example.com/anchor/store',
      { content_base64: CONTENT_BASE64 },
      VALID_TOKEN,
    );
    const res = await handleAnchorRequest(req, makeEnv());
    expect(res.status).toBe(400);
  });

  it('returns 400 when content_base64 is missing', async () => {
    const req = makeRequest(
      'POST',
      'https://worker.example.com/anchor/store',
      { object_key: 'test/file.bin' },
      VALID_TOKEN,
    );
    const res = await handleAnchorRequest(req, makeEnv());
    expect(res.status).toBe(400);
  });

  it('returns 400 when content_base64 is invalid base64', async () => {
    const req = makeRequest(
      'POST',
      'https://worker.example.com/anchor/store',
      { object_key: 'test/file.bin', content_base64: '!!!not-base64!!!' },
      VALID_TOKEN,
    );
    const res = await handleAnchorRequest(req, makeEnv());
    expect(res.status).toBe(400);
    const body = await res.json<{ ok: boolean; error: string }>();
    expect(body.error).toBe('invalid_base64');
  });

  it('returns 413 when payload exceeds MAX_INLINE_OBJECT_BYTES', async () => {
    // Set a 5-byte limit and send 6 bytes
    const sixBytes = btoa('\x00\x01\x02\x03\x04\x05');
    const req = makeRequest(
      'POST',
      'https://worker.example.com/anchor/store',
      { object_key: 'test/large.bin', content_base64: sixBytes },
      VALID_TOKEN,
    );
    const env = makeEnv({ MAX_INLINE_OBJECT_BYTES: '5' });
    const res = await handleAnchorRequest(req, env);
    expect(res.status).toBe(413);
    const body = await res.json<{ ok: boolean; error: string }>();
    expect(body.error).toBe('payload_too_large');
  });

  it('stores object successfully and returns 201', async () => {
    const req = makeRequest(
      'POST',
      'https://worker.example.com/anchor/store',
      { object_key: 'test/file.txt', content_base64: CONTENT_BASE64, content_type: 'text/plain' },
      VALID_TOKEN,
    );
    const res = await handleAnchorRequest(req, makeEnv());
    expect(res.status).toBe(201);
    const body = await res.json<{ ok: boolean; status: string }>();
    expect(body.ok).toBe(true);
    expect(body.status).toBe('ready');
  });
});

// ---------------------------------------------------------------------------
// /anchor/store - Object-key conflict
// ---------------------------------------------------------------------------

describe('/anchor/store object-key conflicts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 409 when object_key already exists', async () => {
    vi.mocked(store.findAnchorObjectByKey).mockResolvedValue(makeObjectRecord());

    const req = makeRequest(
      'POST',
      'https://worker.example.com/anchor/store',
      { object_key: 'test/key.txt', content_base64: CONTENT_BASE64 },
      VALID_TOKEN,
    );
    const res = await handleAnchorRequest(req, makeEnv());
    expect(res.status).toBe(409);
    const body = await res.json<{ ok: boolean; error: string; object_id: string }>();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('object_key_exists');
    expect(body.object_id).toBe('obj-1');
  });
});

// ---------------------------------------------------------------------------
// /anchor/object - Authorization and lookup
// ---------------------------------------------------------------------------

describe('/anchor/object', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without valid token', async () => {
    const req = makeRequest('GET', 'https://worker.example.com/anchor/object?id=obj-1');
    const res = await handleAnchorRequest(req, makeEnv());
    expect(res.status).toBe(401);
  });

  it('returns 404 when neither id nor key is provided', async () => {
    const req = makeRequest('GET', 'https://worker.example.com/anchor/object', undefined, VALID_TOKEN);
    vi.mocked(store.findAnchorObjectById).mockResolvedValue(null);
    vi.mocked(store.findAnchorObjectByKey).mockResolvedValue(null);
    const res = await handleAnchorRequest(req, makeEnv());
    expect(res.status).toBe(404);
    const body = await res.json<{ ok: boolean; error: string }>();
    expect(body.error).toBe('object_not_found');
  });

  it('returns 404 when object is not found by id', async () => {
    vi.mocked(store.findAnchorObjectById).mockResolvedValue(null);
    const req = makeRequest(
      'GET',
      'https://worker.example.com/anchor/object?id=missing-id',
      undefined,
      VALID_TOKEN,
    );
    const res = await handleAnchorRequest(req, makeEnv());
    expect(res.status).toBe(404);
  });

  it('returns 200 with object details when found by id', async () => {
    const record = makeObjectRecord();
    vi.mocked(store.findAnchorObjectById).mockResolvedValue(record);
    vi.mocked(store.touchObjectAccess).mockResolvedValue(undefined);
    vi.mocked(store.countPendingTasks).mockResolvedValue(0);

    const req = makeRequest(
      'GET',
      'https://worker.example.com/anchor/object?id=obj-1',
      undefined,
      VALID_TOKEN,
    );
    const res = await handleAnchorRequest(req, makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean; object: { id: string } }>();
    expect(body.ok).toBe(true);
    expect(body.object.id).toBe('obj-1');
  });

  it('returns 200 with object details when found by key', async () => {
    const record = makeObjectRecord();
    vi.mocked(store.findAnchorObjectByKey).mockResolvedValue(record);
    vi.mocked(store.touchObjectAccess).mockResolvedValue(undefined);
    vi.mocked(store.countPendingTasks).mockResolvedValue(2);

    const req = makeRequest(
      'GET',
      'https://worker.example.com/anchor/object?key=test%2Fkey.txt',
      undefined,
      VALID_TOKEN,
    );
    const res = await handleAnchorRequest(req, makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean; object: { id: string; pending_tasks: number } }>();
    expect(body.ok).toBe(true);
    expect(body.object.pending_tasks).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// processAnchorTask - State transitions and retry logic
// ---------------------------------------------------------------------------

describe('processAnchorTask', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeTask(overrides: Record<string, unknown> = {}) {
    return {
      id: 'task-1',
      object_id: 'obj-1',
      target_provider: 'r2' as const,
      action: 'replicate' as const,
      status: 'queued' as const,
      attempts: 0,
      last_error: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      ...overrides,
    };
  }

  it('does nothing when task is not found', async () => {
    vi.mocked(store.findTaskWithObjectById).mockResolvedValue(null);
    const env = makeEnv();
    await processAnchorTask(env, 'missing-task');
    expect(store.updateTaskState).not.toHaveBeenCalled();
  });

  it('does nothing when task is already done', async () => {
    vi.mocked(store.findTaskWithObjectById).mockResolvedValue({
      task: makeTask({ status: 'done' }),
      object: makeObjectRecord(),
    });
    const env = makeEnv();
    await processAnchorTask(env, 'task-1');
    expect(store.updateTaskState).not.toHaveBeenCalled();
  });

  it('marks task done and object ready when r2 replication succeeds', async () => {
    vi.mocked(store.findTaskWithObjectById).mockResolvedValue({
      task: makeTask({ target_provider: 'r2', attempts: 0 }),
      object: makeObjectRecord({ primary_provider: 'r2', r2_key: 'test/key.txt' }),
    });
    vi.mocked(r2.getFromR2).mockResolvedValue(new ArrayBuffer(11));
    vi.mocked(r2.putToR2).mockResolvedValue({ key: 'test/key.txt' });
    vi.mocked(store.updateTaskState).mockResolvedValue(undefined);
    vi.mocked(store.markObjectLocation).mockResolvedValue(undefined);
    vi.mocked(store.countPendingTasks).mockResolvedValue(0);

    await processAnchorTask(makeEnv(), 'task-1');

    expect(store.updateTaskState).toHaveBeenCalledWith(
      expect.anything(),
      'task-1',
      'done',
      1,
      null,
    );
    expect(store.markObjectLocation).toHaveBeenCalledWith(
      expect.anything(),
      'obj-1',
      expect.objectContaining({ status: 'ready' }),
    );
  });

  it('retries task (queues again) on first failure', async () => {
    vi.mocked(store.findTaskWithObjectById).mockResolvedValue({
      task: makeTask({ target_provider: 'r2', attempts: 0 }),
      object: makeObjectRecord({ primary_provider: 'r2', r2_key: 'test/key.txt' }),
    });
    vi.mocked(r2.getFromR2).mockRejectedValue(new Error('r2_unavailable'));
    vi.mocked(store.updateTaskState).mockResolvedValue(undefined);
    vi.mocked(store.markObjectLocation).mockResolvedValue(undefined);

    const queueSendMock = vi.fn();
    const env = makeEnv({ ANCHOR_QUEUE: { send: queueSendMock } as unknown as Env['ANCHOR_QUEUE'] });
    await processAnchorTask(env, 'task-1');

    // After attempt 1 (< 3), should be re-queued
    expect(store.updateTaskState).toHaveBeenCalledWith(
      expect.anything(),
      'task-1',
      'queued',
      1,
      expect.stringContaining('r2_unavailable'),
    );
    expect(queueSendMock).toHaveBeenCalledWith({ taskId: 'task-1' }, expect.objectContaining({ delaySeconds: 30 }));
  });

  it('marks task failed after max attempts exceeded', async () => {
    vi.mocked(store.findTaskWithObjectById).mockResolvedValue({
      task: makeTask({ target_provider: 'r2', attempts: 2 }), // attempt 3 will be the next
      object: makeObjectRecord({ primary_provider: 'r2', r2_key: 'test/key.txt' }),
    });
    vi.mocked(r2.getFromR2).mockRejectedValue(new Error('persistent_error'));
    vi.mocked(store.updateTaskState).mockResolvedValue(undefined);
    vi.mocked(store.markObjectLocation).mockResolvedValue(undefined);

    const queueSendMock = vi.fn();
    const env = makeEnv({ ANCHOR_QUEUE: { send: queueSendMock } as unknown as Env['ANCHOR_QUEUE'] });
    await processAnchorTask(env, 'task-1');

    // attempt 3 >= 3, so should be marked failed, not re-queued
    expect(store.updateTaskState).toHaveBeenCalledWith(
      expect.anything(),
      'task-1',
      'failed',
      3,
      expect.stringContaining('persistent_error'),
    );
    expect(store.markObjectLocation).toHaveBeenCalledWith(
      expect.anything(),
      'obj-1',
      expect.objectContaining({ status: 'failed' }),
    );
    expect(queueSendMock).not.toHaveBeenCalled();
  });
});
