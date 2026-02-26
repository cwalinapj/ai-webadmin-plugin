import { describe, expect, it } from 'vitest';
import { syncWorkerAfterAction } from '../src/integration/workerSync.js';
import type { AgentAction, ExecuteActionResult, SiteRecord } from '../src/types.js';

describe('worker sync', () => {
  it('skips when worker env is not configured', async () => {
    delete process.env.PANEL_WORKER_BASE_URL;
    delete process.env.PANEL_WORKER_SHARED_SECRET;
    delete process.env.PANEL_WORKER_CAP_UPTIME;

    const site: SiteRecord = {
      id: 'site-1',
      tenant_id: 'tenant-a',
      domain: 'example.com',
      panel_type: 'ai_vps_panel',
      runtime_type: 'php_generic',
      created_at: new Date().toISOString(),
    };
    const action: AgentAction = {
      id: 'action-1',
      type: 'check_service_status',
      description: 'Check nginx',
      risk: 'low',
      requires_confirmation: false,
      args: { service: 'nginx' },
    };
    const executeResult: ExecuteActionResult = {
      ok: true,
      dry_run: true,
    };

    const result = await syncWorkerAfterAction({
      site,
      action,
      executeResult,
    });

    expect(result.ok).toBe(true);
    expect((result.details as { skipped?: boolean })?.skipped).toBe(true);
  });
});
