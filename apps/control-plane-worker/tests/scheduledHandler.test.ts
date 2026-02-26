import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/types';

const { cleanupReplayArtifacts } = vi.hoisted(() => ({
  cleanupReplayArtifacts: vi.fn(async () => undefined),
}));

vi.mock('../src/auth/replay', () => ({
  cleanupReplayArtifacts,
}));

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    JOB_QUEUE: {} as Queue,
    JOB_DLQ: {} as Queue,
    SITE_LOCK: {} as DurableObjectNamespace,
    WP_PLUGIN_SHARED_SECRET: 'secret',
    CAP_TOKEN_UPTIME_WRITE: 'cap-up',
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost/callback',
    ...overrides,
  };
}

const fakeController = {} as ScheduledController;
const fakeCtx = {} as ExecutionContext;

describe('scheduled handler', () => {
  it('calls cleanupReplayArtifacts with parsed REPLAY_RETENTION_SECONDS', async () => {
    cleanupReplayArtifacts.mockClear();
    const env = baseEnv({ REPLAY_RETENTION_SECONDS: '7200' });

    await worker.scheduled(fakeController, env, fakeCtx);

    expect(cleanupReplayArtifacts).toHaveBeenCalledOnce();
    expect(cleanupReplayArtifacts).toHaveBeenCalledWith(env.DB, { retentionSeconds: 7200 });
  });

  it('falls back to 86400 when REPLAY_RETENTION_SECONDS is missing', async () => {
    cleanupReplayArtifacts.mockClear();
    const env = baseEnv();

    await worker.scheduled(fakeController, env, fakeCtx);

    expect(cleanupReplayArtifacts).toHaveBeenCalledOnce();
    expect(cleanupReplayArtifacts).toHaveBeenCalledWith(env.DB, { retentionSeconds: 86400 });
  });

  it('falls back to 86400 when REPLAY_RETENTION_SECONDS is not a valid integer', async () => {
    cleanupReplayArtifacts.mockClear();
    const env = baseEnv({ REPLAY_RETENTION_SECONDS: 'not-a-number' });

    await worker.scheduled(fakeController, env, fakeCtx);

    expect(cleanupReplayArtifacts).toHaveBeenCalledOnce();
    expect(cleanupReplayArtifacts).toHaveBeenCalledWith(env.DB, { retentionSeconds: 86400 });
  });

  it('falls back to 86400 when REPLAY_RETENTION_SECONDS is an empty string', async () => {
    cleanupReplayArtifacts.mockClear();
    const env = baseEnv({ REPLAY_RETENTION_SECONDS: '' });

    await worker.scheduled(fakeController, env, fakeCtx);

    expect(cleanupReplayArtifacts).toHaveBeenCalledOnce();
    expect(cleanupReplayArtifacts).toHaveBeenCalledWith(env.DB, { retentionSeconds: 86400 });
  });

  it('truncates a float REPLAY_RETENTION_SECONDS to integer', async () => {
    cleanupReplayArtifacts.mockClear();
    const env = baseEnv({ REPLAY_RETENTION_SECONDS: '3600.9' });

    await worker.scheduled(fakeController, env, fakeCtx);

    expect(cleanupReplayArtifacts).toHaveBeenCalledWith(env.DB, { retentionSeconds: 3600 });
  });
});
