import type http from 'node:http';
import { rotateStoredToken, hashTokenSecret, tokenPrefix } from './tokenLifecycle.js';
import type { SqliteStore } from '../store/sqliteStore.js';
import type { ApiPrincipal, Role } from '../types.js';

const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

interface EnvPrincipalTemplate {
  role: Role;
  tenant_id: string;
  scopes: string[];
}

function isRole(value: string): value is Role {
  return value === 'viewer' || value === 'operator' || value === 'admin';
}

function parseScopes(value: string | undefined): string[] {
  if (!value) {
    return ['*'];
  }
  const scopes = value
    .split('|')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  if (scopes.length === 0) {
    return ['*'];
  }
  return Array.from(new Set(scopes));
}

function parseEntry(entry: string): { token: string; principal: EnvPrincipalTemplate } | null {
  const parts = entry.split(':').map((part) => part.trim());
  if (parts.length < 2) {
    return null;
  }

  const token = parts[0] ?? '';
  const roleRaw = (parts[1] ?? '').toLowerCase();
  const tenant = parts[2] && parts[2] !== '' ? parts[2] : '*';

  if (token === '' || !isRole(roleRaw)) {
    return null;
  }

  return {
    token,
    principal: {
      role: roleRaw,
      tenant_id: tenant,
      scopes: parseScopes(parts[3]),
    },
  };
}

function parseApiKeySpec(spec: string): Map<string, EnvPrincipalTemplate> {
  const map = new Map<string, EnvPrincipalTemplate>();
  const entries = spec
    .split(/\r?\n|,/) 
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

  for (const entry of entries) {
    const parsed = parseEntry(entry);
    if (!parsed) {
      continue;
    }
    map.set(parsed.token, parsed.principal);
  }

  return map;
}

const DEFAULT_DEV_SPEC = 'dev-admin-key:admin:*';

let cachedSource = '';
let cached = new Map<string, EnvPrincipalTemplate>();

function keyStore(): Map<string, EnvPrincipalTemplate> {
  const source = process.env.AI_VPS_API_KEYS?.trim() || DEFAULT_DEV_SPEC;
  if (source !== cachedSource) {
    cachedSource = source;
    cached = parseApiKeySpec(source);
  }
  return cached;
}

function extractToken(req: http.IncomingMessage): string {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }

  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string') {
    return apiKey.trim();
  }

  return '';
}

export function authenticate(req: http.IncomingMessage, store?: SqliteStore): ApiPrincipal | null {
  const providedToken = extractToken(req);
  if (providedToken === '') {
    return null;
  }

  const envPrincipal = keyStore().get(providedToken);
  if (envPrincipal) {
    return {
      type: 'env',
      token_id: null,
      token_type: null,
      token: `env:${providedToken.slice(0, 8)}`,
      role: envPrincipal.role,
      tenant_id: envPrincipal.tenant_id,
      scopes: envPrincipal.scopes,
    };
  }

  if (!store) {
    return null;
  }

  const tokenRecord = store.findActiveTokenByHash({
    token_prefix: tokenPrefix(providedToken),
    token_hash: hashTokenSecret(providedToken),
  });
  if (!tokenRecord || tokenRecord.status !== 'active') {
    return null;
  }

  if (tokenRecord.auto_rotate && tokenRecord.rotate_after && tokenRecord.rotate_after <= new Date().toISOString()) {
    const rotated = rotateStoredToken(store, tokenRecord, 'auto_rotated');
    store.touchTokenLastUsed(rotated.record.id);
    store.addAuditLog({
      tenant_id: rotated.record.tenant_id,
      site_id: null,
      actor: `token:${tokenRecord.id}`,
      event_type: 'auth.token.auto_rotated',
      payload: {
        from_token_id: tokenRecord.id,
        to_token_id: rotated.record.id,
        token_type: rotated.record.token_type,
      },
    });

    return {
      type: 'db',
      token_id: rotated.record.id,
      token_type: rotated.record.token_type,
      token: `token:${rotated.record.id}`,
      rotated_token: rotated.token,
      role: rotated.record.role,
      tenant_id: rotated.record.tenant_id,
      scopes: rotated.record.scopes.length > 0 ? rotated.record.scopes : ['*'],
    };
  }

  store.touchTokenLastUsed(tokenRecord.id);
  return {
    type: 'db',
    token_id: tokenRecord.id,
    token_type: tokenRecord.token_type,
    token: `token:${tokenRecord.id}`,
    role: tokenRecord.role,
    tenant_id: tokenRecord.tenant_id,
    scopes: tokenRecord.scopes.length > 0 ? tokenRecord.scopes : ['*'],
  };
}

export function isAllowed(principal: ApiPrincipal, requiredRole: Role): boolean {
  return ROLE_RANK[principal.role] >= ROLE_RANK[requiredRole];
}

export function hasScope(principal: ApiPrincipal, requiredScope: string): boolean {
  if (requiredScope.trim() === '') {
    return true;
  }
  if (principal.scopes.includes('*')) {
    return true;
  }
  return principal.scopes.includes(requiredScope);
}
