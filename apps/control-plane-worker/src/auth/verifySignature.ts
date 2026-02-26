export interface SignatureEnv {
  WP_PLUGIN_SHARED_SECRET: string;
  CAP_TOKEN_UPTIME_WRITE: string;
  CAP_TOKEN_ANALYTICS_WRITE?: string;
  CAP_TOKEN_SANDBOX_WRITE?: string;
  CAP_TOKEN_HOST_OPTIMIZER_WRITE?: string;
  REPLAY_WINDOW_SECONDS?: string;
}

export interface VerifyInput {
  request: Request;
  rawBody: ArrayBuffer;
  path: string;
  env: SignatureEnv;
}

export interface VerifiedRequest {
  ok: true;
  pluginId: string;
  timestamp: number;
  nonce: string;
}

export interface VerifyError {
  ok: false;
  status: number;
  error: string;
}

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildCanonical(
  timestamp: number,
  nonce: string,
  method: string,
  path: string,
  bodySha256: string,
): string {
  return `${timestamp}.${nonce}.${method.toUpperCase()}.${path}.${bodySha256}`;
}

export async function sha256Hex(input: ArrayBuffer | Uint8Array | string): Promise<string> {
  const data =
    typeof input === 'string'
      ? toArrayBuffer(new TextEncoder().encode(input))
      : input instanceof ArrayBuffer
        ? input
        : toArrayBuffer(input);

  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const keyData = new TextEncoder().encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyData),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    toArrayBuffer(new TextEncoder().encode(message)),
  );
  return toHex(new Uint8Array(signature));
}

export async function verifySignedRequest(input: VerifyInput): Promise<VerifiedRequest | VerifyError> {
  const { request, rawBody, path, env } = input;

  const pluginId = request.headers.get('X-Plugin-Id')?.trim() ?? '';
  const timestampRaw = request.headers.get('X-Plugin-Timestamp')?.trim() ?? '';
  const nonce = request.headers.get('X-Plugin-Nonce')?.trim() ?? '';
  const signature = (request.headers.get('X-Plugin-Signature')?.trim() ?? '').toLowerCase();

  if (pluginId === '') {
    return { ok: false, status: 401, error: 'missing_plugin_id' };
  }

  const capabilityCheck = verifyCapabilityToken(path, request.headers.get('X-Capability-Token'), env);
  if (!capabilityCheck.ok) {
    return capabilityCheck;
  }

  const timestamp = Number.parseInt(timestampRaw, 10);
  if (!Number.isInteger(timestamp)) {
    return { ok: false, status: 401, error: 'invalid_timestamp' };
  }

  const replayWindowSeconds = Number.parseInt(env.REPLAY_WINDOW_SECONDS ?? '300', 10);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > replayWindowSeconds) {
    return { ok: false, status: 401, error: 'timestamp_out_of_window' };
  }

  if (!UUID_V4_REGEX.test(nonce)) {
    return { ok: false, status: 401, error: 'invalid_nonce' };
  }

  if (!/^[0-9a-f]{64}$/.test(signature)) {
    return { ok: false, status: 401, error: 'invalid_signature_format' };
  }

  if (!env.WP_PLUGIN_SHARED_SECRET) {
    return { ok: false, status: 500, error: 'worker_missing_shared_secret' };
  }

  const method = request.method.toUpperCase();
  const bodyHash = await sha256Hex(rawBody);
  const canonical = buildCanonical(timestamp, nonce, method, path, bodyHash);
  const expected = await hmacSha256Hex(env.WP_PLUGIN_SHARED_SECRET, canonical);

  if (!timingSafeEqual(signature, expected)) {
    return { ok: false, status: 401, error: 'signature_mismatch' };
  }

  return {
    ok: true,
    pluginId,
    timestamp,
    nonce,
  };
}

function verifyCapabilityToken(
  path: string,
  tokenHeader: string | null,
  env: SignatureEnv,
): { ok: true } | VerifyError {
  if (path === '/plugin/wp/watchdog/heartbeat' || path === '/plugin/site/watchdog/heartbeat') {
    if (!env.CAP_TOKEN_UPTIME_WRITE) {
      return { ok: false, status: 500, error: 'worker_missing_capability_token' };
    }
    const token = tokenHeader?.trim() ?? '';
    if (token === '') {
      return { ok: false, status: 403, error: 'missing_capability_token' };
    }
    if (!timingSafeEqual(token, env.CAP_TOKEN_UPTIME_WRITE)) {
      return { ok: false, status: 403, error: 'invalid_capability_token' };
    }
  }

  if (path.startsWith('/plugin/wp/sandbox/') || path.startsWith('/plugin/site/sandbox/')) {
    if (!env.CAP_TOKEN_SANDBOX_WRITE) {
      return { ok: false, status: 500, error: 'worker_missing_sandbox_capability_token' };
    }
    const token = tokenHeader?.trim() ?? '';
    if (token === '') {
      return { ok: false, status: 403, error: 'missing_capability_token' };
    }
    if (!timingSafeEqual(token, env.CAP_TOKEN_SANDBOX_WRITE)) {
      return { ok: false, status: 403, error: 'invalid_capability_token' };
    }
  }

  if (
    path === '/plugin/wp/host-optimizer/baseline' ||
    path === '/plugin/site/host-optimizer/baseline'
  ) {
    if (!env.CAP_TOKEN_HOST_OPTIMIZER_WRITE) {
      return { ok: false, status: 500, error: 'worker_missing_host_optimizer_capability_token' };
    }
    const token = tokenHeader?.trim() ?? '';
    if (token === '') {
      return { ok: false, status: 403, error: 'missing_capability_token' };
    }
    if (!timingSafeEqual(token, env.CAP_TOKEN_HOST_OPTIMIZER_WRITE)) {
      return { ok: false, status: 403, error: 'invalid_capability_token' };
    }
  }

  if (path.startsWith('/plugin/wp/analytics/') || path.startsWith('/plugin/site/analytics/')) {
    if (!env.CAP_TOKEN_ANALYTICS_WRITE) {
      return { ok: false, status: 500, error: 'worker_missing_analytics_capability_token' };
    }
    const token = tokenHeader?.trim() ?? '';
    if (token === '') {
      return { ok: false, status: 403, error: 'missing_capability_token' };
    }
    if (!timingSafeEqual(token, env.CAP_TOKEN_ANALYTICS_WRITE)) {
      return { ok: false, status: 403, error: 'invalid_capability_token' };
    }
  }

  return { ok: true };
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

function toHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}
