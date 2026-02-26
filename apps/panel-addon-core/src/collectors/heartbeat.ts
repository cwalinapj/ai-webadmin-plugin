import os from 'node:os';
import type { HeartbeatPayload } from '../types.js';

export interface HeartbeatCollectorInput {
  siteId: string;
  domain: string;
  siteUrl?: string;
  timezone?: string;
  plan?: string;
  phpVersion?: string;
  runtimeLabel?: string;
}

export function collectHeartbeatPayload(input: HeartbeatCollectorInput): HeartbeatPayload {
  const loadAvg = os.loadavg().map((value) => Number(value.toFixed(4)));

  return {
    site_id: input.siteId,
    domain: input.domain,
    site_url: input.siteUrl ?? `https://${input.domain}`,
    timezone: input.timezone ?? 'UTC',
    plan: input.plan ?? 'vps',
    wp_version: input.runtimeLabel ?? 'non_wp_runtime',
    php_version: input.phpVersion ?? process.version,
    active_plugins_count: 0,
    load_avg: loadAvg,
    error_counts: {},
  };
}
