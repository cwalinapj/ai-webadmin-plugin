import type { BillingStatus } from '../types.js';

interface WorkerBillingSyncConfig {
  baseUrl: string;
  token: string;
  pluginPrefix: string;
}

export interface WorkerBillingSyncInput {
  site_id: string;
  plugin_id: string;
  plan_code: string;
  status: BillingStatus;
  sandbox_enabled: boolean;
  current_period_end: string | null;
  grace_period_end: string | null;
}

function readConfig(): WorkerBillingSyncConfig | null {
  const baseUrl = process.env.PANEL_WORKER_BASE_URL?.trim() || '';
  const token = process.env.PANEL_WORKER_BILLING_INTERNAL_TOKEN?.trim() || '';
  const pluginPrefix = process.env.PANEL_WORKER_PLUGIN_PREFIX?.trim() || 'ai-vps-panel';

  if (baseUrl === '' || token === '') {
    return null;
  }

  return {
    baseUrl,
    token,
    pluginPrefix,
  };
}

export function defaultPluginIdForSite(siteId: string): string {
  const prefix = process.env.PANEL_WORKER_PLUGIN_PREFIX?.trim() || 'ai-vps-panel';
  return `${prefix}:${siteId}`;
}

export async function syncBillingSubscriptionToWorker(
  input: WorkerBillingSyncInput,
): Promise<{ ok: boolean; skipped?: boolean; reason?: string; status?: number; body?: unknown; error?: string }> {
  const config = readConfig();
  if (!config) {
    return {
      ok: true,
      skipped: true,
      reason: 'worker_billing_sync_not_configured',
    };
  }

  const pluginId =
    input.plugin_id.trim() === ''
      ? `${config.pluginPrefix}:${input.site_id}`
      : input.plugin_id.trim();

  try {
    const response = await fetch(
      `${config.baseUrl.replace(/\/+$/, '')}/internal/billing/subscription/upsert`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          site_id: input.site_id,
          plugin_id: pluginId,
          plan_code: input.plan_code,
          status: input.status,
          sandbox_enabled: input.sandbox_enabled,
          current_period_end: input.current_period_end,
          grace_period_end: input.grace_period_end,
        }),
      },
    );

    const text = await response.text();
    let body: unknown = { raw: text };
    try {
      body = JSON.parse(text);
    } catch {
      // raw fallback
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        body,
        error: 'worker_billing_sync_failed',
      };
    }

    return {
      ok: true,
      status: response.status,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
