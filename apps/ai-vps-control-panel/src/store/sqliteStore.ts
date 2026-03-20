import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type {
  ActionStatus,
  AgentAction,
  AuthTokenRecord,
  AuditLogRecord,
  BillingStatus,
  BillingSubscriptionRecord,
  ChatMessageRecord,
  ConsoleSessionRecord,
  ConversationRecord,
  LeadCaptureRecord,
  PolicyTemplateRecord,
  QueuedActionRecord,
  RiskLevel,
  Role,
  SitePolicyBindingRecord,
  SiteRecord,
  StripeCheckoutOrderRecord,
  StripeWebhookEventRecord,
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

function asBillingStatus(value: unknown): BillingStatus {
  const v = String(value ?? '');
  if (v === 'active' || v === 'trialing' || v === 'past_due' || v === 'canceled' || v === 'unpaid') {
    return v;
  }
  return 'unpaid';
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
        idempotency_key TEXT,
        policy_hash TEXT,
        guardrail_decision_json TEXT,
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

      CREATE TABLE IF NOT EXISTS policy_templates (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        config_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS site_policy_bindings (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        template_id TEXT NOT NULL,
        status TEXT NOT NULL,
        applied_by TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (site_id, template_id),
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
        FOREIGN KEY (template_id) REFERENCES policy_templates(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS billing_subscriptions (
        site_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        plugin_id TEXT NOT NULL,
        plan_code TEXT NOT NULL,
        status TEXT NOT NULL,
        sandbox_enabled INTEGER NOT NULL,
        current_period_end TEXT,
        grace_period_end TEXT,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS console_sessions (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        role TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT
      );

      CREATE TABLE IF NOT EXISTS lead_captures (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        company TEXT,
        source TEXT NOT NULL,
        product_slug TEXT,
        plan_code TEXT,
        message TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stripe_checkout_orders (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        site_id TEXT,
        lead_id TEXT,
        product_slug TEXT,
        plan_code TEXT NOT NULL,
        stripe_checkout_session_id TEXT,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        status TEXT NOT NULL,
        checkout_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        id TEXT PRIMARY KEY,
        stripe_event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        livemode INTEGER NOT NULL,
        status TEXT NOT NULL,
        tenant_id TEXT,
        site_id TEXT,
        payload_json TEXT NOT NULL,
        error_message TEXT,
        processed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sites_tenant ON sites (tenant_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_tenant_site ON conversations (tenant_id, site_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON chat_messages (conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_actions_tenant_status ON queued_actions (tenant_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_actions_site ON queued_actions (site_id, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_tenant_site_idempotency
        ON queued_actions (tenant_id, site_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_audit_tenant_site ON audit_logs (tenant_id, site_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_tokens_tenant_status_type ON auth_tokens (tenant_id, status, token_type, created_at);
      CREATE INDEX IF NOT EXISTS idx_tokens_prefix_status ON auth_tokens (token_prefix, status);
      CREATE INDEX IF NOT EXISTS idx_tokens_rotate_due ON auth_tokens (status, auto_rotate, rotate_after);
      CREATE INDEX IF NOT EXISTS idx_policy_templates_tenant_category ON policy_templates (tenant_id, category, created_at);
      CREATE INDEX IF NOT EXISTS idx_site_policy_bindings_tenant_site ON site_policy_bindings (tenant_id, site_id, applied_at);
      CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_tenant_status ON billing_subscriptions (tenant_id, status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_console_sessions_email_expiry ON console_sessions (email, expires_at);
      CREATE INDEX IF NOT EXISTS idx_lead_captures_status_created ON lead_captures (status, created_at);
      CREATE INDEX IF NOT EXISTS idx_lead_captures_source_created ON lead_captures (source, created_at);
      CREATE INDEX IF NOT EXISTS idx_checkout_orders_tenant_status ON stripe_checkout_orders (tenant_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_checkout_orders_subscription ON stripe_checkout_orders (stripe_subscription_id);
      CREATE INDEX IF NOT EXISTS idx_checkout_orders_session ON stripe_checkout_orders (stripe_checkout_session_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_events_stripe_event ON stripe_webhook_events (stripe_event_id);
    `);
    const alterStatements = [
      `ALTER TABLE stripe_webhook_events ADD COLUMN status TEXT NOT NULL DEFAULT 'processed'`,
      `ALTER TABLE stripe_webhook_events ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE stripe_webhook_events ADD COLUMN error_message TEXT`,
      `ALTER TABLE queued_actions ADD COLUMN idempotency_key TEXT`,
      `ALTER TABLE queued_actions ADD COLUMN policy_hash TEXT`,
      `ALTER TABLE queued_actions ADD COLUMN guardrail_decision_json TEXT`,
    ];
    for (const statement of alterStatements) {
      try {
        this.db.exec(statement);
      } catch {
        // Column already exists on upgraded installations.
      }
    }
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
    idempotency_key?: string | null;
    policy_hash?: string | null;
    guardrail_decision?: Record<string, unknown> | null;
  }): QueuedActionRecord {
    const now = new Date().toISOString();
    const status = input.status ?? 'pending';
    this.db
      .prepare(
        `
        INSERT INTO queued_actions (
          id, conversation_id, site_id, tenant_id, type, description, risk, requires_confirmation, args_json,
          status, created_at, updated_at, idempotency_key, policy_hash, guardrail_decision_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        input.idempotency_key ?? null,
        input.policy_hash ?? null,
        input.guardrail_decision ? JSON.stringify(input.guardrail_decision) : null,
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

  getActionByIdempotency(input: {
    tenant_id: string;
    site_id: string;
    idempotency_key: string;
  }): QueuedActionRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT * FROM queued_actions
        WHERE tenant_id = ? AND site_id = ? AND idempotency_key = ?
          AND status IN ('pending', 'approved', 'executed')
        ORDER BY created_at DESC
        LIMIT 1
      `,
      )
      .get(input.tenant_id, input.site_id, input.idempotency_key) as SqlRow | undefined;
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

  savePolicyTemplate(input: {
    id?: string;
    tenant_id: string;
    name: string;
    description?: string;
    category?: string;
    config: Record<string, unknown>;
  }): PolicyTemplateRecord {
    const now = new Date().toISOString();
    const id = input.id?.trim() || crypto.randomUUID();
    const description = input.description?.trim() || '';
    const category = input.category?.trim() || 'general';

    this.db
      .prepare(
        `
        INSERT INTO policy_templates (id, tenant_id, name, description, category, config_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          tenant_id = excluded.tenant_id,
          name = excluded.name,
          description = excluded.description,
          category = excluded.category,
          config_json = excluded.config_json,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        id,
        input.tenant_id,
        input.name,
        description,
        category,
        JSON.stringify(input.config ?? {}),
        now,
        now,
      );

    const row = this.db.prepare(`SELECT * FROM policy_templates WHERE id = ?`).get(id) as SqlRow | undefined;
    if (!row) {
      throw new Error('policy_template_persist_failed');
    }
    return this.mapPolicyTemplate(row);
  }

  getPolicyTemplate(id: string): PolicyTemplateRecord | null {
    const row = this.db.prepare(`SELECT * FROM policy_templates WHERE id = ?`).get(id) as SqlRow | undefined;
    if (!row) {
      return null;
    }
    return this.mapPolicyTemplate(row);
  }

  listPolicyTemplates(input: { tenant_id: string; category?: string; limit?: number }): PolicyTemplateRecord[] {
    const sqlParts: string[] = ['SELECT * FROM policy_templates WHERE 1=1'];
    const args: SQLInputValue[] = [];

    if (input.tenant_id !== '*') {
      sqlParts.push('AND tenant_id = ?');
      args.push(input.tenant_id);
    }
    if (input.category && input.category.trim() !== '') {
      sqlParts.push('AND category = ?');
      args.push(input.category.trim());
    }
    sqlParts.push('ORDER BY created_at DESC');
    sqlParts.push('LIMIT ?');
    args.push(Math.max(1, Math.min(input.limit ?? 200, 500)));

    const rows = this.db.prepare(sqlParts.join(' ')).all(...args) as SqlRow[];
    return rows.map((row) => this.mapPolicyTemplate(row));
  }

  upsertSitePolicyBinding(input: {
    tenant_id: string;
    site_id: string;
    template_id: string;
    status: string;
    applied_by: string;
    notes?: string | null;
  }): SitePolicyBindingRecord {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const notes = input.notes?.trim() || null;
    this.db
      .prepare(
        `
        INSERT INTO site_policy_bindings (
          id, tenant_id, site_id, template_id, status, applied_by, applied_at, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(site_id, template_id) DO UPDATE SET
          tenant_id = excluded.tenant_id,
          status = excluded.status,
          applied_by = excluded.applied_by,
          applied_at = excluded.applied_at,
          notes = excluded.notes,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        id,
        input.tenant_id,
        input.site_id,
        input.template_id,
        input.status,
        input.applied_by,
        now,
        notes,
        now,
        now,
      );

    const row = this.db
      .prepare(
        `
        SELECT spb.id, spb.tenant_id, spb.site_id, spb.template_id, spb.status, spb.applied_by, spb.applied_at, spb.notes,
               pt.name AS template_name
        FROM site_policy_bindings spb
        JOIN policy_templates pt ON pt.id = spb.template_id
        WHERE spb.site_id = ? AND spb.template_id = ?
      `,
      )
      .get(input.site_id, input.template_id) as SqlRow | undefined;
    if (!row) {
      throw new Error('site_policy_binding_persist_failed');
    }
    return this.mapSitePolicyBinding(row);
  }

  listSitePolicyBindings(input: {
    tenant_id: string;
    site_id?: string;
    limit?: number;
  }): SitePolicyBindingRecord[] {
    const sqlParts: string[] = [
      `SELECT spb.id, spb.tenant_id, spb.site_id, spb.template_id, spb.status, spb.applied_by, spb.applied_at, spb.notes,
              pt.name AS template_name
       FROM site_policy_bindings spb
       JOIN policy_templates pt ON pt.id = spb.template_id
       WHERE 1=1`,
    ];
    const args: SQLInputValue[] = [];
    if (input.tenant_id !== '*') {
      sqlParts.push('AND spb.tenant_id = ?');
      args.push(input.tenant_id);
    }
    if (input.site_id && input.site_id.trim() !== '') {
      sqlParts.push('AND spb.site_id = ?');
      args.push(input.site_id.trim());
    }
    sqlParts.push('ORDER BY spb.applied_at DESC');
    sqlParts.push('LIMIT ?');
    args.push(Math.max(1, Math.min(input.limit ?? 500, 2000)));

    const rows = this.db.prepare(sqlParts.join(' ')).all(...args) as SqlRow[];
    return rows.map((row) => this.mapSitePolicyBinding(row));
  }

  saveBillingSubscription(input: {
    site_id: string;
    tenant_id: string;
    plugin_id: string;
    plan_code: string;
    status: BillingStatus;
    sandbox_enabled: boolean;
    current_period_end?: string | null;
    grace_period_end?: string | null;
    updated_by: string;
  }): BillingSubscriptionRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO billing_subscriptions (
          site_id, tenant_id, plugin_id, plan_code, status, sandbox_enabled, current_period_end, grace_period_end, updated_by, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(site_id) DO UPDATE SET
          tenant_id = excluded.tenant_id,
          plugin_id = excluded.plugin_id,
          plan_code = excluded.plan_code,
          status = excluded.status,
          sandbox_enabled = excluded.sandbox_enabled,
          current_period_end = excluded.current_period_end,
          grace_period_end = excluded.grace_period_end,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        input.site_id,
        input.tenant_id,
        input.plugin_id,
        input.plan_code,
        input.status,
        boolToInt(input.sandbox_enabled),
        input.current_period_end ?? null,
        input.grace_period_end ?? null,
        input.updated_by,
        now,
      );

    const row = this.db
      .prepare(`SELECT * FROM billing_subscriptions WHERE site_id = ?`)
      .get(input.site_id) as SqlRow | undefined;
    if (!row) {
      throw new Error('billing_subscription_persist_failed');
    }
    return this.mapBillingSubscription(row);
  }

  getBillingSubscriptionBySite(siteId: string): BillingSubscriptionRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM billing_subscriptions WHERE site_id = ? LIMIT 1`)
      .get(siteId) as SqlRow | undefined;
    if (!row) {
      return null;
    }
    return this.mapBillingSubscription(row);
  }

  listBillingSubscriptions(input: {
    tenant_id: string;
    status?: BillingStatus;
    limit?: number;
  }): BillingSubscriptionRecord[] {
    const sqlParts: string[] = ['SELECT * FROM billing_subscriptions WHERE 1=1'];
    const args: SQLInputValue[] = [];
    if (input.tenant_id !== '*') {
      sqlParts.push('AND tenant_id = ?');
      args.push(input.tenant_id);
    }
    if (input.status) {
      sqlParts.push('AND status = ?');
      args.push(input.status);
    }
    sqlParts.push('ORDER BY updated_at DESC');
    sqlParts.push('LIMIT ?');
    args.push(Math.max(1, Math.min(input.limit ?? 200, 500)));

    const rows = this.db.prepare(sqlParts.join(' ')).all(...args) as SqlRow[];
    return rows.map((row) => this.mapBillingSubscription(row));
  }

  createConsoleSession(input: {
    email: string;
    role: Role;
    tenant_id: string;
    expires_at: string;
  }): ConsoleSessionRecord {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `
        INSERT INTO console_sessions (id, email, role, tenant_id, created_at, expires_at, last_used_at, revoked_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
      `,
      )
      .run(id, input.email, input.role, input.tenant_id, now, input.expires_at);
    const row = this.db.prepare(`SELECT * FROM console_sessions WHERE id = ?`).get(id) as SqlRow | undefined;
    if (!row) {
      throw new Error('console_session_create_failed');
    }
    return this.mapConsoleSession(row);
  }

  getConsoleSession(id: string): ConsoleSessionRecord | null {
    const row = this.db.prepare(`SELECT * FROM console_sessions WHERE id = ?`).get(id) as SqlRow | undefined;
    if (!row) {
      return null;
    }
    return this.mapConsoleSession(row);
  }

  touchConsoleSession(id: string): ConsoleSessionRecord | null {
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE console_sessions SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL`).run(now, id);
    return this.getConsoleSession(id);
  }

  revokeConsoleSession(id: string): ConsoleSessionRecord | null {
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE console_sessions SET revoked_at = ? WHERE id = ?`).run(now, id);
    return this.getConsoleSession(id);
  }

  createLeadCapture(input: {
    name: string;
    email: string;
    company?: string | null;
    source: string;
    product_slug?: string | null;
    plan_code?: string | null;
    message?: string | null;
    status?: string;
  }): LeadCaptureRecord {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `
        INSERT INTO lead_captures (id, name, email, company, source, product_slug, plan_code, message, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        id,
        input.name,
        input.email,
        input.company?.trim() || null,
        input.source,
        input.product_slug?.trim() || null,
        input.plan_code?.trim() || null,
        input.message?.trim() || null,
        input.status?.trim() || 'new',
        now,
        now,
      );
    const row = this.db.prepare(`SELECT * FROM lead_captures WHERE id = ?`).get(id) as SqlRow | undefined;
    if (!row) {
      throw new Error('lead_capture_create_failed');
    }
    return this.mapLeadCapture(row);
  }

  listLeadCaptures(input: { status?: string; source?: string; limit?: number }): LeadCaptureRecord[] {
    const sqlParts: string[] = ['SELECT * FROM lead_captures WHERE 1=1'];
    const args: SQLInputValue[] = [];
    if (input.status && input.status.trim() !== '') {
      sqlParts.push('AND status = ?');
      args.push(input.status.trim());
    }
    if (input.source && input.source.trim() !== '') {
      sqlParts.push('AND source = ?');
      args.push(input.source.trim());
    }
    sqlParts.push('ORDER BY created_at DESC');
    sqlParts.push('LIMIT ?');
    args.push(Math.max(1, Math.min(input.limit ?? 200, 500)));
    const rows = this.db.prepare(sqlParts.join(' ')).all(...args) as SqlRow[];
    return rows.map((row) => this.mapLeadCapture(row));
  }

  createStripeCheckoutOrder(input: {
    tenant_id: string;
    site_id?: string | null;
    lead_id?: string | null;
    product_slug?: string | null;
    plan_code: string;
    status: string;
    stripe_checkout_session_id?: string | null;
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    checkout_url?: string | null;
  }): StripeCheckoutOrderRecord {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `
        INSERT INTO stripe_checkout_orders (
          id, tenant_id, site_id, lead_id, product_slug, plan_code, stripe_checkout_session_id, stripe_customer_id,
          stripe_subscription_id, status, checkout_url, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `,
      )
      .run(
        id,
        input.tenant_id,
        input.site_id ?? null,
        input.lead_id ?? null,
        input.product_slug ?? null,
        input.plan_code,
        input.stripe_checkout_session_id ?? null,
        input.stripe_customer_id ?? null,
        input.stripe_subscription_id ?? null,
        input.status,
        input.checkout_url ?? null,
        now,
        now,
      );
    const row = this.db.prepare(`SELECT * FROM stripe_checkout_orders WHERE id = ?`).get(id) as SqlRow | undefined;
    if (!row) {
      throw new Error('stripe_checkout_order_create_failed');
    }
    return this.mapStripeCheckoutOrder(row);
  }

  getStripeCheckoutOrder(id: string): StripeCheckoutOrderRecord | null {
    const row = this.db.prepare(`SELECT * FROM stripe_checkout_orders WHERE id = ?`).get(id) as SqlRow | undefined;
    if (!row) {
      return null;
    }
    return this.mapStripeCheckoutOrder(row);
  }

  getStripeCheckoutOrderBySessionId(sessionId: string): StripeCheckoutOrderRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM stripe_checkout_orders WHERE stripe_checkout_session_id = ? LIMIT 1`)
      .get(sessionId) as SqlRow | undefined;
    if (!row) {
      return null;
    }
    return this.mapStripeCheckoutOrder(row);
  }

  getStripeCheckoutOrderBySubscriptionId(subscriptionId: string): StripeCheckoutOrderRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM stripe_checkout_orders WHERE stripe_subscription_id = ? LIMIT 1`)
      .get(subscriptionId) as SqlRow | undefined;
    if (!row) {
      return null;
    }
    return this.mapStripeCheckoutOrder(row);
  }

  listStripeCheckoutOrders(input: {
    tenant_id: string;
    site_id?: string;
    status?: string;
    limit?: number;
  }): StripeCheckoutOrderRecord[] {
    const sqlParts: string[] = ['SELECT * FROM stripe_checkout_orders WHERE 1=1'];
    const args: SQLInputValue[] = [];
    if (input.tenant_id !== '*') {
      sqlParts.push('AND tenant_id = ?');
      args.push(input.tenant_id);
    }
    if (input.site_id && input.site_id.trim() !== '') {
      sqlParts.push('AND site_id = ?');
      args.push(input.site_id.trim());
    }
    if (input.status && input.status.trim() !== '') {
      sqlParts.push('AND status = ?');
      args.push(input.status.trim());
    }
    sqlParts.push('ORDER BY created_at DESC');
    sqlParts.push('LIMIT ?');
    args.push(Math.max(1, Math.min(input.limit ?? 200, 500)));
    const rows = this.db.prepare(sqlParts.join(' ')).all(...args) as SqlRow[];
    return rows.map((row) => this.mapStripeCheckoutOrder(row));
  }

  updateStripeCheckoutOrder(
    id: string,
    patch: {
      stripe_checkout_session_id?: string | null;
      stripe_customer_id?: string | null;
      stripe_subscription_id?: string | null;
      status?: string;
      checkout_url?: string | null;
      completed_at?: string | null;
    },
  ): StripeCheckoutOrderRecord | null {
    const current = this.getStripeCheckoutOrder(id);
    if (!current) {
      return null;
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        UPDATE stripe_checkout_orders
        SET stripe_checkout_session_id = ?, stripe_customer_id = ?, stripe_subscription_id = ?, status = ?,
            checkout_url = ?, updated_at = ?, completed_at = ?
        WHERE id = ?
      `,
      )
      .run(
        patch.stripe_checkout_session_id ?? current.stripe_checkout_session_id,
        patch.stripe_customer_id ?? current.stripe_customer_id,
        patch.stripe_subscription_id ?? current.stripe_subscription_id,
        patch.status ?? current.status,
        patch.checkout_url ?? current.checkout_url,
        now,
        patch.completed_at === undefined ? current.completed_at : patch.completed_at,
        id,
      );
    return this.getStripeCheckoutOrder(id);
  }

  getStripeWebhookEventByEventId(stripeEventId: string): StripeWebhookEventRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM stripe_webhook_events WHERE stripe_event_id = ? LIMIT 1`)
      .get(stripeEventId) as SqlRow | undefined;
    if (!row) {
      return null;
    }
    return this.mapStripeWebhookEvent(row);
  }

  listStripeWebhookEvents(input: {
    tenant_id: string;
    site_id?: string;
    status?: 'processed' | 'failed';
    limit?: number;
  }): StripeWebhookEventRecord[] {
    const sqlParts: string[] = ['SELECT * FROM stripe_webhook_events WHERE 1=1'];
    const args: SQLInputValue[] = [];
    if (input.tenant_id !== '*') {
      sqlParts.push('AND (tenant_id = ? OR tenant_id IS NULL)');
      args.push(input.tenant_id);
    }
    if (input.site_id && input.site_id.trim() !== '') {
      sqlParts.push('AND site_id = ?');
      args.push(input.site_id.trim());
    }
    if (input.status) {
      sqlParts.push('AND status = ?');
      args.push(input.status);
    }
    sqlParts.push('ORDER BY processed_at DESC');
    sqlParts.push('LIMIT ?');
    args.push(Math.max(1, Math.min(input.limit ?? 200, 500)));
    const rows = this.db.prepare(sqlParts.join(' ')).all(...args) as SqlRow[];
    return rows.map((row) => this.mapStripeWebhookEvent(row));
  }

  createStripeWebhookEvent(input: {
    stripe_event_id: string;
    event_type: string;
    livemode: boolean;
    status?: 'processed' | 'failed';
    tenant_id?: string | null;
    site_id?: string | null;
    payload?: Record<string, unknown>;
    error_message?: string | null;
  }): StripeWebhookEventRecord {
    const processedAt = new Date().toISOString();
    const existing = this.getStripeWebhookEventByEventId(input.stripe_event_id);
    const id = existing?.id ?? crypto.randomUUID();
    this.db
      .prepare(
        `
        INSERT INTO stripe_webhook_events (
          id, stripe_event_id, event_type, livemode, status, tenant_id, site_id, payload_json, error_message, processed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(stripe_event_id) DO UPDATE SET
          event_type = excluded.event_type,
          livemode = excluded.livemode,
          status = excluded.status,
          tenant_id = excluded.tenant_id,
          site_id = excluded.site_id,
          payload_json = excluded.payload_json,
          error_message = excluded.error_message,
          processed_at = excluded.processed_at
      `,
      )
      .run(
        id,
        input.stripe_event_id,
        input.event_type,
        boolToInt(input.livemode),
        input.status ?? 'processed',
        input.tenant_id ?? null,
        input.site_id ?? null,
        JSON.stringify(input.payload ?? {}),
        input.error_message?.trim() || null,
        processedAt,
      );
    const row = this.db.prepare(`SELECT * FROM stripe_webhook_events WHERE id = ?`).get(id) as SqlRow | undefined;
    if (!row) {
      throw new Error('stripe_webhook_event_create_failed');
    }
    return this.mapStripeWebhookEvent(row);
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
    const guardrailDecision =
      typeof row.guardrail_decision_json === 'string' ? parseJsonObject(row.guardrail_decision_json) : null;
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
      idempotency_key: row.idempotency_key ? String(row.idempotency_key) : null,
      policy_hash: row.policy_hash ? String(row.policy_hash) : null,
      guardrail_decision: guardrailDecision,
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

  private mapPolicyTemplate(row: SqlRow): PolicyTemplateRecord {
    return {
      id: String(row.id ?? ''),
      tenant_id: String(row.tenant_id ?? ''),
      name: String(row.name ?? ''),
      description: String(row.description ?? ''),
      category: String(row.category ?? ''),
      config: parseJsonObject(row.config_json),
      created_at: String(row.created_at ?? ''),
      updated_at: String(row.updated_at ?? ''),
    };
  }

  private mapSitePolicyBinding(row: SqlRow): SitePolicyBindingRecord {
    return {
      id: String(row.id ?? ''),
      tenant_id: String(row.tenant_id ?? ''),
      site_id: String(row.site_id ?? ''),
      template_id: String(row.template_id ?? ''),
      template_name: String(row.template_name ?? ''),
      status: String(row.status ?? ''),
      applied_by: String(row.applied_by ?? ''),
      applied_at: String(row.applied_at ?? ''),
      notes: row.notes ? String(row.notes) : null,
    };
  }

  private mapBillingSubscription(row: SqlRow): BillingSubscriptionRecord {
    return {
      site_id: String(row.site_id ?? ''),
      tenant_id: String(row.tenant_id ?? ''),
      plugin_id: String(row.plugin_id ?? ''),
      plan_code: String(row.plan_code ?? ''),
      status: asBillingStatus(row.status),
      sandbox_enabled: intToBool(row.sandbox_enabled),
      current_period_end: row.current_period_end ? String(row.current_period_end) : null,
      grace_period_end: row.grace_period_end ? String(row.grace_period_end) : null,
      updated_by: String(row.updated_by ?? ''),
      updated_at: String(row.updated_at ?? ''),
    };
  }

  private mapConsoleSession(row: SqlRow): ConsoleSessionRecord {
    return {
      id: String(row.id ?? ''),
      email: String(row.email ?? ''),
      role: asRole(row.role),
      tenant_id: String(row.tenant_id ?? ''),
      created_at: String(row.created_at ?? ''),
      expires_at: String(row.expires_at ?? ''),
      last_used_at: row.last_used_at ? String(row.last_used_at) : null,
      revoked_at: row.revoked_at ? String(row.revoked_at) : null,
    };
  }

  private mapLeadCapture(row: SqlRow): LeadCaptureRecord {
    return {
      id: String(row.id ?? ''),
      name: String(row.name ?? ''),
      email: String(row.email ?? ''),
      company: row.company ? String(row.company) : null,
      source: String(row.source ?? ''),
      product_slug: row.product_slug ? String(row.product_slug) : null,
      plan_code: row.plan_code ? String(row.plan_code) : null,
      message: row.message ? String(row.message) : null,
      status: String(row.status ?? 'new'),
      created_at: String(row.created_at ?? ''),
      updated_at: String(row.updated_at ?? ''),
    };
  }

  private mapStripeCheckoutOrder(row: SqlRow): StripeCheckoutOrderRecord {
    return {
      id: String(row.id ?? ''),
      tenant_id: String(row.tenant_id ?? ''),
      site_id: row.site_id ? String(row.site_id) : null,
      lead_id: row.lead_id ? String(row.lead_id) : null,
      product_slug: row.product_slug ? String(row.product_slug) : null,
      plan_code: String(row.plan_code ?? ''),
      stripe_checkout_session_id: row.stripe_checkout_session_id ? String(row.stripe_checkout_session_id) : null,
      stripe_customer_id: row.stripe_customer_id ? String(row.stripe_customer_id) : null,
      stripe_subscription_id: row.stripe_subscription_id ? String(row.stripe_subscription_id) : null,
      status: String(row.status ?? ''),
      checkout_url: row.checkout_url ? String(row.checkout_url) : null,
      created_at: String(row.created_at ?? ''),
      updated_at: String(row.updated_at ?? ''),
      completed_at: row.completed_at ? String(row.completed_at) : null,
    };
  }

  private mapStripeWebhookEvent(row: SqlRow): StripeWebhookEventRecord {
    return {
      id: String(row.id ?? ''),
      stripe_event_id: String(row.stripe_event_id ?? ''),
      event_type: String(row.event_type ?? ''),
      livemode: intToBool(row.livemode),
      status: String(row.status ?? 'processed') === 'failed' ? 'failed' : 'processed',
      tenant_id: row.tenant_id ? String(row.tenant_id) : null,
      site_id: row.site_id ? String(row.site_id) : null,
      payload: parseJsonObject(row.payload_json),
      error_message: row.error_message ? String(row.error_message) : null,
      processed_at: String(row.processed_at ?? ''),
    };
  }
}
