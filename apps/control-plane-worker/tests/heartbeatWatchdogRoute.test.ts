import { describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../src/routes';
import type { Env } from '../src/types';

const { runWatchdogLbAutomation, upsertSite } = vi.hoisted(() => ({
  runWatchdogLbAutomation: vi.fn(async () => ({
    enabled: true,
    dry_run: true,
    attempted: true,
    status: 'success',
    action: 'enable',
    observed_rps: 210,
    reason: 'executed',
    panel_status: 200,
  })),
  upsertSite: vi.fn(async () => undefined),
}));

vi.mock('../src/auth/verifySignature', () => ({
  verifySignedRequest: vi.fn(async () => ({
    ok: true,
    pluginId: 'plugin-watchdog-1',
    nonce: crypto.randomUUID(),
    timestamp: Math.floor(Date.now() / 1000),
  })),
}));

vi.mock('../src/auth/replay', () => ({
  consumeNonce: vi.fn(async () => ({ ok: true })),
  consumeIdempotencyKey: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../src/durable/withSiteLock', () => ({
  withSiteLock: vi.fn(async (_namespace: unknown, _siteId: string, run: () => Promise<unknown>) => run()),
}));

vi.mock('../src/policy/heartbeat', () => ({
  shouldCreateHeartbeatJob: vi.fn(() => false),
  heartbeatRiskScore: vi.fn(() => 0),
}));

vi.mock('../src/sites/upsertSite', () => ({
  upsertSite,
}));

vi.mock('../src/automation/watchdogLbAutomation', () => ({
  runWatchdogLbAutomation,
}));

function baseEnv(): Env {
  return {
    DB: {} as D1Database,
    JOB_QUEUE: {} as Queue,
    JOB_DLQ: {} as Queue,
    SITE_LOCK: {} as DurableObjectNamespace,
    WP_PLUGIN_SHARED_SECRET: 'secret',
    CAP_TOKEN_UPTIME_WRITE: 'cap-up',
    REPLAY_WINDOW_SECONDS: '300',
  };
}

describe('heartbeat route watchdog automation', () => {
  it('triggers watchdog automation from heartbeat after signed auth passes', async () => {
    upsertSite.mockClear();
    runWatchdogLbAutomation.mockClear();

    const request = new Request('https://api.example.com/plugin/wp/watchdog/heartbeat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'idem-heartbeat-watchdog',
      },
      body: JSON.stringify({
        site_id: 'site-1',
        domain: 'example.com',
        load_avg: [3.5, 2.1, 1.4],
        traffic_rps: 210,
      }),
    });

    const response = await handleRequest(request, baseEnv());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(upsertSite).toHaveBeenCalledTimes(1);
    expect(runWatchdogLbAutomation).toHaveBeenCalledTimes(1);
    expect(runWatchdogLbAutomation).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        pluginId: 'plugin-watchdog-1',
      }),
    );

    const automation = body.automation as Record<string, unknown>;
    expect(automation.action).toBe('enable');
    expect(automation.status).toBe('success');
  });
});
