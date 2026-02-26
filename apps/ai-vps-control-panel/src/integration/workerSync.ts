import { PanelAddonClient, collectHeartbeatPayload } from 'panel-addon-core';
import type { AgentAction, ExecuteActionResult, SiteRecord } from '../types.js';

interface WorkerConfig {
  baseUrl: string;
  sharedSecret: string;
  pluginPrefix: string;
  capUptime: string;
  capSandbox?: string;
  capHostOptimizer?: string;
}

function readConfig(): WorkerConfig | null {
  const baseUrl = process.env.PANEL_WORKER_BASE_URL?.trim() || '';
  const sharedSecret = process.env.PANEL_WORKER_SHARED_SECRET?.trim() || '';
  const capUptime = process.env.PANEL_WORKER_CAP_UPTIME?.trim() || '';

  if (baseUrl === '' || sharedSecret === '' || capUptime === '') {
    return null;
  }

  return {
    baseUrl,
    sharedSecret,
    capUptime,
    pluginPrefix: process.env.PANEL_WORKER_PLUGIN_PREFIX?.trim() || 'ai-vps-panel',
    capSandbox: process.env.PANEL_WORKER_CAP_SANDBOX?.trim(),
    capHostOptimizer: process.env.PANEL_WORKER_CAP_HOST_OPTIMIZER?.trim(),
  };
}

function toPriority(action: AgentAction): number {
  if (action.risk === 'high') {
    return 4;
  }
  if (action.risk === 'medium') {
    return 3;
  }
  return 2;
}

export async function syncWorkerAfterAction(input: {
  site: SiteRecord;
  action: AgentAction;
  executeResult: ExecuteActionResult;
}): Promise<{ ok: boolean; details?: unknown; error?: string }> {
  const config = readConfig();
  if (!config) {
    return {
      ok: true,
      details: {
        skipped: true,
        reason: 'worker_env_not_configured',
      },
    };
  }

  try {
    const pluginId = `${config.pluginPrefix}:${input.site.id}`;
    const client = new PanelAddonClient({
      baseUrl: config.baseUrl,
      pluginId,
      sharedSecret: config.sharedSecret,
      capabilityTokens: {
        uptime: config.capUptime,
        sandbox: config.capSandbox,
        host_optimizer: config.capHostOptimizer,
      },
    });

    const heartbeatPayload = collectHeartbeatPayload({
      siteId: input.site.id,
      domain: input.site.domain,
      runtimeLabel: input.site.runtime_type,
      plan: 'ai_vps_panel',
    });
    const heartbeat = await client.sendHeartbeat(heartbeatPayload);

    let sandbox: unknown = null;
    if (input.action.risk === 'medium' || input.action.risk === 'high') {
      sandbox = await client.createSandboxRequest({
        site_id: input.site.id,
        requested_by_agent: 'ai_chat_agent',
        task_type: input.action.type,
        priority_base: toPriority(input.action),
        estimated_minutes: input.action.risk === 'high' ? 30 : 15,
        context: {
          action_id: input.action.id,
          execute_ok: input.executeResult.ok,
          dry_run: input.executeResult.dry_run,
        },
      });
    }

    return {
      ok: heartbeat.ok,
      details: {
        heartbeat,
        sandbox,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
