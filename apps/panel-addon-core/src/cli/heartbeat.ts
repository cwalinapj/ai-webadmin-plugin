import { PanelAddonClient } from '../client.js';
import { collectHeartbeatPayload } from '../collectors/heartbeat.js';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

async function main(): Promise<void> {
  const baseUrl = requiredEnv('PANEL_BASE_URL');
  const pluginId = requiredEnv('PANEL_PLUGIN_ID');
  const sharedSecret = requiredEnv('PANEL_SHARED_SECRET');
  const capUptime = requiredEnv('PANEL_CAP_UPTIME');
  const siteId = requiredEnv('PANEL_SITE_ID');
  const domain = requiredEnv('PANEL_DOMAIN');
  const siteUrl = process.env.PANEL_SITE_URL?.trim() || `https://${domain}`;

  const client = new PanelAddonClient({
    baseUrl,
    pluginId,
    sharedSecret,
    capabilityTokens: {
      uptime: capUptime,
      sandbox: process.env.PANEL_CAP_SANDBOX?.trim(),
      host_optimizer: process.env.PANEL_CAP_HOST_OPTIMIZER?.trim(),
    },
  });

  const payload = collectHeartbeatPayload({
    siteId,
    domain,
    siteUrl,
    plan: process.env.PANEL_PLAN?.trim() || 'vps',
    runtimeLabel: process.env.PANEL_RUNTIME_LABEL?.trim() || 'php_generic',
  });

  const result = await client.sendHeartbeat(payload);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`panel-addon heartbeat failed: ${message}\n`);
  process.exitCode = 1;
});
