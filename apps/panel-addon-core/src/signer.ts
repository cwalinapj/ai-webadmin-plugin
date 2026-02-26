import { buildCanonical, hmacSha256Hex, sha256Hex } from './crypto.js';
import type { CapabilityScope, SignedRequest } from './types.js';

export interface SignJsonRequestInput {
  pluginId: string;
  sharedSecret: string;
  method: string;
  path: string;
  payload: unknown;
  capabilityToken?: string;
  idempotencyKey?: string;
}

function normalizePath(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return new URL(path).pathname;
  }
  return path.startsWith('/') ? path : `/${path}`;
}

export function capabilityTokenForScope(
  scope: CapabilityScope,
  tokens: { uptime?: string; sandbox?: string; host_optimizer?: string },
): string | undefined {
  if (scope === 'uptime') {
    return tokens.uptime;
  }
  if (scope === 'sandbox') {
    return tokens.sandbox;
  }
  return tokens.host_optimizer;
}

export async function signJsonRequest(input: SignJsonRequestInput): Promise<SignedRequest> {
  const canonicalPath = normalizePath(input.path);
  const body = JSON.stringify(input.payload ?? {});
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const bodyHash = await sha256Hex(body);
  const canonical = buildCanonical(timestamp, nonce, input.method, canonicalPath, bodyHash);
  const signature = await hmacSha256Hex(input.sharedSecret, canonical);
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Plugin-Id': input.pluginId,
    'X-Plugin-Timestamp': String(timestamp),
    'X-Plugin-Nonce': nonce,
    'X-Plugin-Signature': signature,
    'Idempotency-Key': idempotencyKey,
  };

  if (input.capabilityToken) {
    headers['X-Capability-Token'] = input.capabilityToken;
  }

  return {
    body,
    canonicalPath,
    headers,
  };
}
