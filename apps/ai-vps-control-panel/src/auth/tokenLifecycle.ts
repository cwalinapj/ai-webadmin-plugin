import { createHash, randomBytes } from 'node:crypto';
import type { SqliteStore } from '../store/sqliteStore.js';
import type { AuthTokenRecord, TokenType } from '../types.js';

const PREFIX_LENGTH = 18;
const FALLBACK_PEPPER = 'dev-only-pepper-change-me';

function rotationDaysDefault(): number {
  const parsed = Number.parseInt(process.env.AI_VPS_TOKEN_ROTATE_DAYS ?? '', 10);
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= 3650) {
    return parsed;
  }
  return 30;
}

export function hashTokenSecret(token: string): string {
  const pepper = process.env.AI_VPS_TOKEN_PEPPER?.trim() || FALLBACK_PEPPER;
  return createHash('sha256').update(`${pepper}:${token}`).digest('hex');
}

export function tokenPrefix(token: string): string {
  return token.slice(0, PREFIX_LENGTH);
}

export function issueTokenSecret(tokenType: TokenType): {
  token: string;
  token_hash: string;
  token_prefix: string;
} {
  const typeTag = tokenType === 'pat' ? 'pat' : 'api';
  const publicSegment = randomBytes(6).toString('hex');
  const secretSegment = randomBytes(24).toString('base64url');
  const token = `${typeTag}_${publicSegment}.${secretSegment}`;
  return {
    token,
    token_hash: hashTokenSecret(token),
    token_prefix: tokenPrefix(token),
  };
}

export function nextRotateAfterIso(record: {
  auto_rotate: boolean;
  created_at: string;
  rotate_after: string | null;
}): string | null {
  if (!record.auto_rotate) {
    return null;
  }

  const now = Date.now();
  const createdAt = Date.parse(record.created_at);
  const rotateAfter = record.rotate_after ? Date.parse(record.rotate_after) : Number.NaN;
  const fallbackMs = rotationDaysDefault() * 24 * 60 * 60 * 1000;
  let intervalMs = fallbackMs;

  if (Number.isFinite(createdAt) && Number.isFinite(rotateAfter) && rotateAfter > createdAt) {
    intervalMs = rotateAfter - createdAt;
  }

  return new Date(now + intervalMs).toISOString();
}

export function defaultRotateAfterIso(autoRotate: boolean): string | null {
  if (!autoRotate) {
    return null;
  }
  return new Date(Date.now() + rotationDaysDefault() * 24 * 60 * 60 * 1000).toISOString();
}

export function rotateStoredToken(
  store: SqliteStore,
  current: AuthTokenRecord,
  reason: string,
): { token: string; record: AuthTokenRecord } {
  const issued = issueTokenSecret(current.token_type);
  const replacement = store.createAuthToken({
    tenant_id: current.tenant_id,
    token_type: current.token_type,
    label: current.label,
    token_hash: issued.token_hash,
    token_prefix: issued.token_prefix,
    role: current.role,
    scopes: current.scopes,
    expires_at: current.expires_at,
    rotate_after: nextRotateAfterIso(current),
    auto_rotate: current.auto_rotate,
    rotated_from: current.id,
  });

  const revoked = store.revokeAuthToken({
    id: current.id,
    tenant_id: '*',
    reason,
  });
  if (!revoked) {
    throw new Error('token_rotate_revoke_failed');
  }

  return {
    token: issued.token,
    record: replacement,
  };
}
