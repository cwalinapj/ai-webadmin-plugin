import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types';

const { cleanupReplayArtifacts } = vi.hoisted(() => ({
  cleanupReplayArtifacts: vi.fn(async () => undefined),
}));

vi.mock('../src/auth/replay', () => ({
  cleanupReplayArtifacts,
}));

// Import after mock setup
const { default: worker } = await import('../src/index');

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    JOB_QUEUE: {} as Queue,
    JOB_DLQ: {} as Queue,
    SITE_LOCK: {} as DurableObjectNamespace,
    WP_PLUGIN_SHARED_SECRET: 'secret',
    CAP_TOKEN_UPTIME_WRITE: 'cap-up',
    REPLAY_WINDOW_SECONDS: '300',
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost/oauth/callback',
    ...overrides,
  };
}

describe('scheduled handler', () => {
  it('calls cleanupReplayArtifacts with parsed REPLAY_RETENTION_SECONDS', async () => {
    cleanupReplayArtifacts.mockClear();
    const env = baseEnv({ REPLAY_RETENTION_SECONDS: '7200' } as Env);

    await worker.scheduled({} as ScheduledController, env, {} as ExecutionContext);

    expect(cleanupReplayArtifacts).toHaveBeenCalledTimes(1);
    expect(cleanupReplayArtifacts).toHaveBeenCalledWith(env.DB, { retentionSeconds: 7200 });
  });

  it('falls back to default 86400 seconds when REPLAY_RETENTION_SECONDS is missing', async () => {
    cleanupReplayArtifacts.mockClear();
    const env = baseEnv();
    // Remove REPLAY_RETENTION_SECONDS by not setting it
    delete (env as Record<string, unknown>).REPLAY_RETENTION_SECONDS;

    await worker.scheduled({} as ScheduledController, env, {} as ExecutionContext);

    expect(cleanupReplayArtifacts).toHaveBeenCalledWith(env.DB, { retentionSeconds: 86400 });
  });

  it('falls back to default 86400 seconds when REPLAY_RETENTION_SECONDS is invalid', async () => {
    cleanupReplayArtifacts.mockClear();
    const env = baseEnv({ REPLAY_RETENTION_SECONDS: 'not-a-number' } as unknown as Env);

    await worker.scheduled({} as ScheduledController, env, {} as ExecutionContext);

    expect(cleanupReplayArtifacts).toHaveBeenCalledWith(env.DB, { retentionSeconds: 86400 });
  });

  it('accepts numeric REPLAY_RETENTION_SECONDS and floors it', async () => {
    cleanupReplayArtifacts.mockClear();
    const env = baseEnv({ REPLAY_RETENTION_SECONDS: 3600.9 } as unknown as Env);

    await worker.scheduled({} as ScheduledController, env, {} as ExecutionContext);

    expect(cleanupReplayArtifacts).toHaveBeenCalledWith(env.DB, { retentionSeconds: 3600 });
  });
});
