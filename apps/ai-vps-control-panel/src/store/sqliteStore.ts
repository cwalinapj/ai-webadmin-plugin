import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type {
  ActionStatus,
  AgentAction,
  AuthTokenRecord,
  AuditLogRecord,
  ChatMessageRecord,
  ConversationRecord,
  QueuedActionRecord,
  RiskLevel,
  Role,
  SiteRecord,
  TokenStatus,
  TokenType,
} from '../types.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
type SQLInputValue = import('node:sqlite').SQLInputValue;

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

function intToBool(value: unknown): boolean {
  return Number(value) === 1;
}

function normalizeDbPath(dbPath: string): string {
  if (dbPath === ':memory:') {
    return dbPath;
  }
  const resolved = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

type SqlRow = Record<string, unknown>;

function asRisk(value: unknown): RiskLevel {
  const v = String(value ?? '');
  if (v === 'medium' || v === 'high') {
    return v;
  }
  return 'low';
}

function asActionStatus(value: unknown): ActionStatus {
  const v = String(value ?? '');
  if (v === 'approved' || v === 'executed' || v === 'failed' || v === 'cancelled') {
    return v;
  }
  return 'pending';
}

function asRole(value: unknown): Role {
  const v = String(value ?? '');
  if (v === 'viewer' || v === 'operator' || v === 'admin') {
    return v;
  }
  return 'viewer';
}

function asTokenType(value: unknown): TokenType {
  const v = String(value ?? '');
  if (v === 'pat') {
    return 'pat';
  }
  return 'api_key';
}

function asTokenStatus(value: unknown): TokenStatus {
  const v = String(value ?? '');
  if (v === 'revoked') {
    return 'revoked';
  }
  return 'active';
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value.trim() === '') {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function parseJsonStringArray(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim() === '') {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item !== '');
  } catch {
    return [];
  }
}

export class SqliteStore {
  private readonly db: import('node:sqlite').DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(normalizeDbPath(dbPath));
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sites (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        panel_type TEXT NOT NULL,
        runtime_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_message TEXT NOT NULL,
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS queued_actions (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        risk TEXT NOT NULL,
        requires_confirmation INTEGER NOT NULL,
        args_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        approved_by TEXT,
        approved_at TEXT,
        executed_by TEXT,
        executed_at TEXT,
        execute_result_json TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        site_id TEXT,
        actor TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS auth_tokens (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        token_type TEXT NOT NULL,
        label TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        token_prefix TEXT NOT NULL,
        role TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        last_used_at TEXT,
        rotate_after TEXT,
        auto_rotate INTEGER NOT NULL,
        rotated_from TEXT,
        revoked_at TEXT,
        revoked_reason TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sites_tenant ON sites (tenant_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_tenant_site ON conversations (tenant_id, site_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON chat_messages (conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_actions_tenant_status ON queued_actions (tenant_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_actions_site ON queued_actions (site_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_tenant_site ON audit_logs (tenant_id, site_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_tokens_tenant_status_type ON auth_tokens (tenant_id, status, token_type, created_at);
      CREATE INDEX IF NOT EXISTS idx_tokens_prefix_status ON auth_tokens (token_prefix, status);
      CREATE INDEX IF NOT EXISTS idx_tokens_rotate_due ON auth_tokens (status, auto_rotate, rotate_after);
    `);
  }

  saveSite(input: {
    id: string;
    tenant_id: string;
    domain: string;
    panel_type: string;
    runtime_type: string;
  }): SiteRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO sites (id, tenant_id, domain, panel_type, runtime_type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          tenant_id = excluded.tenant_id,
          domain = excluded.domain,
          panel_type = excluded.panel_type,
          runtime_type = excluded.runtime_type,
          updated_at = excluded.updated_at
      `)
      .run(input.id, input.tenant_id, input.domain, input.panel_type, input.runtime_type, now, now);

    const row = this.db.prepare(`SELECT * FROM sites WHERE id = ?`).get(input.id) as SqlRow | undefined;
    if (!row) {
      throw new Error('site_persist_failed');
    }
    return this.mapSite(row);
  }

  listSites(tenantId: string): SiteRecord[] {
    const query =
      tenantId === '*'
        ? `SELECT * FROM sites ORDER BY created_at ASC`
        : `SELECT * FROM sites WHERE tenant_id = ? ORDER BY created_at ASC`;

    const rows = (tenantId === '*'
      ? this.db.prepare(query).all()
      : this.db.prepare(query).all(tenantId)) as SqlRow[];
    return rows.map((row) => this.mapSite(row));
  }

  getSite(id: string): SiteRecord | null {
    const row = this.db.prepare(`SELECT * FROM sites WHERE id = ?`).get(id) as SqlRow | undefined;
    if (!row) {
      return null;
    }
    return this.mapSite(row);
  }

  getConversation(id: string): ConversationRecord | null {
    const row = this.db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(id) as SqlRow | undefined;
    if (!row) {
      return null;
    }
    return this.mapConversation(row);
  }

  listConversations(tenantId: string, siteId?: string): ConversationRecord[] {
    const sqlParts: string[] = ['SELECT * FROM conversations WHERE 1=1'];
    const args: SQLInputValue[] = [];
    if (tenantId !== '*') {
      sqlParts.push('AND tenant_id = ?');
      args.push(tenantId);
    }
    if (siteId && siteId.trim() !== '') {
      sqlParts.push('AND site_id = ?');
      args.push(siteId.trim());
    }
    sqlParts.push('ORDER BY updated_at DESC');

    const rows = this.db.prepare(sqlParts.join(' ')).all(...args) as SqlRow[];
    return rows.map((row) => this.mapConversation(row));
  }

  createConversation(input: { site_id: string; tenant_id: string; last_message: string }): ConversationRecord {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `
        INSERT INTO conversations (id, site_id, tenant_id, created_at, updated_at, last_message)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      )
      .run(id, input.site_id, input.tenant_id, now, now, input.last_message);

    const row = this.db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(id) as SqlRow | undefined;
    if (!row) {
      throw new Error('conversation_create_failed');
    }
    return this.mapConversation(row);
  }

  touchConversation(conversationId: string, lastMessage: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE conversations SET updated_at = ?, last_message = ? WHERE id = ?`)
      .run(now, lastMessage, conversationId);
  }

  addChatMessage(input: {
    conversation_id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
  }): ChatMessageRecord {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `
        INSERT INTO chat_messages (id, conversation_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      )
      .run(id, input.conversation_id, input.role, input.content, now);

    const row = this.db.prepare(`SELECT * FROM chat_messages WHERE id = ?`).get(id) as SqlRow | undefined;
    if (!row) {
      throw new Error('chat_message_insert_failed');
    }
    return this.mapChatMessage(row);
  }

  listChatMessages(conversationId: string): ChatMessageRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC`)
      .all(conversationId) as SqlRow[];
    return rows.map((row) => this.mapChatMessage(row));
  }

  enqueueAction(input: {
    action: AgentAction;
    conversation_id: string;
    site_id: string;
    tenant_id: string;
    status?: ActionStatus;
  }): QueuedActionRecord {
    const now = new Date().toISOString();
    const status = input.status ?? 'pending';
    this.db
      .prepare(
        `
        INSERT INTO queued_actions (
          id, conversation_id, site_id, tenant_id, type, description, risk, requires_confirmation, args_json,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        input.action.id,
        input.conversation_id,
        input.site_id,
        input.tenant_id,
        input.action.type,
        input.action.description,
        input.action.risk,
        boolToInt(input.action.requires_confirmation),
        JSON.stringify(input.action.args ?? {}),
        status,
        now,
        now,
      );

    const row = this.db.prepare(`SELECT * FROM queued_actions WHERE id = ?`).get(input.action.id) as
      | SqlRow
      | undefined;
    if (!row) {
      throw new Error('action_enqueue_failed');
    }
    return this.mapQueuedAction(row);
  }

  listActions(input: {
    tenant_id: string;
    status?: ActionStatus;
    site_id?: string;
    conversation_id?: string;
  }): QueuedActionRecord[] {
    const sqlParts: string[] = ['SELECT * FROM queued_actions WHERE 1=1'];
    const args: SQLInputValue[] = [];
    if (input.tenant_id !== '*') {
      sqlParts.push('AND tenant_id = ?');
      args.push(input.tenant_id);
    }
    if (input.status) {
      sqlParts.push('AND status = ?');
      args.push(input.status);
    }
    if (input.site_id) {
      sqlParts.push('AND site_id = ?');
      args.push(input.site_id);
    }
    if (input.conversation_id) {
      sqlParts.push('AND conversation_id = ?');
      args.push(input.conversation_id);
    }
    sqlParts.push('ORDER BY created_at DESC');

    const rows = this.db.prepare(sqlParts.join(' ')).all(...args) as SqlRow[];
    return rows.map((row) => this.mapQueuedAction(row));
  }

  getAction(id: string): QueuedActionRecord | null {
    const row = this.db.prepare(`SELECT * FROM queued_actions WHERE id = ?`).get(id) as SqlRow | undefined;
    if (!row) {
      return null;
    }
    return this.mapQueuedAction(row);
  }

  approveAction(input: { id: string; actor: string; tenant_id: string }): QueuedActionRecord | null {
    const current = this.getAction(input.id);
    if (!current) {
      return null;
    }
    if (input.tenant_id !== '*' && current.tenant_id !== input.tenant_id) {
      return null;
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        UPDATE queued_actions
        SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ?
        WHERE id = ?
      `,
      )
      .run(input.actor, now, now, input.id);
    return this.getAction(input.id);
  }

  recordActionExecution(input: {
    id: string;
    actor: string;
    tenant_id: string;
    status: ActionStatus;
    execute_result: Record<string, unknown>;
  }): QueuedActionRecord | null {
    const current = this.getAction(input.id);
    if (!current) {
      return null;
    }
    if (input.tenant_id !== '*' && current.tenant_id !== input.tenant_id) {
      return null;
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        UPDATE queued_actions
        SET status = ?, executed_by = ?, executed_at = ?, execute_result_json = ?, updated_at = ?
        WHERE id = ?
      `,
      )
      .run(
        input.status,
        input.actor,
        now,
        JSON.stringify(input.execute_result ?? {}),
        now,
        input.id,
      );
    return this.getAction(input.id);
  }

  addAuditLog(input: {
    tenant_id: string;
    site_id: string | null;
    actor: string;
    event_type: string;
    payload: Record<string, unknown>;
  }): AuditLogRecord {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `
        INSERT INTO audit_logs (id, tenant_id, site_id, actor, event_type, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(id, input.tenant_id, input.site_id, input.actor, input.event_type, JSON.stringify(input.payload), now);

    const row = this.db.prepare(`SELECT * FROM audit_logs WHERE id = ?`).get(id) as SqlRow | undefined;
    if (!row) {
      throw new Error('audit_log_insert_failed');
    }
    return this.mapAuditLog(row);
  }

  listAuditLogs(input: { tenant_id: string; site_id?: string; limit?: number }): AuditLogRecord[] {
    const sqlParts: string[] = ['SELECT * FROM audit_logs WHERE 1=1'];
    const args: SQLInputValue[] = [];
    if (input.tenant_id !== '*') {
      sqlParts.push('AND tenant_id = ?');
      args.push(input.tenant_id);
    }
    if (input.site_id && input.site_id.trim() !== '') {
      sqlParts.push('AND site_id = ?');
      args.push(input.site_id.trim());
    }
    sqlParts.push('ORDER BY created_at DESC');
    sqlParts.push('LIMIT ?');
    args.push(Math.max(1, Math.min(input.limit ?? 100, 500)));

    const rows = this.db.prepare(sqlParts.join(' ')).all(...args) as SqlRow[];
    return rows.map((row) => this.mapAuditLog(row));
  }

  createAuthToken(input: {
    id?: string;
    tenant_id: string;
    token_type: TokenType;
    label: string;
    token_hash: string;
    token_prefix: string;
    role: Role;
    scopes: string[];
    expires_at?: string | null;
    rotate_after?: string | null;
    auto_rotate?: boolean;
    rotated_from?: string | null;
  }): AuthTokenRecord {
    const now = new Date().toISOString();
    const id = input.id?.trim() || crypto.randomUUID();
    this.db
      .prepare(
        `
        INSERT INTO auth_tokens (
          id, tenant_id, token_type, label, token_hash, token_prefix, role, scopes_json, status, created_at,
          updated_at, expires_at, last_used_at, rotate_after, auto_rotate, rotated_from, revoked_at, revoked_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL, ?, ?, ?, NULL, NULL)
      `,
      )
      .run(
        id,
        input.tenant_id,
        input.token_type,
        input.label,
        input.token_hash,
        input.token_prefix,
        input.role,
        JSON.stringify(input.scopes ?? []),
        now,
        now,
        input.expires_at ?? null,
        input.rotate_after ?? null,
        boolToInt(input.auto_rotate ?? false),
        input.rotated_from ?? null,
      );

    const row = this.db.prepare(`SELECT * FROM auth_tokens WHERE id = ?`).get(id) as SqlRow | undefined;
    if (!row) {
      throw new Error('auth_token_insert_failed');
    }
    return this.mapAuthToken(row);
  }

  getAuthToken(id: string): AuthTokenRecord | null {
    const row = this.db.prepare(`SELECT * FROM auth_tokens WHERE id = ?`).get(id) as SqlRow | undefined;
    if (!row) {
      return null;
    }
    return this.mapAuthToken(row);
  }

  listAuthTokens(input: {
    tenant_id: string;
    include_revoked?: boolean;
    token_type?: TokenType;
    limit?: number;
  }): AuthTokenRecord[] {
    const sqlParts: string[] = ['SELECT * FROM auth_tokens WHERE 1=1'];
    const args: SQLInputValue[] = [];
    if (input.tenant_id !== '*') {
      sqlParts.push('AND tenant_id = ?');
      args.push(input.tenant_id);
    }
    if (!input.include_revoked) {
      sqlParts.push(`AND status = 'active'`);
    }
    if (input.token_type) {
      sqlParts.push('AND token_type = ?');
      args.push(input.token_type);
    }
    sqlParts.push('ORDER BY created_at DESC');
    sqlParts.push('LIMIT ?');
    args.push(Math.max(1, Math.min(input.limit ?? 200, 500)));

    const rows = this.db.prepare(sqlParts.join(' ')).all(...args) as SqlRow[];
    return rows.map((row) => this.mapAuthToken(row));
  }

  findActiveTokenByHash(input: { token_prefix: string; token_hash: string }): AuthTokenRecord | null {
    const now = new Date().toISOString();
    const row = this.db
      .prepare(
        `
        SELECT *
        FROM auth_tokens
        WHERE token_prefix = ?
          AND token_hash = ?
          AND status = 'active'
          AND (expires_at IS NULL OR expires_at > ?)
        LIMIT 1
      `,
      )
      .get(input.token_prefix, input.token_hash, now) as SqlRow | undefined;
    if (!row) {
      return null;
    }
    return this.mapAuthToken(row);
  }

  touchTokenLastUsed(id: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        UPDATE auth_tokens
        SET last_used_at = ?, updated_at = ?
        WHERE id = ?
      `,
      )
      .run(now, now, id);
  }

  revokeAuthToken(input: {
    id: string;
    tenant_id: string;
    reason?: string;
    revoked_at?: string;
  }): AuthTokenRecord | null {
    const current = this.getAuthToken(input.id);
    if (!current) {
      return null;
    }
    if (input.tenant_id !== '*' && current.tenant_id !== input.tenant_id) {
      return null;
    }
    const now = input.revoked_at ?? new Date().toISOString();
    this.db
      .prepare(
        `
        UPDATE auth_tokens
        SET status = 'revoked', updated_at = ?, revoked_at = ?, revoked_reason = ?
        WHERE id = ?
      `,
      )
      .run(now, now, input.reason?.trim() || 'revoked', input.id);
    return this.getAuthToken(input.id);
  }

  listTokensDueForAutoRotate(input: { tenant_id: string; limit?: number; now?: string }): AuthTokenRecord[] {
    const sqlParts: string[] = [
      `SELECT * FROM auth_tokens WHERE status = 'active' AND auto_rotate = 1 AND rotate_after IS NOT NULL AND rotate_after <= ?`,
    ];
    const now = input.now ?? new Date().toISOString();
    const args: SQLInputValue[] = [now];
    if (input.tenant_id !== '*') {
      sqlParts.push('AND tenant_id = ?');
      args.push(input.tenant_id);
    }
    sqlParts.push(`AND (expires_at IS NULL OR expires_at > ?)`);
    args.push(now);
    sqlParts.push('ORDER BY rotate_after ASC');
    sqlParts.push('LIMIT ?');
    args.push(Math.max(1, Math.min(input.limit ?? 50, 200)));
    const rows = this.db.prepare(sqlParts.join(' ')).all(...args) as SqlRow[];
    return rows.map((row) => this.mapAuthToken(row));
  }

  private mapSite(row: SqlRow): SiteRecord {
    return {
      id: String(row.id ?? ''),
      tenant_id: String(row.tenant_id ?? ''),
      domain: String(row.domain ?? ''),
      panel_type: String(row.panel_type ?? ''),
      runtime_type: String(row.runtime_type ?? ''),
      created_at: String(row.created_at ?? ''),
      updated_at: String(row.updated_at ?? ''),
    };
  }

  private mapConversation(row: SqlRow): ConversationRecord {
    return {
      id: String(row.id ?? ''),
      site_id: String(row.site_id ?? ''),
      tenant_id: String(row.tenant_id ?? ''),
      created_at: String(row.created_at ?? ''),
      updated_at: String(row.updated_at ?? ''),
      last_message: String(row.last_message ?? ''),
    };
  }

  private mapChatMessage(row: SqlRow): ChatMessageRecord {
    const role = String(row.role ?? 'assistant');
    const safeRole: 'user' | 'assistant' | 'system' =
      role === 'user' || role === 'system' ? role : 'assistant';
    return {
      id: String(row.id ?? ''),
      conversation_id: String(row.conversation_id ?? ''),
      role: safeRole,
      content: String(row.content ?? ''),
      created_at: String(row.created_at ?? ''),
    };
  }

  private mapQueuedAction(row: SqlRow): QueuedActionRecord {
    const args = parseJsonObject(row.args_json);
    const executeResult =
      typeof row.execute_result_json === 'string' ? parseJsonObject(row.execute_result_json) : null;
    return {
      id: String(row.id ?? ''),
      conversation_id: String(row.conversation_id ?? ''),
      site_id: String(row.site_id ?? ''),
      tenant_id: String(row.tenant_id ?? ''),
      type: String(row.type ?? 'noop') as QueuedActionRecord['type'],
      description: String(row.description ?? ''),
      risk: asRisk(row.risk),
      requires_confirmation: intToBool(row.requires_confirmation),
      args: args as Record<string, string | number | boolean>,
      status: asActionStatus(row.status),
      created_at: String(row.created_at ?? ''),
      updated_at: String(row.updated_at ?? ''),
      approved_by: row.approved_by ? String(row.approved_by) : null,
      approved_at: row.approved_at ? String(row.approved_at) : null,
      executed_by: row.executed_by ? String(row.executed_by) : null,
      executed_at: row.executed_at ? String(row.executed_at) : null,
      execute_result: executeResult,
    };
  }

  private mapAuditLog(row: SqlRow): AuditLogRecord {
    return {
      id: String(row.id ?? ''),
      tenant_id: String(row.tenant_id ?? ''),
      site_id: row.site_id ? String(row.site_id) : null,
      actor: String(row.actor ?? ''),
      event_type: String(row.event_type ?? ''),
      payload: parseJsonObject(row.payload_json),
      created_at: String(row.created_at ?? ''),
    };
  }

  private mapAuthToken(row: SqlRow): AuthTokenRecord {
    return {
      id: String(row.id ?? ''),
      tenant_id: String(row.tenant_id ?? ''),
      token_type: asTokenType(row.token_type),
      label: String(row.label ?? ''),
      token_hash: String(row.token_hash ?? ''),
      token_prefix: String(row.token_prefix ?? ''),
      role: asRole(row.role),
      scopes: parseJsonStringArray(row.scopes_json),
      status: asTokenStatus(row.status),
      created_at: String(row.created_at ?? ''),
      updated_at: String(row.updated_at ?? ''),
      expires_at: row.expires_at ? String(row.expires_at) : null,
      last_used_at: row.last_used_at ? String(row.last_used_at) : null,
      rotate_after: row.rotate_after ? String(row.rotate_after) : null,
      auto_rotate: intToBool(row.auto_rotate),
      rotated_from: row.rotated_from ? String(row.rotated_from) : null,
      revoked_at: row.revoked_at ? String(row.revoked_at) : null,
      revoked_reason: row.revoked_reason ? String(row.revoked_reason) : null,
    };
  }
}
