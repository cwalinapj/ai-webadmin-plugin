export interface GoogleOAuthEnv {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_OAUTH_REDIRECT_URI: string;
}

export interface GoogleOauthSession {
  id: string;
  plugin_id: string;
  site_id: string;
  return_url: string;
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoogleTokenRecord {
  site_id: string;
  plugin_id: string;
  refresh_token: string;
  access_token: string | null;
  scope: string | null;
  token_type: string | null;
  expires_at: string | null;
  updated_at: string;
}

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/tagmanager.edit.containers',
  'https://www.googleapis.com/auth/tagmanager.publish',
  'https://www.googleapis.com/auth/analytics.edit',
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'openid',
  'email',
];

export async function createOauthSession(
  db: D1Database,
  payload: {
    pluginId: string;
    siteId: string;
    returnUrl: string;
  },
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO google_oauth_sessions
       (id, plugin_id, site_id, return_url, status, error, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'pending', NULL, ?5, ?6)`,
    )
    .bind(sessionId, payload.pluginId, payload.siteId, payload.returnUrl, now, now)
    .run();

  return sessionId;
}

export async function getOauthSession(db: D1Database, sessionId: string): Promise<GoogleOauthSession | null> {
  const result = await db
    .prepare(
      `SELECT id, plugin_id, site_id, return_url, status, error, created_at, updated_at
       FROM google_oauth_sessions WHERE id = ?1`,
    )
    .bind(sessionId)
    .first<GoogleOauthSession>();

  return result ?? null;
}

export async function updateOauthSession(
  db: D1Database,
  sessionId: string,
  status: 'pending' | 'connected' | 'error',
  error: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE google_oauth_sessions
       SET status = ?2, error = ?3, updated_at = ?4
       WHERE id = ?1`,
    )
    .bind(sessionId, status, error, new Date().toISOString())
    .run();
}

export async function getGoogleToken(db: D1Database, siteId: string): Promise<GoogleTokenRecord | null> {
  const result = await db
    .prepare(
      `SELECT site_id, plugin_id, refresh_token, access_token, scope, token_type, expires_at, updated_at
       FROM google_oauth_tokens WHERE site_id = ?1`,
    )
    .bind(siteId)
    .first<GoogleTokenRecord>();

  return result ?? null;
}

export async function upsertGoogleToken(
  db: D1Database,
  payload: {
    siteId: string;
    pluginId: string;
    refreshToken: string;
    accessToken: string;
    scope: string;
    tokenType: string;
    expiresAt: string | null;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO google_oauth_tokens
       (site_id, plugin_id, refresh_token, access_token, scope, token_type, expires_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(site_id) DO UPDATE SET
         plugin_id = excluded.plugin_id,
         refresh_token = excluded.refresh_token,
         access_token = excluded.access_token,
         scope = excluded.scope,
         token_type = excluded.token_type,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      payload.siteId,
      payload.pluginId,
      payload.refreshToken,
      payload.accessToken,
      payload.scope,
      payload.tokenType,
      payload.expiresAt,
      now,
    )
    .run();
}

export async function saveRefreshedAccessToken(
  db: D1Database,
  payload: {
    siteId: string;
    accessToken: string;
    scope: string;
    tokenType: string;
    expiresAt: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE google_oauth_tokens
       SET access_token = ?2,
           scope = ?3,
           token_type = ?4,
           expires_at = ?5,
           updated_at = ?6
       WHERE site_id = ?1`,
    )
    .bind(
      payload.siteId,
      payload.accessToken,
      payload.scope,
      payload.tokenType,
      payload.expiresAt,
      new Date().toISOString(),
    )
    .run();
}

export function buildGoogleAuthUrl(env: GoogleOAuthEnv, state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: GOOGLE_OAUTH_SCOPES.join(' '),
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  env: GoogleOAuthEnv,
  code: string,
): Promise<{
  accessToken: string;
  refreshToken: string;
  scope: string;
  tokenType: string;
  expiresAt: string | null;
}> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code',
      code,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`google_token_exchange_failed:${response.status}:${truncate(text)}`);
  }

  const parsed = safeJson(text) as TokenResponse | null;
  if (!parsed || !parsed.access_token) {
    throw new Error('google_token_exchange_invalid_response');
  }

  if (!parsed.refresh_token) {
    throw new Error('google_missing_refresh_token');
  }

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    scope: parsed.scope ?? '',
    tokenType: parsed.token_type ?? 'Bearer',
    expiresAt: parsed.expires_in ? new Date(Date.now() + parsed.expires_in * 1000).toISOString() : null,
  };
}

export async function refreshGoogleAccessToken(
  env: GoogleOAuthEnv,
  refreshToken: string,
): Promise<{
  accessToken: string;
  scope: string;
  tokenType: string;
  expiresAt: string | null;
}> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`google_refresh_failed:${response.status}:${truncate(text)}`);
  }

  const parsed = safeJson(text) as TokenResponse | null;
  if (!parsed || !parsed.access_token) {
    throw new Error('google_refresh_invalid_response');
  }

  return {
    accessToken: parsed.access_token,
    scope: parsed.scope ?? '',
    tokenType: parsed.token_type ?? 'Bearer',
    expiresAt: parsed.expires_in ? new Date(Date.now() + parsed.expires_in * 1000).toISOString() : null,
  };
}

export async function getGoogleUserEmail(accessToken: string): Promise<string> {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    return '';
  }

  const parsed = (await response.json()) as { email?: string };
  return typeof parsed.email === 'string' ? parsed.email : '';
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function truncate(value: string): string {
  if (value.length <= 240) {
    return value;
  }

  return `${value.slice(0, 240)}...`;
}
