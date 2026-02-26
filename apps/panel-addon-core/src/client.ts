import { capabilityTokenForScope, signJsonRequest } from './signer.js';
import type {
  CapabilityScope,
  ClientRequestResult,
  HeartbeatPayload,
  PanelAddonClientConfig,
} from './types.js';

function withTimeout(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof (timeout as NodeJS.Timeout).unref === 'function') {
    (timeout as NodeJS.Timeout).unref();
  }
  return controller.signal;
}

export class PanelAddonClient {
  private readonly config: PanelAddonClientConfig;

  constructor(config: PanelAddonClientConfig) {
    this.config = config;
  }

  async sendHeartbeat(payload: HeartbeatPayload): Promise<ClientRequestResult> {
    return this.post('/plugin/site/watchdog/heartbeat', 'uptime', payload);
  }

  async sendHostOptimizerBaseline(payload: Record<string, unknown>): Promise<ClientRequestResult> {
    return this.post('/plugin/site/host-optimizer/baseline', 'host_optimizer', payload);
  }

  async createSandboxRequest(payload: Record<string, unknown>): Promise<ClientRequestResult> {
    return this.post('/plugin/site/sandbox/request', 'sandbox', payload);
  }

  async voteSandboxRequest(payload: Record<string, unknown>): Promise<ClientRequestResult> {
    return this.post('/plugin/site/sandbox/vote', 'sandbox', payload);
  }

  async claimSandboxSlot(payload: Record<string, unknown>): Promise<ClientRequestResult> {
    return this.post('/plugin/site/sandbox/claim', 'sandbox', payload);
  }

  async releaseSandboxSlot(payload: Record<string, unknown>): Promise<ClientRequestResult> {
    return this.post('/plugin/site/sandbox/release', 'sandbox', payload);
  }

  async reportSandboxConflict(payload: Record<string, unknown>): Promise<ClientRequestResult> {
    return this.post('/plugin/site/sandbox/conflicts/report', 'sandbox', payload);
  }

  async listSandboxConflicts(payload: Record<string, unknown>): Promise<ClientRequestResult> {
    return this.post('/plugin/site/sandbox/conflicts/list', 'sandbox', payload);
  }

  async resolveSandboxConflict(payload: Record<string, unknown>): Promise<ClientRequestResult> {
    return this.post('/plugin/site/sandbox/conflicts/resolve', 'sandbox', payload);
  }

  private async post(
    path: string,
    capability: CapabilityScope,
    payload: unknown,
  ): Promise<ClientRequestResult> {
    const capabilityToken = capabilityTokenForScope(capability, this.config.capabilityTokens);
    const signed = await signJsonRequest({
      pluginId: this.config.pluginId,
      sharedSecret: this.config.sharedSecret,
      method: 'POST',
      path,
      payload,
      capabilityToken,
    });

    const requestTimeoutMs = this.config.requestTimeoutMs ?? 12_000;
    const response = await fetch(new URL(signed.canonicalPath, this.config.baseUrl), {
      method: 'POST',
      headers: signed.headers,
      body: signed.body,
      signal: withTimeout(requestTimeoutMs),
    });

    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  }
}
