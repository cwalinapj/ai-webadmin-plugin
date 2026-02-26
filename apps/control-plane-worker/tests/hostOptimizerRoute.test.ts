import { describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../src/routes';

const { createHostOptimizerBaseline } = vi.hoisted(() => ({
  createHostOptimizerBaseline: vi.fn(
    async (
      _db: unknown,
      input: {
        pluginId: string;
        siteUrl: string;
        providerName: string;
        regionLabel: string;
        virtualizationOs: string;
        cpuModel: string;
        cpuYear: string;
        ramGb: string;
        memoryClass: string;
        webserverType: string;
        storageType: string;
        uplinkMbps: string;
        gpuAccelerationMode: string;
        gpuModel: string;
        gpuCount: string;
        gpuVramGb: string;
        reason: string;
        capturedAt: string;
        homeTtfbMs: number | null;
        restTtfbMs: number | null;
        cpuOpsPerSec: number | null;
        diskWriteMbPerSec: number | null;
        diskReadMbPerSec: number | null;
        memoryPressureScore: number | null;
        payloadJson: string;
      },
    ) => ({
      id: 'baseline-1',
      plugin_id: input.pluginId,
      site_url: input.siteUrl,
      provider_name: input.providerName,
      region_label: input.regionLabel,
      virtualization_os: input.virtualizationOs,
      cpu_model: input.cpuModel,
      cpu_year: input.cpuYear,
      ram_gb: input.ramGb,
      memory_class: input.memoryClass,
      webserver_type: input.webserverType,
      storage_type: input.storageType,
      uplink_mbps: input.uplinkMbps,
      gpu_acceleration_mode: input.gpuAccelerationMode,
      gpu_model: input.gpuModel,
      gpu_count: input.gpuCount,
      gpu_vram_gb: input.gpuVramGb,
      reason: input.reason,
      captured_at: input.capturedAt,
      ingested_at: '2026-02-26T00:00:05.000Z',
      home_ttfb_ms: input.homeTtfbMs,
      rest_ttfb_ms: input.restTtfbMs,
      cpu_ops_per_sec: input.cpuOpsPerSec,
      disk_write_mb_per_sec: input.diskWriteMbPerSec,
      disk_read_mb_per_sec: input.diskReadMbPerSec,
      memory_pressure_score: input.memoryPressureScore,
      payload_json: input.payloadJson,
    }),
  ),
}));

vi.mock('../src/auth/verifySignature', () => ({
  verifySignedRequest: vi.fn(async () => ({
    ok: true,
    pluginId: 'plugin-host-1',
    nonce: crypto.randomUUID(),
    timestamp: Math.floor(Date.now() / 1000),
  })),
}));

vi.mock('../src/auth/replay', () => ({
  consumeNonce: vi.fn(async () => ({ ok: true })),
  consumeIdempotencyKey: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../src/hostOptimizer/store', () => ({
  createHostOptimizerBaseline,
}));

describe('host optimizer route', () => {
  it('ingests baseline payload and returns baseline id', async () => {
    createHostOptimizerBaseline.mockClear();

    const request = new Request('https://api.example.com/plugin/wp/host-optimizer/baseline', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'idem-1',
      },
      body: JSON.stringify({
        captured_at: '2026-02-26T00:00:00.000Z',
        site_url: 'https://example.com/',
        reason: 'scheduled',
        profile: {
          provider_name: 'Fleet A',
          region_label: 'North America / West Coast / Los Angeles',
          virtualization_os: 'proxmox',
          cpu_model: 'EPYC',
          cpu_year: '2023',
          ram_gb: '64',
          memory_class: 'ECC_DDR5',
          webserver_type: 'nginx_php_fpm',
          storage_type: 'nvme',
          uplink_mbps: '10000',
          gpu_acceleration_mode: 'cuda',
          gpu_model: 'NVIDIA A10',
          gpu_count: '1',
          gpu_vram_gb: '24',
        },
        metrics: {
          home_ttfb: { ms: 134.2 },
          rest_ttfb: { ms: 112.5 },
          cpu_benchmark: { ops_per_sec: 224455 },
          disk_benchmark: { write_mb_per_sec: 1880.1, read_mb_per_sec: 2210.4 },
          memory: { pressure_score: 41.2 },
        },
      }),
    });

    const response = await handleRequest(request, {
      DB: {} as D1Database,
      JOB_QUEUE: {} as Queue,
      JOB_DLQ: {} as Queue,
      SITE_LOCK: {} as DurableObjectNamespace,
      WP_PLUGIN_SHARED_SECRET: 'secret',
      CAP_TOKEN_UPTIME_WRITE: 'cap-up',
      CAP_TOKEN_SANDBOX_WRITE: 'cap-sandbox',
      CAP_TOKEN_HOST_OPTIMIZER_WRITE: 'cap-host',
      REPLAY_WINDOW_SECONDS: '300',
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost/oauth/callback',
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.baseline_id).toBe('baseline-1');
    expect(body.plugin_id).toBe('plugin-host-1');
    expect(createHostOptimizerBaseline).toHaveBeenCalledTimes(1);
  });

  it('rejects non-json payload', async () => {
    const request = new Request('https://api.example.com/plugin/wp/host-optimizer/baseline', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'idem-2',
      },
      body: '{bad',
    });

    const response = await handleRequest(request, {
      DB: {} as D1Database,
      JOB_QUEUE: {} as Queue,
      JOB_DLQ: {} as Queue,
      SITE_LOCK: {} as DurableObjectNamespace,
      WP_PLUGIN_SHARED_SECRET: 'secret',
      CAP_TOKEN_UPTIME_WRITE: 'cap-up',
      CAP_TOKEN_SANDBOX_WRITE: 'cap-sandbox',
      CAP_TOKEN_HOST_OPTIMIZER_WRITE: 'cap-host',
      REPLAY_WINDOW_SECONDS: '300',
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost/oauth/callback',
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('invalid_json');
  });

  it('accepts site route alias for baseline ingestion', async () => {
    createHostOptimizerBaseline.mockClear();

    const request = new Request('https://api.example.com/plugin/site/host-optimizer/baseline', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'idem-3',
      },
      body: JSON.stringify({
        site_url: 'https://alias.example.com/',
        profile: {
          provider_name: 'Fleet B',
          region_label: 'us-west',
          memory_class: 'ECC_DDR4',
          webserver_type: 'apache_event',
          gpu_acceleration_mode: 'none',
        },
        metrics: { memory: { pressure_score: 9.4 } },
      }),
    });

    const response = await handleRequest(request, {
      DB: {} as D1Database,
      JOB_QUEUE: {} as Queue,
      JOB_DLQ: {} as Queue,
      SITE_LOCK: {} as DurableObjectNamespace,
      WP_PLUGIN_SHARED_SECRET: 'secret',
      CAP_TOKEN_UPTIME_WRITE: 'cap-up',
      CAP_TOKEN_SANDBOX_WRITE: 'cap-sandbox',
      CAP_TOKEN_HOST_OPTIMIZER_WRITE: 'cap-host',
      REPLAY_WINDOW_SECONDS: '300',
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost/oauth/callback',
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(createHostOptimizerBaseline).toHaveBeenCalledTimes(1);
  });
});
