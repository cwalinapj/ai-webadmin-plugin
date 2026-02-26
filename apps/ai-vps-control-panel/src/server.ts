import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { planAgentResponse } from './agent/planner.js';
import { authenticate, isAllowed } from './auth/apiKeys.js';
import { defaultRotateAfterIso, issueTokenSecret, rotateStoredToken } from './auth/tokenLifecycle.js';
import { SafeCommandExecutor } from './commands/executor.js';
import { syncWorkerAfterAction } from './integration/workerSync.js';
import { createStore } from './store/index.js';
import type {
  ActionStatus,
  AgentAction,
  ApiPrincipal,
  AuthTokenRecord,
  ChatRequest,
  ExecuteActionRequest,
  QueuedActionRecord,
  Role,
  SiteRecord,
  TokenType,
} from './types.js';

interface JsonResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

interface RequestContext {
  rotated_token?: string;
}

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');

const executor = new SafeCommandExecutor();

function json(status: number, body: unknown, headers?: Record<string, string>): JsonResponse {
  return { status, body, headers };
}

function send(res: http.ServerResponse, payload: JsonResponse): void {
  res.statusCode = payload.status;
  res.setHeader('content-type', 'application/json');
  for (const [key, value] of Object.entries(payload.headers ?? {})) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(payload.body));
}

function sendRaw(
  res: http.ServerResponse,
  payload: { status: number; contentType: string; body: Buffer | string },
): void {
  res.statusCode = payload.status;
  res.setHeader('content-type', payload.contentType);
  res.end(payload.body);
}

async function parseJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim() === '') {
    return {};
  }
  return JSON.parse(raw);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function parseObjectBody(
  req: http.IncomingMessage,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const body = await parseJson(req);
    if (!isObject(body)) {
      return { ok: false, error: 'invalid_payload' };
    }
    return { ok: true, body };
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
}

function siteAllowed(principal: ApiPrincipal, site: SiteRecord): boolean {
  return principal.tenant_id === '*' || site.tenant_id === principal.tenant_id;
}

function authorize(
  req: http.IncomingMessage,
  store: ReturnType<typeof createStore>,
  role: Role,
  context: RequestContext,
): ApiPrincipal | null {
  const principal = authenticate(req, store);
  if (!principal) {
    return null;
  }
  if (!isAllowed(principal, role)) {
    return null;
  }
  if (principal.rotated_token) {
    context.rotated_token = principal.rotated_token;
  }
  return principal;
}

function queuedToAgentAction(action: QueuedActionRecord): AgentAction {
  return {
    id: action.id,
    type: action.type,
    description: action.description,
    risk: action.risk,
    requires_confirmation: action.requires_confirmation,
    args: action.args,
  };
}

function contentTypeForFile(filePath: string): string {
  if (filePath.endsWith('.js')) {
    return 'application/javascript; charset=utf-8';
  }
  if (filePath.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  return 'text/html; charset=utf-8';
}

async function serveStatic(pathname: string): Promise<{ status: number; contentType: string; body: Buffer } | null> {
  const normalized = pathname === '/' ? '/index.html' : pathname;
  if (normalized.includes('..')) {
    return {
      status: 400,
      contentType: 'text/plain; charset=utf-8',
      body: Buffer.from('bad_request'),
    };
  }

  if (!['.html', '.js', '.css'].some((ext) => normalized.endsWith(ext))) {
    return null;
  }

  const filePath = path.resolve(PUBLIC_DIR, `.${normalized}`);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return {
      status: 400,
      contentType: 'text/plain; charset=utf-8',
      body: Buffer.from('bad_request'),
    };
  }

  try {
    const body = await fs.readFile(filePath);
    return {
      status: 200,
      contentType: contentTypeForFile(filePath),
      body,
    };
  } catch {
    return {
      status: 404,
      contentType: 'text/plain; charset=utf-8',
      body: Buffer.from('not_found'),
    };
  }
}

function parseActionStatus(value: unknown): ActionStatus | undefined {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'pending' || raw === 'approved' || raw === 'executed' || raw === 'failed' || raw === 'cancelled') {
    return raw;
  }
  return undefined;
}

function parseTokenType(value: unknown): TokenType {
  return value === 'pat' ? 'pat' : 'api_key';
}

function parseRole(value: unknown): Role {
  if (value === 'admin' || value === 'operator' || value === 'viewer') {
    return value;
  }
  return 'operator';
}

function parseScopeList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return ['*'];
  }
  const scopes = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item !== '');
  if (scopes.length === 0) {
    return ['*'];
  }
  return Array.from(new Set(scopes));
}

function parseOptionalIso(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.floor(value);
  if (rounded <= 0) {
    return null;
  }
  return rounded;
}

function resolveTenantScope(principal: ApiPrincipal, tenantInput: unknown): string | null {
  const requested = typeof tenantInput === 'string' ? tenantInput.trim() : '';
  if (principal.tenant_id !== '*') {
    if (requested !== '' && requested !== principal.tenant_id) {
      return null;
    }
    return principal.tenant_id;
  }
  return requested || 'default';
}

function publicTokenRecord(record: AuthTokenRecord): Omit<AuthTokenRecord, 'token_hash'> {
  return {
    id: record.id,
    tenant_id: record.tenant_id,
    token_type: record.token_type,
    label: record.label,
    token_prefix: record.token_prefix,
    role: record.role,
    scopes: record.scopes,
    status: record.status,
    created_at: record.created_at,
    updated_at: record.updated_at,
    expires_at: record.expires_at,
    last_used_at: record.last_used_at,
    rotate_after: record.rotate_after,
    auto_rotate: record.auto_rotate,
    rotated_from: record.rotated_from,
    revoked_at: record.revoked_at,
    revoked_reason: record.revoked_reason,
  };
}

async function route(
  req: http.IncomingMessage,
  store: ReturnType<typeof createStore>,
  context: RequestContext,
): Promise<JsonResponse> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/health') {
    return json(200, { ok: true, service: 'ai-vps-control-panel' });
  }

  if (method === 'GET' && pathname === '/api/auth/me') {
    const principal = authorize(req, store, 'viewer', context);
    if (!principal) {
      return json(401, { ok: false, error: 'unauthorized' });
    }
    return json(200, {
      ok: true,
      principal: {
        type: principal.type,
        token_id: principal.token_id,
        token_type: principal.token_type,
        role: principal.role,
        tenant_id: principal.tenant_id,
        scopes: principal.scopes,
      },
    });
  }

  if (method === 'GET' && pathname === '/api/tokens') {
    const principal = authorize(req, store, 'admin', context);
    if (!principal) {
      return json(403, { ok: false, error: 'forbidden' });
    }

    const includeRevoked = url.searchParams.get('include_revoked') === '1';
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '200', 10);
    const tokenTypeRaw = url.searchParams.get('token_type');
    const tokenType = tokenTypeRaw === 'pat' || tokenTypeRaw === 'api_key' ? tokenTypeRaw : undefined;
    const tokens = store.listAuthTokens({
      tenant_id: principal.tenant_id,
      include_revoked: includeRevoked,
      token_type: tokenType,
      limit: Number.isFinite(limit) ? limit : 200,
    });
    return json(200, {
      ok: true,
      tokens: tokens.map((record) => publicTokenRecord(record)),
    });
  }

  if (method === 'POST' && pathname === '/api/tokens') {
    const principal = authorize(req, store, 'admin', context);
    if (!principal) {
      return json(403, { ok: false, error: 'forbidden' });
    }
    const parsed = await parseObjectBody(req);
    if (!parsed.ok) {
      return json(400, { ok: false, error: parsed.error });
    }
    const body = parsed.body;

    const label = typeof body.label === 'string' ? body.label.trim() : '';
    if (label === '') {
      return json(400, { ok: false, error: 'missing_label' });
    }
    const tenantId = resolveTenantScope(principal, body.tenant_id);
    if (!tenantId) {
      return json(403, { ok: false, error: 'tenant_scope_violation' });
    }

    const tokenType = parseTokenType(body.token_type);
    const role = parseRole(body.role);
    const scopes = parseScopeList(body.scopes);
    const autoRotate = typeof body.auto_rotate === 'boolean' ? body.auto_rotate : true;
    const expiresAt = parseOptionalIso(body.expires_at);

    let rotateAfter = parseOptionalIso(body.rotate_after);
    const rotateAfterDays = parsePositiveInt(body.rotate_after_days);
    if (rotateAfterDays) {
      rotateAfter = new Date(Date.now() + rotateAfterDays * 24 * 60 * 60 * 1000).toISOString();
    }
    if (!rotateAfter) {
      rotateAfter = defaultRotateAfterIso(autoRotate);
    }

    const issued = issueTokenSecret(tokenType);
    const record = store.createAuthToken({
      tenant_id: tenantId,
      token_type: tokenType,
      label,
      token_hash: issued.token_hash,
      token_prefix: issued.token_prefix,
      role,
      scopes,
      expires_at: expiresAt,
      rotate_after: rotateAfter,
      auto_rotate: autoRotate,
    });

    store.addAuditLog({
      tenant_id: record.tenant_id,
      site_id: null,
      actor: principal.token,
      event_type: 'auth.token.created',
      payload: {
        token_id: record.id,
        token_type: record.token_type,
        role: record.role,
        label: record.label,
        auto_rotate: record.auto_rotate,
      },
    });
    return json(201, {
      ok: true,
      token: issued.token,
      record: publicTokenRecord(record),
    });
  }

  if (method === 'POST' && pathname === '/api/tokens/auto-rotate') {
    const principal = authorize(req, store, 'admin', context);
    if (!principal) {
      return json(403, { ok: false, error: 'forbidden' });
    }
    const parsed = await parseObjectBody(req);
    if (!parsed.ok) {
      return json(400, { ok: false, error: parsed.error });
    }
    const limit = parsePositiveInt(parsed.body.limit) ?? 20;
    const due = store.listTokensDueForAutoRotate({
      tenant_id: principal.tenant_id,
      limit,
    });

    const rotated = due.map((record) => {
      const next = rotateStoredToken(store, record, 'auto_rotated');
      store.addAuditLog({
        tenant_id: record.tenant_id,
        site_id: null,
        actor: principal.token,
        event_type: 'auth.token.rotated',
        payload: {
          trigger: 'batch_auto_rotate',
          from_token_id: record.id,
          to_token_id: next.record.id,
          token_type: record.token_type,
        },
      });
      return {
        from_token_id: record.id,
        token: next.token,
        record: publicTokenRecord(next.record),
      };
    });

    return json(200, {
      ok: true,
      rotated_count: rotated.length,
      rotated,
    });
  }

  if (method === 'POST' && pathname.startsWith('/api/tokens/')) {
    const principal = authorize(req, store, 'admin', context);
    if (!principal) {
      return json(403, { ok: false, error: 'forbidden' });
    }
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length !== 4 || parts[0] !== 'api' || parts[1] !== 'tokens') {
      return json(404, { ok: false, error: 'not_found' });
    }
    const tokenId = parts[2];
    const op = parts[3];

    if (op === 'revoke') {
      const parsed = await parseObjectBody(req);
      if (!parsed.ok) {
        return json(400, { ok: false, error: parsed.error });
      }
      const reason =
        typeof parsed.body.reason === 'string' && parsed.body.reason.trim() !== ''
          ? parsed.body.reason.trim()
          : 'revoked';
      const revoked = store.revokeAuthToken({
        id: tokenId,
        tenant_id: principal.tenant_id,
        reason,
      });
      if (!revoked) {
        return json(404, { ok: false, error: 'token_not_found' });
      }
      store.addAuditLog({
        tenant_id: revoked.tenant_id,
        site_id: null,
        actor: principal.token,
        event_type: 'auth.token.revoked',
        payload: {
          token_id: revoked.id,
          reason,
        },
      });
      return json(200, { ok: true, record: publicTokenRecord(revoked) });
    }

    if (op === 'rotate') {
      const current = store.getAuthToken(tokenId);
      if (!current) {
        return json(404, { ok: false, error: 'token_not_found' });
      }
      if (principal.tenant_id !== '*' && current.tenant_id !== principal.tenant_id) {
        return json(403, { ok: false, error: 'tenant_scope_violation' });
      }
      if (current.status !== 'active') {
        return json(409, { ok: false, error: 'token_not_active' });
      }
      const rotated = rotateStoredToken(store, current, 'rotated');
      store.addAuditLog({
        tenant_id: current.tenant_id,
        site_id: null,
        actor: principal.token,
        event_type: 'auth.token.rotated',
        payload: {
          trigger: 'manual',
          from_token_id: current.id,
          to_token_id: rotated.record.id,
          token_type: current.token_type,
        },
      });
      return json(201, {
        ok: true,
        token: rotated.token,
        record: publicTokenRecord(rotated.record),
      });
    }
  }

  if (method === 'GET' && pathname === '/api/sites') {
    const principal = authorize(req, store, 'viewer', context);
    if (!principal) {
      return json(401, { ok: false, error: 'unauthorized' });
    }
    return json(200, { ok: true, sites: store.listSites(principal.tenant_id) });
  }

  if (method === 'POST' && pathname === '/api/sites') {
    const principal = authorize(req, store, 'admin', context);
    if (!principal) {
      return json(403, { ok: false, error: 'forbidden' });
    }
    const parsed = await parseObjectBody(req);
    if (!parsed.ok) {
      return json(400, { ok: false, error: parsed.error });
    }
    const body = parsed.body;

    const id = typeof body.id === 'string' ? body.id.trim() : '';
    const domain = typeof body.domain === 'string' ? body.domain.trim() : '';
    const panelType = typeof body.panel_type === 'string' ? body.panel_type.trim() : 'ai_vps_panel';
    const runtimeType = typeof body.runtime_type === 'string' ? body.runtime_type.trim() : 'php_generic';
    const tenantInput = typeof body.tenant_id === 'string' ? body.tenant_id.trim() : '';
    const tenantId = principal.tenant_id === '*' ? tenantInput || 'default' : principal.tenant_id;
    if (id === '' || domain === '') {
      return json(400, { ok: false, error: 'missing_id_or_domain' });
    }
    if (tenantInput !== '' && principal.tenant_id !== '*' && tenantInput !== principal.tenant_id) {
      return json(403, { ok: false, error: 'tenant_scope_violation' });
    }

    const site = store.saveSite({
      id,
      tenant_id: tenantId,
      domain,
      panel_type: panelType,
      runtime_type: runtimeType,
    });
    store.addAuditLog({
      tenant_id: site.tenant_id,
      site_id: site.id,
      actor: principal.token,
      event_type: 'site.created_or_updated',
      payload: {
        domain: site.domain,
        panel_type: site.panel_type,
        runtime_type: site.runtime_type,
      },
    });
    return json(201, { ok: true, site });
  }

  if (method === 'GET' && pathname === '/api/conversations') {
    const principal = authorize(req, store, 'viewer', context);
    if (!principal) {
      return json(401, { ok: false, error: 'unauthorized' });
    }

    const siteId = url.searchParams.get('site_id')?.trim() || undefined;
    return json(200, {
      ok: true,
      conversations: store.listConversations(principal.tenant_id, siteId),
    });
  }

  if (method === 'GET' && pathname.startsWith('/api/conversations/')) {
    const principal = authorize(req, store, 'viewer', context);
    if (!principal) {
      return json(401, { ok: false, error: 'unauthorized' });
    }
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'conversations' && parts[3] === 'messages') {
      const conversationId = parts[2];
      const conversation = store.getConversation(conversationId);
      if (!conversation) {
        return json(404, { ok: false, error: 'conversation_not_found' });
      }
      if (principal.tenant_id !== '*' && principal.tenant_id !== conversation.tenant_id) {
        return json(403, { ok: false, error: 'tenant_scope_violation' });
      }
      return json(200, {
        ok: true,
        conversation,
        messages: store.listChatMessages(conversationId),
      });
    }
  }

  if (method === 'POST' && pathname === '/api/chat/message') {
    const principal = authorize(req, store, 'operator', context);
    if (!principal) {
      return json(403, { ok: false, error: 'forbidden' });
    }
    const parsed = await parseObjectBody(req);
    if (!parsed.ok) {
      return json(400, { ok: false, error: parsed.error });
    }
    const body = parsed.body;

    const chatRequest: ChatRequest = {
      site_id: typeof body.site_id === 'string' ? body.site_id : '',
      message: typeof body.message === 'string' ? body.message : '',
      conversation_id: typeof body.conversation_id === 'string' ? body.conversation_id : undefined,
    };

    if (chatRequest.site_id.trim() === '' || chatRequest.message.trim() === '') {
      return json(400, { ok: false, error: 'missing_site_or_message' });
    }

    const site = store.getSite(chatRequest.site_id);
    if (!site) {
      return json(404, { ok: false, error: 'site_not_found' });
    }
    if (!siteAllowed(principal, site)) {
      return json(403, { ok: false, error: 'tenant_scope_violation' });
    }

    let conversation = null;
    if (chatRequest.conversation_id) {
      conversation = store.getConversation(chatRequest.conversation_id);
      if (!conversation) {
        return json(404, { ok: false, error: 'conversation_not_found' });
      }
      if (conversation.site_id !== site.id) {
        return json(400, { ok: false, error: 'conversation_site_mismatch' });
      }
      if (!siteAllowed(principal, site)) {
        return json(403, { ok: false, error: 'tenant_scope_violation' });
      }
      store.touchConversation(conversation.id, chatRequest.message);
    } else {
      conversation = store.createConversation({
        site_id: site.id,
        tenant_id: site.tenant_id,
        last_message: chatRequest.message,
      });
    }

    store.addChatMessage({
      conversation_id: conversation.id,
      role: 'user',
      content: chatRequest.message,
    });

    const response = planAgentResponse({
      ...chatRequest,
      conversation_id: conversation.id,
    });
    store.addChatMessage({
      conversation_id: conversation.id,
      role: 'assistant',
      content: response.assistant_message,
    });
    store.touchConversation(conversation.id, response.assistant_message);

    const queuedActions = response.actions.map((action) =>
      store.enqueueAction({
        action,
        conversation_id: conversation.id,
        site_id: site.id,
        tenant_id: site.tenant_id,
      }),
    );
    store.addAuditLog({
      tenant_id: site.tenant_id,
      site_id: site.id,
      actor: principal.token,
      event_type: 'chat.message',
      payload: {
        conversation_id: conversation.id,
        message: chatRequest.message,
        queued_action_ids: queuedActions.map((action) => action.id),
      },
    });

    return json(200, {
      ...response,
      conversation_id: conversation.id,
      site,
      actions: queuedActions,
    });
  }

  if (method === 'GET' && pathname === '/api/actions') {
    const principal = authorize(req, store, 'viewer', context);
    if (!principal) {
      return json(401, { ok: false, error: 'unauthorized' });
    }

    const status = parseActionStatus(url.searchParams.get('status'));
    const siteId = url.searchParams.get('site_id')?.trim() || undefined;
    const conversationId = url.searchParams.get('conversation_id')?.trim() || undefined;
    const actions = store.listActions({
      tenant_id: principal.tenant_id,
      status,
      site_id: siteId,
      conversation_id: conversationId,
    });
    return json(200, { ok: true, actions });
  }

  if (method === 'GET' && pathname === '/api/audit') {
    const principal = authorize(req, store, 'viewer', context);
    if (!principal) {
      return json(401, { ok: false, error: 'unauthorized' });
    }
    const siteId = url.searchParams.get('site_id')?.trim() || undefined;
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '100', 10);
    return json(200, {
      ok: true,
      logs: store.listAuditLogs({
        tenant_id: principal.tenant_id,
        site_id: siteId,
        limit: Number.isFinite(limit) ? limit : 100,
      }),
    });
  }

  if (method === 'POST' && pathname.startsWith('/api/actions/')) {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'actions' && parts[3] === 'approve') {
      const principal = authorize(req, store, 'admin', context);
      if (!principal) {
        return json(403, { ok: false, error: 'forbidden' });
      }
      const actionId = parts[2];
      const action = store.approveAction({
        id: actionId,
        actor: principal.token,
        tenant_id: principal.tenant_id,
      });
      if (!action) {
        return json(404, { ok: false, error: 'action_not_found' });
      }
      store.addAuditLog({
        tenant_id: action.tenant_id,
        site_id: action.site_id,
        actor: principal.token,
        event_type: 'action.approved',
        payload: {
          action_id: action.id,
          status: action.status,
        },
      });
      return json(200, { ok: true, action });
    }

    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'actions' && parts[3] === 'execute') {
      const principal = authorize(req, store, 'operator', context);
      if (!principal) {
        return json(403, { ok: false, error: 'forbidden' });
      }
      const actionId = parts[2];
      const action = store.getAction(actionId);
      if (!action) {
        return json(404, { ok: false, error: 'action_not_found' });
      }
      if (principal.tenant_id !== '*' && principal.tenant_id !== action.tenant_id) {
        return json(403, { ok: false, error: 'tenant_scope_violation' });
      }
      if (action.status !== 'approved' && action.risk !== 'low') {
        return json(409, { ok: false, error: 'action_not_approved' });
      }

      const parsed = await parseObjectBody(req);
      if (!parsed.ok) {
        return json(400, { ok: false, error: parsed.error });
      }
      const body = parsed.body;
      const dryRun = typeof body.dry_run === 'boolean' ? body.dry_run : true;
      const confirmed = typeof body.confirmed === 'boolean' ? body.confirmed : false;

      const execute = await executor.execute(queuedToAgentAction(action), {
        dryRun,
        confirmed,
      });

      const site = store.getSite(action.site_id);
      if (!site) {
        return json(404, { ok: false, error: 'site_not_found' });
      }

      if (execute.ok) {
        const workerSync = await syncWorkerAfterAction({
          site,
          action: queuedToAgentAction(action),
          executeResult: execute,
        });
        execute.worker_sync = workerSync;
      }

      const nextStatus: ActionStatus = execute.ok ? 'executed' : 'failed';
      store.recordActionExecution({
        id: action.id,
        actor: principal.token,
        tenant_id: principal.tenant_id,
        status: nextStatus,
        execute_result: execute as unknown as Record<string, unknown>,
      });
      store.addAuditLog({
        tenant_id: action.tenant_id,
        site_id: action.site_id,
        actor: principal.token,
        event_type: 'action.executed',
        payload: {
          action_id: action.id,
          status: nextStatus,
          ok: execute.ok,
          dry_run: execute.dry_run,
        },
      });
      return json(execute.ok ? 200 : 400, execute);
    }
  }

  if (method === 'POST' && pathname === '/api/agent/execute') {
    const principal = authorize(req, store, 'operator', context);
    if (!principal) {
      return json(403, { ok: false, error: 'forbidden' });
    }
    const parsed = await parseObjectBody(req);
    if (!parsed.ok) {
      return json(400, { ok: false, error: parsed.error });
    }
    const body = parsed.body;

    const request: ExecuteActionRequest = {
      site_id: typeof body.site_id === 'string' ? body.site_id.trim() : '',
      action: body.action as ExecuteActionRequest['action'],
      dry_run: typeof body.dry_run === 'boolean' ? body.dry_run : true,
      confirmed: typeof body.confirmed === 'boolean' ? body.confirmed : false,
    };

    if (request.site_id === '' || !request.action || typeof request.action !== 'object') {
      return json(400, { ok: false, error: 'missing_site_or_action' });
    }

    const site = store.getSite(request.site_id);
    if (!site) {
      return json(404, { ok: false, error: 'site_not_found' });
    }
    if (!siteAllowed(principal, site)) {
      return json(403, { ok: false, error: 'tenant_scope_violation' });
    }

    const result = await executor.execute(request.action, {
      dryRun: request.dry_run,
      confirmed: request.confirmed,
    });

    if (result.ok) {
      const workerSync = await syncWorkerAfterAction({
        site,
        action: request.action,
        executeResult: result,
      });
      result.worker_sync = workerSync;
    }
    store.addAuditLog({
      tenant_id: site.tenant_id,
      site_id: site.id,
      actor: principal.token,
      event_type: 'action.executed_direct',
      payload: {
        action_id: request.action.id,
        type: request.action.type,
        ok: result.ok,
        dry_run: result.dry_run,
      },
    });

    const status = result.ok ? 200 : 400;
    return json(status, result);
  }

  return json(404, { ok: false, error: 'not_found' });
}

export function createServer(): http.Server {
  const store = createStore();
  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (method === 'GET' && !url.pathname.startsWith('/api/')) {
        const staticResponse = await serveStatic(url.pathname);
        if (staticResponse) {
          sendRaw(res, staticResponse);
          return;
        }
      }

      const context: RequestContext = {};
      const response = await route(req, store, context);
      if (context.rotated_token) {
        response.headers = {
          ...(response.headers ?? {}),
          'x-rotated-api-key': context.rotated_token,
        };
      }
      send(res, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'internal_error';
      send(res, json(500, { ok: false, error: message }));
    }
  });
  server.on('close', () => {
    store.close();
  });
  return server;
}

if (process.argv[1] && process.argv[1].endsWith('/server.js')) {
  const port = Number.parseInt(process.env.PORT ?? '8080', 10);
  const server = createServer();
  server.listen(port, () => {
    process.stdout.write(`ai-vps-control-panel listening on :${port}\n`);
  });
}
