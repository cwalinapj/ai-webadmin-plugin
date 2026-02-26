import type { Env } from '../types';

interface B2AuthState {
  apiUrl: string;
  downloadUrl: string;
  authorizationToken: string;
  expiresAtMs: number;
}

interface B2UploadState {
  uploadUrl: string;
  authorizationToken: string;
  expiresAtMs: number;
}

let b2AuthCache: B2AuthState | null = null;
let b2UploadCache: B2UploadState | null = null;

function assertB2Configured(env: Env): asserts env is Env & {
  B2_KEY_ID: string;
  B2_APPLICATION_KEY: string;
  B2_BUCKET_ID: string;
  B2_BUCKET_NAME: string;
} {
  if (
    !env.B2_KEY_ID ||
    !env.B2_APPLICATION_KEY ||
    !env.B2_BUCKET_ID ||
    !env.B2_BUCKET_NAME
  ) {
    throw new Error('b2_not_configured');
  }
}

function normalizeB2FileName(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

async function authorizeB2(env: Env): Promise<B2AuthState> {
  assertB2Configured(env);
  const now = Date.now();
  if (b2AuthCache && b2AuthCache.expiresAtMs > now + 60_000) {
    return b2AuthCache;
  }

  const authUrl = env.B2_ACCOUNT_AUTH_URL ?? 'https://api.backblazeb2.com/b2api/v2/b2_authorize_account';
  const basic = btoa(`${env.B2_KEY_ID}:${env.B2_APPLICATION_KEY}`);
  const response = await fetch(authUrl, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${basic}`,
    },
  });

  if (!response.ok) {
    throw new Error(`b2_auth_failed_${response.status}`);
  }

  const payload = (await response.json()) as {
    apiUrl?: string;
    downloadUrl?: string;
    authorizationToken?: string;
  };

  if (!payload.apiUrl || !payload.downloadUrl || !payload.authorizationToken) {
    throw new Error('b2_auth_response_invalid');
  }

  b2AuthCache = {
    apiUrl: payload.apiUrl,
    downloadUrl: payload.downloadUrl,
    authorizationToken: payload.authorizationToken,
    expiresAtMs: now + 12 * 60 * 60 * 1000,
  };

  return b2AuthCache;
}

async function getUploadState(env: Env): Promise<B2UploadState> {
  assertB2Configured(env);
  const now = Date.now();
  if (b2UploadCache && b2UploadCache.expiresAtMs > now + 60_000) {
    return b2UploadCache;
  }

  const auth = await authorizeB2(env);
  const response = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: {
      Authorization: auth.authorizationToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      bucketId: env.B2_BUCKET_ID,
    }),
  });

  if (!response.ok) {
    b2UploadCache = null;
    throw new Error(`b2_upload_url_failed_${response.status}`);
  }

  const payload = (await response.json()) as {
    uploadUrl?: string;
    authorizationToken?: string;
  };
  if (!payload.uploadUrl || !payload.authorizationToken) {
    throw new Error('b2_upload_url_response_invalid');
  }

  b2UploadCache = {
    uploadUrl: payload.uploadUrl,
    authorizationToken: payload.authorizationToken,
    expiresAtMs: now + 30 * 60 * 1000,
  };

  return b2UploadCache;
}

export async function putToB2(
  env: Env,
  fileName: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<{ fileName: string }> {
  assertB2Configured(env);
  const upload = await getUploadState(env);
  const response = await fetch(upload.uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: upload.authorizationToken,
      'X-Bz-File-Name': normalizeB2FileName(fileName),
      'Content-Type': contentType || 'b2/x-auto',
      'X-Bz-Content-Sha1': 'do_not_verify',
      'X-Bz-Info-src_last_modified_millis': String(Date.now()),
    },
    body,
  });

  if (!response.ok) {
    b2UploadCache = null;
    throw new Error(`b2_upload_failed_${response.status}`);
  }

  return { fileName };
}

export async function getFromB2(env: Env, fileName: string): Promise<ArrayBuffer> {
  assertB2Configured(env);
  const auth = await authorizeB2(env);
  const encodedBucket = encodeURIComponent(env.B2_BUCKET_NAME);
  const url = `${auth.downloadUrl}/file/${encodedBucket}/${normalizeB2FileName(fileName)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: auth.authorizationToken,
    },
  });

  if (!response.ok) {
    throw new Error(`b2_download_failed_${response.status}`);
  }

  return response.arrayBuffer();
}
