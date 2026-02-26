import { hmacSha256Hex } from './verifySignature';

export interface LegacySignatureEnv {
  WP_PLUGIN_SHARED_SECRET: string;
  REPLAY_WINDOW_SECONDS?: string;
}

export interface VerifyLegacyInput {
  request: Request;
  rawBody: ArrayBuffer;
  env: LegacySignatureEnv;
}

export interface VerifiedLegacyRequest {
  ok: true;
  timestamp: number;
}

export interface VerifyLegacyError {
  ok: false;
  status: number;
  error: string;
}

export async function verifyLegacySignedRequest(
  input: VerifyLegacyInput,
): Promise<VerifiedLegacyRequest | VerifyLegacyError> {
  const { request, rawBody, env } = input;
  const timestampRaw = request.headers.get('X-Plugin-Timestamp')?.trim() ?? '';
  const signature = (request.headers.get('X-Plugin-Signature')?.trim() ?? '').toLowerCase();

  const timestamp = Number.parseInt(timestampRaw, 10);
  if (!Number.isInteger(timestamp)) {
    return { ok: false, status: 401, error: 'invalid_timestamp' };
  }

  if (!/^[0-9a-f]{64}$/.test(signature)) {
    return { ok: false, status: 401, error: 'invalid_signature_format' };
  }

  if (!env.WP_PLUGIN_SHARED_SECRET) {
    return { ok: false, status: 500, error: 'worker_missing_shared_secret' };
  }

  const replayWindowSeconds = Number.parseInt(env.REPLAY_WINDOW_SECONDS ?? '300', 10);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > replayWindowSeconds) {
    return { ok: false, status: 401, error: 'timestamp_out_of_window' };
  }

  const body = new TextDecoder().decode(rawBody);
  const canonical = `${timestamp}.${body}`;
  const expected = (await hmacSha256Hex(env.WP_PLUGIN_SHARED_SECRET, canonical)).toLowerCase();

  if (!timingSafeEqual(signature, expected)) {
    return { ok: false, status: 401, error: 'signature_mismatch' };
  }

  return {
    ok: true,
    timestamp,
  };
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
