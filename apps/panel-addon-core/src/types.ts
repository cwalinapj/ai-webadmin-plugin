export type CapabilityScope = 'uptime' | 'sandbox' | 'host_optimizer';

export interface CapabilityTokenMap {
  uptime?: string;
  sandbox?: string;
  host_optimizer?: string;
}

export interface PanelAddonClientConfig {
  baseUrl: string;
  pluginId: string;
  sharedSecret: string;
  capabilityTokens: CapabilityTokenMap;
  requestTimeoutMs?: number;
}

export interface HeartbeatPayload {
  site_id: string;
  domain: string;
  plan?: string;
  timezone?: string;
  wp_version?: string;
  php_version?: string;
  theme?: string;
  active_plugins_count?: number;
  load_avg?: number[];
  traffic_rps?: number;
  error_counts?: Record<string, number>;
  site_url?: string;
}

export interface SignedRequest {
  body: string;
  canonicalPath: string;
  headers: Record<string, string>;
}

export interface ClientRequestResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}
