import fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { planAgentResponse } from './agent/planner.js';
import { authenticate, isAllowed } from './auth/apiKeys.js';
import { defaultRotateAfterIso, issueTokenSecret, rotateStoredToken } from './auth/tokenLifecycle.js';
import { SafeCommandExecutor } from './commands/executor.js';
import { defaultPluginIdForSite, syncBillingSubscriptionToWorker } from './integration/workerBillingSync.js';
import { syncWorkerAfterAction } from './integration/workerSync.js';
import { createStore } from './store/index.js';
import type {
  ActionStatus,
  AgentAction,
  AgentActionType,
  ApiPrincipal,
  AuthTokenRecord,
  BillingStatus,
  ChatRequest,
  ExecuteActionRequest,
  PolicyTemplateRecord,
  QueuedActionRecord,
  RiskLevel,
  Role,
  SitePolicyBindingRecord,
  SiteRecord,
  TokenType,
} from './types.js';

interface JsonResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string | string[]>;
}

interface RequestContext {
  rotated_token?: string;
  set_cookies?: string[];
}

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const CONSOLE_SESSION_COOKIE = 'ai_vps_console_session';
const CONSOLE_CSRF_COOKIE = 'ai_vps_console_csrf';
const CONSOLE_CSRF_HEADER = 'x-csrf-token';
const rateLimitState = new Map<string, number[]>();

const executor = new SafeCommandExecutor();

interface ScriptContractIssue {
  script: string;
  path: string;
  issue: string;
}

function hostScriptPathSpecs(): Array<{ script: string; env: string; fallback: string }> {
  return [
    { script: 'watchdog-heartbeat', env: 'AI_VPS_WATCHDOG_SCRIPT_PATH', fallback: '/root/watchdog-heartbeat.sh' },
    { script: 'snapshot-site', env: 'AI_VPS_SNAPSHOT_SCRIPT_PATH', fallback: '/root/snapshot-site.sh' },
    { script: 'plan-upgrade', env: 'AI_VPS_PLAN_UPGRADE_SCRIPT_PATH', fallback: '/root/plan-upgrade.sh' },
    { script: 'verify-upgrade', env: 'AI_VPS_VERIFY_UPGRADE_SCRIPT_PATH', fallback: '/root/verify-upgrade.sh' },
    { script: 'rollback-upgrade', env: 'AI_VPS_ROLLBACK_UPGRADE_SCRIPT_PATH', fallback: '/root/rollback-upgrade.sh' },
    { script: 'run-security-scan', env: 'AI_VPS_RUN_SECURITY_SCAN_SCRIPT_PATH', fallback: '/root/run-security-scan.sh' },
    { script: 'rotate-secrets', env: 'AI_VPS_ROTATE_SECRETS_SCRIPT_PATH', fallback: '/root/rotate-secrets.sh' },
  ];
}

function resolvedScriptPath(envName: string, fallback: string): string {
  const raw = process.env[envName];
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw.trim();
  }
  return fallback;
}

function evaluateScriptContract(): { issues: ScriptContractIssue[]; strict: boolean } {
  const strict = process.env.AI_VPS_STRICT_SCRIPT_CHECKS === 'true';
  const issues: ScriptContractIssue[] = [];

  for (const spec of hostScriptPathSpecs()) {
    const scriptPath = resolvedScriptPath(spec.env, spec.fallback);
    if (!fsSync.existsSync(scriptPath)) {
      issues.push({ script: spec.script, path: scriptPath, issue: 'missing' });
      continue;
    }
    try {
      fsSync.accessSync(scriptPath, fsSync.constants.X_OK);
    } catch {
      issues.push({ script: spec.script, path: scriptPath, issue: 'not_executable' });
      continue;
    }
    try {
      const stat = fsSync.statSync(scriptPath);
      if (!stat.isFile()) {
        issues.push({ script: spec.script, path: scriptPath, issue: 'not_regular_file' });
        continue;
      }
      if ((stat.mode & 0o002) !== 0) {
        issues.push({ script: spec.script, path: scriptPath, issue: 'world_writable' });
      }
    } catch {
      issues.push({ script: spec.script, path: scriptPath, issue: 'stat_failed' });
    }
  }

  return { issues, strict };
}

function sessionDurationMs(): number {
  const parsed = Number.parseInt(process.env.AI_VPS_CONSOLE_SESSION_HOURS ?? '168', 10);
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= 24 * 90) {
    return parsed * 60 * 60 * 1000;
  }
  return 7 * 24 * 60 * 60 * 1000;
}

function getConsoleCredentials(): { email: string; password: string; role: Role; tenant_id: string } | null {
  const email = process.env.AI_VPS_CONSOLE_EMAIL?.trim() || 'owner@loccount.local';
  const password = process.env.AI_VPS_CONSOLE_PASSWORD?.trim() || '';
  if (password === '') {
    return null;
  }
  const role = parseRole(process.env.AI_VPS_CONSOLE_ROLE?.trim() || 'admin');
  const tenantId = process.env.AI_VPS_CONSOLE_TENANT?.trim() || '*';
  return { email, password, role, tenant_id: tenantId };
}

function secureCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function parseCookies(req: http.IncomingMessage): Map<string, string> {
  const header = req.headers.cookie;
  const cookies = new Map<string, string>();
  if (typeof header !== 'string' || header.trim() === '') {
    return cookies;
  }
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) {
      continue;
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key !== '') {
      cookies.set(key, decodeURIComponent(value));
    }
  }
  return cookies;
}

function sessionCookieValue(sessionId: string, maxAgeSeconds: number): string {
  return `${CONSOLE_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function csrfCookieValue(csrfToken: string, maxAgeSeconds: number): string {
  return `${CONSOLE_CSRF_COOKIE}=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function sessionCookieHeaders(sessionId: string, csrfToken: string, maxAgeSeconds: number): string[] {
  return [sessionCookieValue(sessionId, maxAgeSeconds), csrfCookieValue(csrfToken, maxAgeSeconds)];
}

function expiredSessionCookieValue(): string {
  return `${CONSOLE_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function expiredCsrfCookieValue(): string {
  return `${CONSOLE_CSRF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`;
}

function randomCsrfToken(): string {
  return randomUUID().replace(/-/g, '');
}

function sessionRotateIntervalMs(): number {
  const parsed = Number.parseFloat(process.env.AI_VPS_SESSION_ROTATE_MINUTES ?? '30');
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 24 * 60) {
    return Math.floor(parsed * 60 * 1000);
  }
  return 30 * 60 * 1000;
}

function readHeaderValue(req: http.IncomingMessage, headerName: string): string {
  const value = req.headers[headerName];
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value) && value.length > 0) {
    return value[0]?.trim() ?? '';
  }
  return '';
}

function isMutatingMethod(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

function isPublicMutation(pathname: string): boolean {
  return (
    pathname === '/api/leads' ||
    pathname === '/api/billing/checkout-session' ||
    pathname === '/api/stripe/webhook' ||
    pathname === '/api/session/login'
  );
}

function requiresSessionCsrf(method: string, pathname: string): boolean {
  if (!isMutatingMethod(method)) {
    return false;
  }
  if (!pathname.startsWith('/api/')) {
    return false;
  }
  return !isPublicMutation(pathname);
}

function ipAddress(req: http.IncomingMessage): string {
  const forwarded = readHeaderValue(req, 'x-forwarded-for');
  if (forwarded !== '') {
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }
  const remote = req.socket.remoteAddress;
  return typeof remote === 'string' && remote.trim() !== '' ? remote.trim() : 'unknown';
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (typeof raw !== 'string' || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function rateLimitRule(method: string, pathname: string): { scope: string; limit: number; windowMs: number } | null {
  if (!isMutatingMethod(method) || !pathname.startsWith('/api/')) {
    return null;
  }
  if (pathname === '/api/stripe/webhook') {
    return null;
  }
  if (pathname === '/api/session/login') {
    return {
      scope: 'login',
      limit: parsePositiveIntEnv('AI_VPS_RATE_LIMIT_LOGIN_MAX', 8),
      windowMs: parsePositiveIntEnv('AI_VPS_RATE_LIMIT_LOGIN_WINDOW_MS', 60_000),
    };
  }
  if (pathname === '/api/agent/execute' || /\/api\/actions\/[^/]+\/execute$/.test(pathname)) {
    return {
      scope: 'execute',
      limit: parsePositiveIntEnv('AI_VPS_RATE_LIMIT_EXECUTE_MAX', 30),
      windowMs: parsePositiveIntEnv('AI_VPS_RATE_LIMIT_EXECUTE_WINDOW_MS', 60_000),
    };
  }
  return {
    scope: 'mutate',
    limit: parsePositiveIntEnv('AI_VPS_RATE_LIMIT_MUTATION_MAX', 120),
    windowMs: parsePositiveIntEnv('AI_VPS_RATE_LIMIT_MUTATION_WINDOW_MS', 60_000),
  };
}

function consumeRateLimit(input: { key: string; limit: number; windowMs: number }): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const cutoff = now - input.windowMs;
  const existing = rateLimitState.get(input.key) ?? [];
  const active = existing.filter((entry) => entry > cutoff);
  if (active.length >= input.limit) {
    const oldest = active[0] ?? now;
    const retryAfter = Math.max(1, Math.ceil((oldest + input.windowMs - now) / 1000));
    rateLimitState.set(input.key, active);
    return { ok: false, retryAfter };
  }
  active.push(now);
  rateLimitState.set(input.key, active);
  return { ok: true };
}

function sessionPrincipalFromRecord(session: { id: string; role: Role; tenant_id: string; email: string }): ApiPrincipal {
  return {
    type: 'session',
    token_id: session.id,
    token_type: null,
    token: `session:${session.email}`,
    role: session.role,
    tenant_id: session.tenant_id,
    scopes: ['*'],
  };
}

function json(status: number, body: unknown, headers?: Record<string, string | string[]>): JsonResponse {
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
  const raw = await readRawBody(req);
  if (raw.trim() === '') {
    return {};
  }
  return JSON.parse(raw);
}

async function readRawBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
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

async function authorize(
  req: http.IncomingMessage,
  store: ReturnType<typeof createStore>,
  role: Role,
  context: RequestContext,
): Promise<ApiPrincipal | null> {
  const cookies = parseCookies(req);
  let principal = await authenticate(req, store);
  if (!principal) {
    const sessionId = cookies.get(CONSOLE_SESSION_COOKIE) ?? '';
    if (sessionId !== '') {
      const session = store.getConsoleSession(sessionId);
      const now = Date.now();
      if (session && !session.revoked_at && Date.parse(session.expires_at) > now) {
        const touched = store.touchConsoleSession(session.id) ?? session;
        let nextSession = touched;
        const rotateInterval = sessionRotateIntervalMs();
        const lastUsedMs = Date.parse(session.last_used_at ?? session.created_at);
        if (rotateInterval === 0 || (Number.isFinite(lastUsedMs) && now - lastUsedMs >= rotateInterval)) {
          const rotated = store.rotateConsoleSession({
            id: session.id,
            expires_at: new Date(now + sessionDurationMs()).toISOString(),
          });
          if (rotated) {
            nextSession = rotated;
            const maxAgeSeconds = Math.max(60, Math.floor((Date.parse(rotated.expires_at) - now) / 1000));
            const csrfToken = randomCsrfToken();
            context.set_cookies = sessionCookieHeaders(rotated.id, csrfToken, maxAgeSeconds);
          }
        }
        principal = sessionPrincipalFromRecord(nextSession);
      }
    }
  }
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

function redactSensitiveText(value: string): string {
  if (value.trim() === '') {
    return value;
  }
  let redacted = value;
  const patterns: Array<[RegExp, string]> = [
    [/"secret"\s*:\s*"[^"]+"/gi, '"secret":"[REDACTED]"'],
    [/(Bearer\s+)[A-Za-z0-9._\-+/=]+/gi, '$1[REDACTED]'],
    [/\b(sk_(live|test)_[A-Za-z0-9]+)\b/g, '[REDACTED]'],
    [/\b(tk_[A-Za-z0-9]+)\b/g, '[REDACTED]'],
    [/\b(tok_[A-Za-z0-9]+)\b/g, '[REDACTED]'],
    [/\b(password|passwd|api[_-]?key|token|secret)\s*[:=]\s*[^\s"']+/gi, '$1=[REDACTED]'],
  ];
  for (const [pattern, replacement] of patterns) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

function sanitizeExecuteResult<T extends { stdout?: string; stderr?: string }>(result: T): T {
  const copy = { ...result };
  if (typeof copy.stdout === 'string') {
    copy.stdout = redactSensitiveText(copy.stdout);
  }
  if (typeof copy.stderr === 'string') {
    copy.stderr = redactSensitiveText(copy.stderr);
  }
  return copy;
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

function staticRouteToFile(pathname: string): string | null {
  const normalized = pathname.trim();
  if (normalized === '/' || normalized === '') {
    return '/index.html';
  }
  if (normalized === '/console') {
    return '/console.html';
  }
  if (normalized === '/pricing') {
    return '/pricing.html';
  }

  const productRoutes = new Set([
    '/ai-addwords-meta',
    '/seo-traffic',
    '/ai-webadmin',
    '/cache-ops',
    '/hosting-ops',
    '/sitebuilder',
    '/tolldns',
    '/ai-vps-control-panel',
  ]);

  if (productRoutes.has(normalized)) {
    return '/product.html';
  }

  if (['.html', '.js', '.css'].some((ext) => normalized.endsWith(ext))) {
    return normalized;
  }

  return null;
}

async function serveStatic(pathname: string): Promise<{ status: number; contentType: string; body: Buffer } | null> {
  const normalized = staticRouteToFile(pathname);
  if (!normalized) {
    return null;
  }
  if (normalized.includes('..')) {
    return {
      status: 400,
      contentType: 'text/plain; charset=utf-8',
      body: Buffer.from('bad_request'),
    };
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

function parseRiskLevel(value: unknown): RiskLevel {
  if (value === 'low' || value === 'medium' || value === 'high') {
    return value;
  }
  return 'medium';
}

function riskLevelScore(risk: RiskLevel): number {
  if (risk === 'high') {
    return 3;
  }
  if (risk === 'medium') {
    return 2;
  }
  return 1;
}

function parseActionType(value: unknown): AgentActionType | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw === '') {
    return null;
  }
  const allowed = new Set<AgentActionType>([
    'check_service_status',
    'restart_service',
    'tail_service_logs',
    'run_site_snapshot',
    'plan_site_upgrade',
    'verify_site_upgrade',
    'rollback_site_upgrade',
    'run_security_scan',
    'rotate_secret',
    'switch_load_balancer_mode',
    'noop',
  ]);
  if (!allowed.has(raw as AgentActionType)) {
    return null;
  }
  return raw as AgentActionType;
}

function parseStringArrayOrEmpty(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item !== '');
}

function pathStartsWithAllowedPrefix(value: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => {
    const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    return value === normalized || value.startsWith(prefix);
  });
}

function parsePathRuleMap(value: unknown): Record<string, string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const source = value as Record<string, unknown>;
  const mapped: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(source)) {
    const entries = parseStringArrayOrEmpty(raw);
    if (entries.length > 0) {
      mapped[key] = entries;
    }
  }
  return mapped;
}

function enforceManualQueueGuardrails(
  action: AgentAction,
  templates: PolicyTemplateRecord[],
): { ok: true } | { ok: false; error: string; details: string } {
  for (const template of templates) {
    const policy = parseJsonObjectValue((template.config as Record<string, unknown>).manual_queue);
    if (Object.keys(policy).length === 0) {
      continue;
    }

    const allowedTypes = parseStringArrayOrEmpty(policy.allowed_action_types);
    if (allowedTypes.length > 0 && !allowedTypes.includes(action.type)) {
      return {
        ok: false,
        error: 'policy_guardrail_violation',
        details: `template:${template.name}:action_type_not_allowed`,
      };
    }

    const maxRisk = parseRiskLevel(policy.max_risk);
    if (riskLevelScore(action.risk) > riskLevelScore(maxRisk)) {
      return {
        ok: false,
        error: 'policy_guardrail_violation',
        details: `template:${template.name}:risk_exceeds_max`,
      };
    }

    const requireConfirmationFor = parseStringArrayOrEmpty(policy.require_confirmation_for);
    if (requireConfirmationFor.includes(action.type) && !action.requires_confirmation) {
      return {
        ok: false,
        error: 'policy_guardrail_violation',
        details: `template:${template.name}:confirmation_required`,
      };
    }

    const argPathPrefixes = parsePathRuleMap(policy.arg_path_prefixes);
    for (const [argKey, prefixes] of Object.entries(argPathPrefixes)) {
      const value = action.args[argKey];
      if (typeof value !== 'string' || value.trim() === '') {
        continue;
      }
      if (!pathStartsWithAllowedPrefix(value.trim(), prefixes)) {
        return {
          ok: false,
          error: 'policy_guardrail_violation',
          details: `template:${template.name}:arg_path_prefix_violation:${argKey}`,
        };
      }
    }
  }

  return { ok: true };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort((a, b) => a.localeCompare(b))) {
      out[key] = stableValue(source[key]);
    }
    return out;
  }
  return value;
}

function policyHashForTemplates(templates: PolicyTemplateRecord[]): string {
  const normalized = templates
    .map((template) => ({
      id: template.id,
      name: template.name,
      category: template.category,
      config: stableValue(template.config),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const jsonValue = JSON.stringify(normalized);
  return createHash('sha256').update(jsonValue).digest('hex');
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

function parseNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.floor(value);
  if (rounded < 0) {
    return null;
  }
  return rounded;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
      return true;
    }
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
      return false;
    }
  }
  return fallback;
}

function parseBillingStatus(value: unknown): BillingStatus | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (
    normalized === 'active' ||
    normalized === 'trialing' ||
    normalized === 'past_due' ||
    normalized === 'canceled' ||
    normalized === 'unpaid'
  ) {
    return normalized;
  }
  return null;
}

function isFutureIso(value: string | null): boolean {
  if (!value || value.trim() === '') {
    return false;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return false;
  }
  return parsed >= Date.now();
}

function isSandboxAllowedBySubscription(input: {
  status: BillingStatus;
  sandbox_enabled: boolean;
  grace_period_end: string | null;
}): boolean {
  if (!input.sandbox_enabled) {
    return false;
  }
  if (input.status === 'active' || input.status === 'trialing') {
    return true;
  }
  if (input.status === 'past_due' && isFutureIso(input.grace_period_end)) {
    return true;
  }
  return false;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item !== '');
}

function parseJsonObjectValue(value: unknown): Record<string, unknown> {
  if (!isObject(value)) {
    return {};
  }
  return value;
}

function riskLevelFromScore(score: number): 'low' | 'medium' | 'high' {
  if (score >= 7) {
    return 'high';
  }
  if (score >= 3.5) {
    return 'medium';
  }
  return 'low';
}

function isRecentIso(isoValue: string, cutoffMs: number): boolean {
  const parsed = Date.parse(isoValue);
  if (!Number.isFinite(parsed)) {
    return false;
  }
  return parsed >= cutoffMs;
}

function scoreSiteRisk(input: {
  site: SiteRecord;
  actions: QueuedActionRecord[];
  bindings: SitePolicyBindingRecord[];
  cutoffMs: number;
}): {
  site_id: string;
  domain: string;
  risk_score: number;
  risk_level: 'low' | 'medium' | 'high';
  pending_actions: number;
  pending_high_risk_actions: number;
  failed_actions_window: number;
  policy_templates: string[];
} {
  const pendingActions = input.actions.filter((item) => item.status === 'pending' || item.status === 'approved');
  const pendingHighRiskActions = pendingActions.filter((item) => item.risk === 'high');
  const failedActionsWindow = input.actions.filter(
    (item) => item.status === 'failed' && isRecentIso(item.created_at, input.cutoffMs),
  );

  const policyTemplates = Array.from(new Set(input.bindings.map((item) => item.template_name).filter(Boolean)));
  const policyCoverageBoost = policyTemplates.length > 0 ? 0.5 : 0;

  const rawScore =
    pendingActions.length * 0.6 +
    pendingHighRiskActions.length * 1.8 +
    failedActionsWindow.length * 2.1 -
    policyCoverageBoost;
  const riskScore = Number(Math.max(0, Math.min(10, rawScore)).toFixed(2));

  return {
    site_id: input.site.id,
    domain: input.site.domain,
    risk_score: riskScore,
    risk_level: riskLevelFromScore(riskScore),
    pending_actions: pendingActions.length,
    pending_high_risk_actions: pendingHighRiskActions.length,
    failed_actions_window: failedActionsWindow.length,
    policy_templates: policyTemplates,
  };
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

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function billingStatusFromStripeSubscription(value: string): BillingStatus {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'trialing') {
    return 'trialing';
  }
  if (normalized === 'past_due') {
    return 'past_due';
  }
  if (normalized === 'canceled' || normalized === 'incomplete_expired' || normalized === 'unpaid') {
    return 'canceled';
  }
  return 'active';
}

function pricingPlans(): Array<{
  code: string;
  name: string;
  monthly_price_usd: number;
  audience: string;
  summary: string;
  cta: string;
}> {
  return [
    {
      code: 'starter',
      name: 'Starter',
      monthly_price_usd: 299,
      audience: 'Single-site operators and early service businesses.',
      summary: 'Core console, 1 managed site, billing-aware sandbox, and launch support.',
      cta: 'Book a guided setup',
    },
    {
      code: 'growth',
      name: 'Growth',
      monthly_price_usd: 999,
      audience: 'Agencies and operators managing several revenue sites.',
      summary: 'Multi-site control, growth stack positioning, and faster operational rollout.',
      cta: 'Request a product walkthrough',
    },
    {
      code: 'control-plane',
      name: 'Control Plane',
      monthly_price_usd: 2499,
      audience: 'Teams standardizing operations across VPS fleets.',
      summary: 'Full control-plane model with Vault workflows, policy templates, and tenant operations.',
      cta: 'Talk to sales',
    },
  ];
}

function billingBadgeTone(status: BillingStatus): 'good' | 'warn' | 'bad' | 'neutral' {
  if (status === 'active' || status === 'trialing') {
    return 'good';
  }
  if (status === 'past_due') {
    return 'warn';
  }
  if (status === 'canceled' || status === 'unpaid') {
    return 'bad';
  }
  return 'neutral';
}

function stripeConfig():
  | {
      secretKey: string;
      webhookSecret: string;
      prices: Record<string, string>;
      successUrl: string;
      cancelUrl: string;
      portalReturnUrl: string;
    }
  | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim() || '';
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || '';
  const successUrl = process.env.STRIPE_SUCCESS_URL?.trim() || 'http://localhost:8080/pricing?checkout=success';
  const cancelUrl = process.env.STRIPE_CANCEL_URL?.trim() || 'http://localhost:8080/pricing?checkout=cancel';
  const portalReturnUrl = process.env.STRIPE_PORTAL_RETURN_URL?.trim() || 'http://localhost:8080/console?billing=portal';
  const prices: Record<string, string> = {};
  for (const plan of pricingPlans()) {
    const key = `STRIPE_PRICE_${plan.code.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
    const priceId = process.env[key]?.trim() || '';
    if (priceId !== '') {
      prices[plan.code] = priceId;
    }
  }
  if (secretKey === '' || webhookSecret === '') {
    return null;
  }
  return { secretKey, webhookSecret, prices, successUrl, cancelUrl, portalReturnUrl };
}

function formEncoded(data: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    params.append(key, value);
  }
  return params;
}

function parseStripeSignature(header: string): { timestamp: string; signatures: string[] } | null {
  const parts = header.split(',').map((item) => item.trim());
  let timestamp = '';
  const signatures: string[] = [];
  for (const part of parts) {
    const [key, value] = part.split('=', 2);
    if (key === 't') {
      timestamp = value ?? '';
    }
    if (key === 'v1' && value) {
      signatures.push(value);
    }
  }
  if (timestamp === '' || signatures.length === 0) {
    return null;
  }
  return { timestamp, signatures };
}

function verifyStripeWebhookSignature(rawBody: string, signatureHeader: string, webhookSecret: string): boolean {
  const parsed = parseStripeSignature(signatureHeader);
  if (!parsed) {
    return false;
  }
  const timestampMs = Number.parseInt(parsed.timestamp, 10) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
    return false;
  }
  const payload = `${parsed.timestamp}.${rawBody}`;
  const expected = createHmac('sha256', webhookSecret).update(payload).digest('hex');
  const expectedBuf = Buffer.from(expected);
  for (const signature of parsed.signatures) {
    const candidateBuf = Buffer.from(signature);
    if (candidateBuf.length === expectedBuf.length && timingSafeEqual(candidateBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

async function route(
  req: http.IncomingMessage,
  store: ReturnType<typeof createStore>,
  context: RequestContext,
  scriptContract: { issues: ScriptContractIssue[]; strict: boolean },
): Promise<JsonResponse> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;
  const cookies = parseCookies(req);

  const rule = rateLimitRule(method, pathname);
  if (rule) {
    const key = `${rule.scope}:${ipAddress(req)}`;
    const limited = consumeRateLimit({
      key,
      limit: rule.limit,
      windowMs: rule.windowMs,
    });
    if (!limited.ok) {
      return json(
        429,
        { ok: false, error: 'rate_limit_exceeded', scope: rule.scope, retry_after_seconds: limited.retryAfter },
        { 'retry-after': String(limited.retryAfter) },
      );
    }
  }

  if (requiresSessionCsrf(method, pathname) && cookies.get(CONSOLE_SESSION_COOKIE)) {
    const cookieToken = cookies.get(CONSOLE_CSRF_COOKIE) ?? '';
    const headerToken = readHeaderValue(req, CONSOLE_CSRF_HEADER);
    if (cookieToken === '' || headerToken === '' || !secureCompare(cookieToken, headerToken)) {
      return json(403, { ok: false, error: 'csrf_invalid' });
    }
  }

  if (method === 'GET' && pathname === '/health') {
    return json(200, {
      ok: true,
      service: 'ai-vps-control-panel',
      script_contract: {
        strict: scriptContract.strict,
        issues_count: scriptContract.issues.length,
        issues: scriptContract.issues,
      },
    });
  }

  if (method === 'GET' && pathname === '/api/pricing/plans') {
    return json(200, { ok: true, plans: pricingPlans() });
  }

  if (method === 'GET' && pathname === '/api/billing/public-status') {
    const siteId = url.searchParams.get('site_id')?.trim() || '';
    if (siteId === '') {
      return json(400, { ok: false, error: 'missing_site_id' });
    }
    const site = store.getSite(siteId);
    if (!site) {
      return json(404, { ok: false, error: 'site_not_found' });
    }
    const subscriptions = store.listBillingSubscriptions({
      tenant_id: site.tenant_id,
      limit: 500,
    });
    const subscription = subscriptions.find((item) => item.site_id === site.id);
    if (!subscription) {
      return json(404, { ok: false, error: 'billing_status_not_found' });
    }
    return json(200, {
      ok: true,
      billing: {
        site_id: site.id,
        domain: site.domain,
        plan_code: subscription.plan_code,
        status: subscription.status,
        sandbox_access_allowed: isSandboxAllowedBySubscription({
          status: subscription.status,
          sandbox_enabled: subscription.sandbox_enabled,
          grace_period_end: subscription.grace_period_end,
        }),
        badge_tone: billingBadgeTone(subscription.status),
        updated_at: subscription.updated_at,
      },
    });
  }

  if (method === 'POST' && pathname === '/api/leads') {
    const parsed = await parseObjectBody(req);
    if (!parsed.ok) {
      return json(400, { ok: false, error: parsed.error });
    }
    const body = parsed.body;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (name === '' || email === '' || !isEmailLike(email)) {
      return json(400, { ok: false, error: 'missing_name_or_valid_email' });
    }
    const lead = store.createLeadCapture({
      name,
      email,
      company: typeof body.company === 'string' ? body.company.trim() : null,
      source: typeof body.source === 'string' && body.source.trim() !== '' ? body.source.trim() : 'website',
      product_slug: typeof body.product_slug === 'string' ? body.product_slug.trim() : null,
      plan_code: typeof body.plan_code === 'string' ? body.plan_code.trim() : null,
      message: typeof body.message === 'string' ? body.message.trim() : null,
      status: 'new',
    });
    store.addAuditLog({
      tenant_id: '*',
      site_id: null,
      actor: `lead:${lead.email}`,
      event_type: 'lead.captured',
      payload: {
        lead_id: lead.id,
        source: lead.source,
        product_slug: lead.product_slug,
        plan_code: lead.plan_code,
      },
    });
    return json(201, { ok: true, lead });
  }

  if (method === 'POST' && pathname === '/api/billing/checkout-session') {
    const parsed = await parseObjectBody(req);
    if (!parsed.ok) {
      return json(400, { ok: false, error: parsed.error });
    }
    const config = stripeConfig();
    if (!config) {
      return json(503, { ok: false, error: 'stripe_not_configured' });
    }
    const body = parsed.body;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const planCode = typeof body.plan_code === 'string' ? body.plan_code.trim() : '';
    if (name === '' || email === '' || !isEmailLike(email) || planCode === '') {
      return json(400, { ok: false, error: 'missing_checkout_fields' });
    }
    const priceId = config.prices[planCode];
    if (!priceId) {
      return json(400, { ok: false, error: 'unknown_or_unpriced_plan' });
    }
    const tenantId = typeof body.tenant_id === 'string' && body.tenant_id.trim() !== '' ? body.tenant_id.trim() : 'default';
    const siteId = typeof body.site_id === 'string' && body.site_id.trim() !== '' ? body.site_id.trim() : null;
    if (siteId) {
      const site = store.getSite(siteId);
      if (!site) {
        return json(404, { ok: false, error: 'site_not_found' });
      }
    }
    const productSlug = typeof body.product_slug === 'string' && body.product_slug.trim() !== '' ? body.product_slug.trim() : 'ai-vps-control-panel';
    const company = typeof body.company === 'string' ? body.company.trim() : null;
    const message = typeof body.message === 'string' ? body.message.trim() : null;
    const lead = store.createLeadCapture({
      name,
      email,
      company,
      source: typeof body.source === 'string' && body.source.trim() !== '' ? body.source.trim() : 'stripe_checkout',
      product_slug: productSlug,
      plan_code: planCode,
      message,
      status: 'new',
    });
    const order = store.createStripeCheckoutOrder({
      tenant_id: tenantId,
      site_id: siteId,
      lead_id: lead.id,
      product_slug: productSlug,
      plan_code: planCode,
      status: 'created',
    });
    const pluginId = siteId ? defaultPluginIdForSite(siteId) : '';
    const params = formEncoded({
      mode: 'subscription',
      success_url: config.successUrl,
      cancel_url: config.cancelUrl,
      customer_email: email,
      client_reference_id: order.id,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      'metadata[order_id]': order.id,
      'metadata[lead_id]': lead.id,
      'metadata[tenant_id]': tenantId,
      'metadata[site_id]': siteId ?? '',
      'metadata[plan_code]': planCode,
      'metadata[product_slug]': productSlug,
      'metadata[plugin_id]': pluginId,
      'subscription_data[metadata][order_id]': order.id,
      'subscription_data[metadata][lead_id]': lead.id,
      'subscription_data[metadata][tenant_id]': tenantId,
      'subscription_data[metadata][site_id]': siteId ?? '',
      'subscription_data[metadata][plan_code]': planCode,
      'subscription_data[metadata][product_slug]': productSlug,
      'subscription_data[metadata][plugin_id]': pluginId,
    });
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    const text = await response.text();
    let stripeBody: Record<string, unknown> = {};
    try {
      stripeBody = JSON.parse(text) as Record<string, unknown>;
    } catch {
      stripeBody = { raw: text };
    }
    if (!response.ok) {
      return json(400, { ok: false, error: 'stripe_checkout_session_failed', details: stripeBody });
    }
    const checkoutOrder = store.updateStripeCheckoutOrder(order.id, {
      stripe_checkout_session_id:
        typeof stripeBody.id === 'string' ? stripeBody.id : null,
      checkout_url: typeof stripeBody.url === 'string' ? stripeBody.url : null,
      status: 'checkout_created',
    });
    store.addAuditLog({
      tenant_id: tenantId,
      site_id: siteId,
      actor: `checkout:${email}`,
      event_type: 'billing.checkout.session_created',
      payload: {
        order_id: order.id,
        lead_id: lead.id,
        plan_code: planCode,
        stripe_checkout_session_id: checkoutOrder?.stripe_checkout_session_id ?? null,
      },
    });
    return json(201, {
      ok: true,
      order: checkoutOrder,
      checkout_url: checkoutOrder?.checkout_url ?? null,
    });
  }

  if (method === 'GET' && pathname === '/api/billing/history') {
    const principal = await authorize(req, store, 'viewer', context);
    if (!principal) {
      return json(401, { ok: false, error: 'unauthorized' });
    }
    const siteId = url.searchParams.get('site_id')?.trim() || undefined;
    if (siteId) {
      const site = store.getSite(siteId);
      if (!site) {
        return json(404, { ok: false, error: 'site_not_found' });
      }
      if (!siteAllowed(principal, site)) {
        return json(403, { ok: false, error: 'tenant_scope_violation' });
      }
    }
    const status = url.searchParams.get('status')?.trim() || undefined;
    const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '100', 10);
    const orders = store.listStripeCheckoutOrders({
      tenant_id: principal.tenant_id,
      site_id: siteId,
      status,
      limit: Number.isFinite(limitRaw) ? limitRaw : 100,
    });
    const visibleTenant = principal.tenant_id;
    const siteIds = Array.from(new Set(orders.map((item) => item.site_id).filter((item): item is string => Boolean(item))));
    const domainBySiteId = new Map<string, string>();
    for (const orderSiteId of siteIds) {
      const site = store.getSite(orderSiteId);
      if (site && (visibleTenant === '*' || site.tenant_id === visibleTenant)) {
        domainBySiteId.set(site.id, site.domain);
      }
    }
    return json(200, {
      ok: true,
      orders: orders.map((item) => ({
        ...item,
        domain: item.site_id ? domainBySiteId.get(item.site_id) ?? null : null,
      })),
    });
  }

  if (method === 'GET' && pathname === '/api/billing/webhook-events') {
    const principal = await authorize(req, store, 'viewer', context);
    if (!principal) {
      return json(401, { ok: false, error: 'unauthorized' });
    }
    const siteId = url.searchParams.get('site_id')?.trim() || undefined;
    if (siteId) {
      const site = store.getSite(siteId);
      if (!site) {
        return json(404, { ok: false, error: 'site_not_found' });
      }
      if (!siteAllowed(principal, site)) {
        return json(403, { ok: false, error: 'tenant_scope_violation' });
      }
    }
    const statusRaw = url.searchParams.get('status')?.trim() || '';
    const status = statusRaw === 'processed' || statusRaw === 'failed' ? statusRaw : undefined;
    const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '100', 10);
    const events = store.listStripeWebhookEvents({
      tenant_id: principal.tenant_id,
      site_id: siteId,
      status,
      limit: Number.isFinite(limitRaw) ? limitRaw : 100,
    });
    return json(200, { ok: true, events });
  }

  if (method === 'POST' && pathname === '/api/billing/customer-portal-session') {
    const principal = await authorize(req, store, 'viewer', context);
    if (!principal) {
      return json(401, { ok: false, error: 'unauthorized' });
    }
    const parsed = await parseObjectBody(req);
    if (!parsed.ok) {
      return json(400, { ok: false, error: parsed.error });
    }
    const config = stripeConfig();
    if (!config) {
      return json(503, { ok: false, error: 'stripe_not_configured' });
    }
    const body = parsed.body;
    const siteId = typeof body.site_id === 'string' ? body.site_id.trim() : '';
    if (siteId === '') {
      return json(400, { ok: false, error: 'missing_site_id' });
    }
    const site = store.getSite(siteId);
    if (!site) {
      return json(404, { ok: false, error: 'site_not_found' });
    }
    if (!siteAllowed(principal, site)) {
      return json(403, { ok: false, error: 'tenant_scope_violation' });
    }
    const customerOrder = store
      .listStripeCheckoutOrders({
        tenant_id: principal.tenant_id,
        site_id: site.id,
        limit: 25,
      })
      .find((item) => item.stripe_customer_id);
    if (!customerOrder?.stripe_customer_id) {
      return json(404, { ok: false, error: 'billing_customer_not_found' });
    }

    const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: formEncoded({
        customer: customerOrder.stripe_customer_id,
        return_url: config.portalReturnUrl,
      }),
    });
    const text = await response.text();
    let stripeBody: Record<string, unknown> = {};
    try {
      stripeBody = JSON.parse(text) as Record<string, unknown>;
    } catch {
      stripeBody = { raw: text };
    }
    if (!response.ok) {
      return json(400, { ok: false, error: 'stripe_customer_portal_failed', details: stripeBody });
    }
    store.addAuditLog({
      tenant_id: site.tenant_id,
      site_id: site.id,
      actor: principal.token,
      event_type: 'billing.customer_portal.session_created',
      payload: {
        customer_id: customerOrder.stripe_customer_id,
        portal_url_present: typeof stripeBody.url === 'string',
      },
    });
    return json(201, {
      ok: true,
      url: typeof stripeBody.url === 'string' ? stripeBody.url : null,
      customer_id: customerOrder.stripe_customer_id,
      site_id: site.id,
    });
  }

  if (method === 'POST' && pathname === '/api/stripe/webhook') {
    const config = stripeConfig();
    if (!config) {
      return json(503, { ok: false, error: 'stripe_not_configured' });
    }
    const rawBody = await readRawBody(req);
    const signature = typeof req.headers['stripe-signature'] === 'string' ? req.headers['stripe-signature'] : '';
    if (!verifyStripeWebhookSignature(rawBody, signature, config.webhookSecret)) {
      return json(400, { ok: false, error: 'invalid_stripe_signature' });
    }
    const event = JSON.parse(rawBody) as {
      id?: string;
      type?: string;
      livemode?: boolean;
      data?: { object?: Record<string, unknown> };
    };
    const eventId = typeof event.id === 'string' ? event.id : '';
    const eventType = typeof event.type === 'string' ? event.type : '';
    const object = (event.data?.object ?? {}) as Record<string, unknown>;
    const eventMetadata = (object.metadata as Record<string, unknown> | undefined) ?? {};
    const eventTenantId =
      typeof eventMetadata.tenant_id === 'string' && eventMetadata.tenant_id.trim() !== ''
        ? eventMetadata.tenant_id
        : null;
    const eventSiteId =
      typeof eventMetadata.site_id === 'string' && eventMetadata.site_id.trim() !== ''
        ? eventMetadata.site_id
        : null;
    if (eventId === '') {
      return json(400, { ok: false, error: 'missing_stripe_event_id' });
    }
    const existingEvent = store.getStripeWebhookEventByEventId(eventId);
    if (existingEvent && existingEvent.status === 'processed') {
      return json(200, {
        ok: true,
        received: true,
        duplicate: true,
        stripe_event_id: existingEvent.stripe_event_id,
      });
    }

    try {
      if (eventType === 'checkout.session.completed') {
        const sessionId = typeof object.id === 'string' ? object.id : '';
        const metadata = (object.metadata as Record<string, unknown> | undefined) ?? {};
        const orderId = typeof metadata.order_id === 'string' ? metadata.order_id : '';
        const customerId = typeof object.customer === 'string' ? object.customer : null;
        const subscriptionId = typeof object.subscription === 'string' ? object.subscription : null;
        const order =
          (orderId !== '' ? store.getStripeCheckoutOrder(orderId) : null) ??
          (sessionId !== '' ? store.getStripeCheckoutOrderBySessionId(sessionId) : null);
        if (order) {
          store.updateStripeCheckoutOrder(order.id, {
            stripe_checkout_session_id: sessionId || order.stripe_checkout_session_id,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            status: 'checkout_completed',
            completed_at: new Date().toISOString(),
          });
          store.addAuditLog({
            tenant_id: order.tenant_id,
            site_id: order.site_id,
            actor: 'stripe:webhook',
            event_type: 'billing.checkout.completed',
            payload: {
              order_id: order.id,
              stripe_checkout_session_id: sessionId,
              stripe_subscription_id: subscriptionId,
            },
          });
        }
      }

      if (
        eventType === 'customer.subscription.created' ||
        eventType === 'customer.subscription.updated' ||
        eventType === 'customer.subscription.deleted'
      ) {
        const metadata = (object.metadata as Record<string, unknown> | undefined) ?? {};
        const subscriptionId = typeof object.id === 'string' ? object.id : '';
        const orderId = typeof metadata.order_id === 'string' ? metadata.order_id : '';
        const siteId = typeof metadata.site_id === 'string' && metadata.site_id.trim() !== '' ? metadata.site_id : null;
        const tenantId = typeof metadata.tenant_id === 'string' && metadata.tenant_id.trim() !== '' ? metadata.tenant_id : 'default';
        const planCode = typeof metadata.plan_code === 'string' && metadata.plan_code.trim() !== '' ? metadata.plan_code : 'growth';
        const pluginId = typeof metadata.plugin_id === 'string' ? metadata.plugin_id : '';
        const customerId = typeof object.customer === 'string' ? object.customer : null;
        const statusRaw = typeof object.status === 'string' ? object.status : 'active';
        const status = eventType === 'customer.subscription.deleted' ? 'canceled' : billingStatusFromStripeSubscription(statusRaw);
        const currentPeriodEndUnix =
          typeof object.current_period_end === 'number' && Number.isFinite(object.current_period_end)
            ? object.current_period_end
            : null;
        const currentPeriodEnd =
          currentPeriodEndUnix !== null ? new Date(currentPeriodEndUnix * 1000).toISOString() : null;
        const gracePeriodEnd = status === 'past_due' && currentPeriodEnd ? currentPeriodEnd : null;
        const order =
          (orderId !== '' ? store.getStripeCheckoutOrder(orderId) : null) ??
          (subscriptionId !== '' ? store.getStripeCheckoutOrderBySubscriptionId(subscriptionId) : null);
        if (order) {
          store.updateStripeCheckoutOrder(order.id, {
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            status: status,
            completed_at: order.completed_at ?? new Date().toISOString(),
          });
        }
        if (siteId) {
          const site = store.getSite(siteId);
          if (!site) {
            throw new Error(`stripe_webhook_site_not_found:${siteId}`);
          }
          const record = store.saveBillingSubscription({
            site_id: site.id,
            tenant_id: site.tenant_id,
            plugin_id: pluginId || defaultPluginIdForSite(site.id),
            plan_code: planCode,
            status,
            sandbox_enabled: status !== 'canceled' && status !== 'unpaid',
            current_period_end: currentPeriodEnd,
            grace_period_end: gracePeriodEnd,
            updated_by: 'stripe:webhook',
          });
          await syncBillingSubscriptionToWorker({
            site_id: record.site_id,
            plugin_id: record.plugin_id,
            plan_code: record.plan_code,
            status: record.status,
            sandbox_enabled: record.sandbox_enabled,
            current_period_end: record.current_period_end,
            grace_period_end: record.grace_period_end,
          });
          store.addAuditLog({
            tenant_id: site.tenant_id,
            site_id: site.id,
            actor: 'stripe:webhook',
            event_type: 'billing.subscription.stripe_synced',
            payload: {
              stripe_subscription_id: subscriptionId,
              status,
              plan_code: planCode,
            },
          });
        }
      }

      store.createStripeWebhookEvent({
        stripe_event_id: eventId,
        event_type: eventType || 'unknown',
        livemode: event.livemode === true,
        status: 'processed',
        tenant_id: eventTenantId,
        site_id: eventSiteId,
        payload: event as Record<string, unknown>,
      });
      return json(200, { ok: true, received: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'stripe_webhook_processing_failed';
      store.createStripeWebhookEvent({
        stripe_event_id: eventId,
        event_type: eventType || 'unknown',
        livemode: event.livemode === true,
        status: 'failed',
        tenant_id: eventTenantId,
        site_id: eventSiteId,
        payload: event as Record<string, unknown>,
        error_message: message,
      });
      store.addAuditLog({
        tenant_id: eventTenantId ?? '*',
        site_id: eventSiteId,
        actor: 'stripe:webhook',
        event_type: 'billing.webhook.failed',
        payload: {
          stripe_event_id: eventId,
          event_type: eventType || 'unknown',
          error: message,
        },
      });
      return json(500, { ok: false, error: message, stripe_event_id: eventId });
    }
  }

  if (method === 'POST' && pathname === '/api/session/login') {
    const parsed = await parseObjectBody(req);
    if (!parsed.ok) {
      return json(400, { ok: false, error: parsed.error });
    }
    const credentials = getConsoleCredentials();
    if (!credentials) {
      return json(503, { ok: false, error: 'console_login_not_configured' });
    }
    const body = parsed.body;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (
      !secureCompare(email, credentials.email.toLowerCase()) ||
      !secureCompare(password, credentials.password)
    ) {
      return json(401, { ok: false, error: 'invalid_credentials' });
    }
    store.revokeConsoleSessionsByEmail({
      email: credentials.email,
      tenant_id: credentials.tenant_id,
    });
    const expiresAt = new Date(Date.now() + sessionDurationMs()).toISOString();
    const session = store.createConsoleSession({
      email: credentials.email,
      role: credentials.role,
      tenant_id: credentials.tenant_id,
      expires_at: expiresAt,
    });
    const maxAgeSeconds = Math.max(60, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
    const csrfToken = randomCsrfToken();
    store.addAuditLog({
      tenant_id: session.tenant_id,
      site_id: null,
      actor: `session:${session.email}`,
      event_type: 'console.session.login',
      payload: {
        session_id: session.id,
      },
    });
    return json(
      200,
      {
        ok: true,
        session: {
          email: session.email,
          role: session.role,
          tenant_id: session.tenant_id,
          expires_at: session.expires_at,
        },
      },
      { 'set-cookie': sessionCookieHeaders(session.id, csrfToken, maxAgeSeconds) },
    );
  }

  if (method === 'POST' && pathname === '/api/session/logout') {
    const sessionId = parseCookies(req).get(CONSOLE_SESSION_COOKIE) ?? '';
    if (sessionId !== '') {
      const session = store.revokeConsoleSession(sessionId);
      if (session) {
        store.addAuditLog({
          tenant_id: session.tenant_id,
          site_id: null,
          actor: `session:${session.email}`,
          event_type: 'console.session.logout',
          payload: {
            session_id: session.id,
          },
        });
      }
    }
    return json(200, { ok: true }, { 'set-cookie': [expiredSessionCookieValue(), expiredCsrfCookieValue()] });
  }

  if (method === 'GET' && pathname === '/api/session/me') {
    const principal = await authorize(req, store, 'viewer', context);
    if (!principal) {
      return json(401, { ok: false, error: 'unauthorized' });
    }
    return json(200, {
      ok: true,
      session: {
        type: principal.type,
        role: principal.role,
        tenant_id: principal.tenant_id,
      },
    });
  }

  if (method === 'GET' && pathname === '/api/auth/me') {
    const principal = await authorize(req, store, 'viewer', context);
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

  if (method === 'GET' && pathname === '/api/leads') {
    const principal = await authorize(req, store, 'viewer', context);
    if (!principal) {
      return json(401, { ok: false, error: 'unauthorized' });
    }
    const status = url.searchParams.get('status')?.trim() || undefined;
    const source = url.searchParams.get('source')?.trim() || undefined;
    const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '200', 10);
    const leads = store.listLeadCaptures({
      status,
      source,
      limit: Number.isFinite(limitRaw) ? limitRaw : 200,
    });
    return json(200, { ok: true, leads });
  }

  if (method === 'GET' && pathname === '/api/tokens') {
    const principal = await authorize(req, store, 'admin', context);
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
    const principal = await authorize(req, store, 'admin', context);
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

    const issued = await issueTokenSecret(tokenType);
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
    const principal = await authorize(req, store, 'admin', context);
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

    const rotated = await Promise.all(
      due.map(async (record) => {
        const next = await rotateStoredToken(store, record, 'auto_rotated');
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
      }),
    );

    return json(200, {
      ok: true,
      rotated_count: rotated.length,
      rotated,
    });
  }

  if (method === 'POST' && pathname === '/api/tokens/publish-audit') {
    const principal = await authorize(req, store, 'admin', context);
    if (!principal) {
      return json(403, { ok: false, error: 'forbidden' });
    }
    const parsed = await parseObjectBody(req);
    if (!parsed.ok) {
      return json(400, { ok: false, error: parsed.error });
    }

    const body = parsed.body;
    const tenantId = resolveTenantScope(principal, body.tenant_id);
    if (!tenantId) {
      return json(403, { ok: false, error: 'tenant_scope_violation' });
    }

    const siteId = typeof body.site_id === 'string' && body.site_id.trim() !== '' ? body.site_id.trim() : null;
    const payload: Record<string, unknown> = {
      publisher: 'vault_kv',
      ok: typeof body.ok === 'boolean' ? body.ok : true,
      rotated_count: parseNonNegativeInt(body.rotated_count) ?? 0,
      active_token_count: parseNonNegativeInt(body.active_token_count) ?? 0,
      stale_token_count: parseNonNegativeInt(body.stale_token_count) ?? 0,
    };

    if (typeof body.vault_mount === 'string' && body.vault_mount.trim() !== '') {
      payload.vault_mount = body.vault_mount.trim();
    }
    if (typeof body.vault_path === 'string' && body.vault_path.trim() !== '') {
      payload.vault_path = body.vault_path.trim();
    }
    if (typeof body.vault_field === 'string' && body.vault_field.trim() !== '') {
      payload.vault_field = body.vault_field.trim();
    }
    if (typeof body.error === 'string' && body.error.trim() !== '') {
      payload.error = body.error.trim();
    }
    if (typeof body.note === 'string' && body.note.trim() !== '') {
      payload.note = body.note.trim();
    }

    const log = store.addAuditLog({
      tenant_id: tenantId,
      site_id: siteId,
      actor: principal.token,
      event_type: 'auth.token.publish',
      payload,
    });
    return json(201, { ok: true, log });
  }

  if (method === 'POST' && pathname.startsWith('/api/tokens/')) {
    const principal = await authorize(req, store, 'admin', context);
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
      const rotated = await rotateStoredToken(store, current, 'rotated');
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
    const principal = await authorize(req, store, 'viewer', context);
    if (!principal) {
      return json(401, { ok: false, error: 'unauthorized' });
    }
    return json(200, { ok: true, sites: store.listSites(principal.tenant_id) });
  }

  if (method === 'POST' && pathname === '/api/sites') {
    const principal = await authorize(req, store, 'admin', context);
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

  if (method === 'GET' && pathname === '/api/billing/subscriptions') {
    const principal = await authorize(req, store, 'viewer', context);
    if (!principal) {
      return json(401, { ok: false, error: 'unauthorized' });
    }

    const statusRaw = url.searchParams.get('status');
    const parsedStatus = statusRaw ? parseBillingStatus(statusRaw) : null;
    if (statusRaw && !parsedStatus) {
      return json(400, { ok: false, error: 'invalid_billing_status' });
    }
    const status = parsedStatus ?? undefined;
    const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '200', 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 200;

    const subscriptions = store.listBillingSubscriptions({
      tenant_id: principal.tenant_id,
      status,
      limit,
    });
    const sites = store.listSites(principal.tenant_id);
    const domainBySiteId = new Map<string, string>(sites.map((site) => [site.id, site.domain]));

    return json(200, {
      ok: true,
      subscriptions: subscriptions.map((item) => ({
        ...item,
        domain: domainBySiteId.get(item.site_id) ?? null,
        badge_tone: billingBadgeTone(item.status),
        sandbox_access_allowed: isSandboxAllowedBySubscription({
          status: item.status,
          sandbox_enabled: item.sandbox_enabled,
          grace_period_end: item.grace_period_end,
        }),
      })),
    });
  }

  if (method === 'POST' && pathname === '/api/billing/subscriptions') {
    const principal = await authorize(req, store, 'admin', context);
    if (!principal) {
      return json(403, { ok: false, error: 'forbidden' });
    }
    const parsed = await parseObjectBody(req);
    if (!parsed.ok) {
      return json(400, { ok: false, error: parsed.error });
    }
    const body = parsed.body;

    const siteId = typeof body.site_id === 'string' ? body.site_id.trim() : '';
    if (siteId === '') {
      return json(400, { ok: false, error: 'missing_site_id' });
    }
    const site = store.getSite(siteId);
    if (!site) {
      return json(404, { ok: false, error: 'site_not_found' });
    }
    if (!siteAllowed(principal, site)) {
      return json(403, { ok: false, error: 'tenant_scope_violation' });
    }

    const status = parseBillingStatus(body.status);
    if (!status) {
      return json(400, { ok: false, error: 'invalid_billing_status' });
    }

    const pluginIdRaw = typeof body.plugin_id === 'string' ? body.plugin_id.trim() : '';
    const pluginId = pluginIdRaw || defaultPluginIdForSite(site.id);
    const planCode =
      typeof body.plan_code === 'string' && body.plan_code.trim() !== ''
        ? body.plan_code.trim().slice(0, 120)
        : 'sandbox_monthly';
    const sandboxEnabled = parseBoolean(body.sandbox_enabled, true);
    const currentPeriodEnd = parseOptionalIso(body.current_period_end);
    const gracePeriodEnd = parseOptionalIso(body.grace_period_end);

    const record = store.saveBillingSubscription({
      site_id: site.id,
      tenant_id: site.tenant_id,
      plugin_id: pluginId,
      plan_code: planCode,
      status,
      sandbox_enabled: sandboxEnabled,
      current_period_end: currentPeriodEnd,
      grace_period_end: gracePeriodEnd,
      updated_by: principal.token,
    });

    const workerSync = await syncBillingSubscriptionToWorker({
      site_id: record.site_id,
      plugin_id: record.plugin_id,
      plan_code: record.plan_code,
      status: record.status,
      sandbox_enabled: record.sandbox_enabled,
      current_period_end: record.current_period_end,
      grace_period_end: record.grace_period_end,
    });

    store.addAuditLog({
      tenant_id: record.tenant_id,
      site_id: record.site_id,
      actor: principal.token,
      event_type: 'billing.subscription.updated',
      payload: {
        plugin_id: record.plugin_id,
        plan_code: record.plan_code,
        status: record.status,
        sandbox_enabled: record.sandbox_enabled,
        current_period_end: record.current_period_end,
        grace_period_end: record.grace_period_end,
        worker_sync_ok: workerSync.ok,
        worker_sync_skipped: workerSync.skipped ?? false,
      },
    });

    return json(201, {
      ok: true,
      subscription: {
        ...record,
        domain: site.domain,
        sandbox_access_allowed: isSandboxAllowedBySubscription({
          status: record.status,
          sandbox_enabled: record.sandbox_enabled,
          grace_period_end: record.grace_period_end,
        }),
      },
      worker_sync: workerSync,
    });
  }

  if (method === 'GET' && pathname === '/api/fleet/risk') {
    const principal = await authorize(req, store, 'viewer', context);
    if (!principal) {
      return json(401, { ok: false, error: 'unauthorized' });
    }

    const windowHoursRaw = Number.parseInt(url.searchParams.get('window_hours') ?? '24', 10);
    const windowHours = Number.isFinite(windowHoursRaw)
      ? Math.max(1, Math.min(24 * 14, windowHoursRaw))
      : 24;
    const cutoffMs = Date.now() - windowHours * 60 * 60 * 1000;

    const sites = store.listSites(principal.tenant_id);
    const allBindings = store.listSitePolicyBindings({
      tenant_id: principal.tenant_id,
      limit: 5000,
    });
    const bindingsBySite = new Map<string, SitePolicyBindingRecord[]>();
    for (const binding of allBindings) {
      if (!bindingsBySite.has(binding.site_id)) {
        bindingsBySite.set(binding.site_id, []);
      }
      bindingsBySite.get(binding.site_id)?.push(binding);
    }

    const siteRisk = sites.map((site) => {
      const actions = store.listActions({
        tenant_id: principal.tenant_id,
        site_id: site.id,
      });
      const bindings = bindingsBySite.get(site.id) ?? [];
      return scoreSiteRisk({
        site,
        actions,
        bindings,
        cutoffMs,
      });
    });

    const summary = {
      total_sites: siteRisk.length,
      high_risk_sites: siteRisk.filter((item) => item.risk_level === 'high').length,
      medium_risk_sites: siteRisk.filter((item) => item.risk_level === 'medium').length,
      low_risk_sites: siteRisk.filter((item) => item.risk_level === 'low').length,
      mean_risk_score:
        siteRisk.length > 0
          ? Number((siteRisk.reduce((sum, item) => sum + item.risk_score, 0) / siteRisk.length).toFixed(2))
          : 0,
    };

    return json(200, {
      ok: true,
      window_hours: windowHours,
      summary,
      sites: siteRisk,
    });
  }

  if (method === 'GET' && pathname === '/api/fleet/policies') {
    const principal = await authorize(req, store, 'viewer', context);
    if (!principal) {
      return json(401, { ok: false, error: 'unauthorized' });
    }

    const category = url.searchParams.get('category')?.trim() || undefined;
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '200', 10);
    const templates = store.listPolicyTemplates({
      tenant_id: principal.tenant_id,
      category,
      limit: Number.isFinite(limit) ? limit : 200,
    });
    const bindings = store.listSitePolicyBindings({
      tenant_id: principal.tenant_id,
      limit: 5000,
    });
    const bindingCountByTemplate = new Map<string, number>();
    for (const binding of bindings) {
      bindingCountByTemplate.set(
        binding.template_id,
        (bindingCountByTemplate.get(binding.template_id) ?? 0) + 1,
      );
    }

    return json(200, {
      ok: true,
      templates: templates.map((template) => ({
        ...template,
        applied_sites: bindingCountByTemplate.get(template.id) ?? 0,
      })),
    });
  }

  if (method === 'POST' && pathname === '/api/fleet/policies') {
    const principal = await authorize(req, store, 'admin', context);
    if (!principal) {
      return json(403, { ok: false, error: 'forbidden' });
    }
    const parsed = await parseObjectBody(req);
    if (!parsed.ok) {
      return json(400, { ok: false, error: parsed.error });
    }
    const body = parsed.body;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name === '') {
      return json(400, { ok: false, error: 'missing_name' });
    }

    const tenantId = resolveTenantScope(principal, body.tenant_id);
    if (!tenantId) {
      return json(403, { ok: false, error: 'tenant_scope_violation' });
    }
    const template = store.savePolicyTemplate({
      id: typeof body.id === 'string' ? body.id.trim() : undefined,
      tenant_id: tenantId,
      name,
      description: typeof body.description === 'string' ? body.description.trim() : '',
      category: typeof body.category === 'string' ? body.category.trim() : 'general',
      config: parseJsonObjectValue(body.config),
    });

    store.addAuditLog({
      tenant_id: tenantId,
      site_id: null,
      actor: principal.token,
      event_type: 'fleet.policy.saved',
      payload: {
        template_id: template.id,
        name: template.name,
        category: template.category,
      },
    });

    return json(201, { ok: true, template });
  }

  if (method === 'POST' && pathname.startsWith('/api/fleet/policies/')) {
    const principal = await authorize(req, store, 'admin', context);
    if (!principal) {
      return json(403, { ok: false, error: 'forbidden' });
    }
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'fleet' && parts[2] === 'policies' && parts[4] === 'apply') {
      const templateId = parts[3];
      const template = store.getPolicyTemplate(templateId);
      if (!template) {
        return json(404, { ok: false, error: 'policy_template_not_found' });
      }
      if (principal.tenant_id !== '*' && principal.tenant_id !== template.tenant_id) {
        return json(403, { ok: false, error: 'tenant_scope_violation' });
      }

      const parsed = await parseObjectBody(req);
      if (!parsed.ok) {
        return json(400, { ok: false, error: parsed.error });
      }
      const body = parsed.body;
      const applyAll = typeof body.apply_all === 'boolean' ? body.apply_all : false;
      const explicitSiteIds = parseStringArray(body.site_ids);
      const oneSiteId = typeof body.site_id === 'string' ? body.site_id.trim() : '';

      let targetSites: SiteRecord[] = [];
      if (applyAll) {
        targetSites = store.listSites(template.tenant_id);
      } else {
        const requested = oneSiteId !== '' ? [...explicitSiteIds, oneSiteId] : explicitSiteIds;
        const uniqueIds = Array.from(new Set(requested));
        if (uniqueIds.length === 0) {
          return json(400, { ok: false, error: 'missing_site_targets' });
        }
        for (const siteId of uniqueIds) {
          const site = store.getSite(siteId);
          if (!site) {
            return json(404, { ok: false, error: `site_not_found:${siteId}` });
          }
          if (site.tenant_id !== template.tenant_id) {
            return json(403, { ok: false, error: 'site_tenant_mismatch' });
          }
          targetSites.push(site);
        }
      }

      const status = typeof body.status === 'string' && body.status.trim() !== '' ? body.status.trim() : 'active';
      const notes = typeof body.notes === 'string' && body.notes.trim() !== '' ? body.notes.trim() : null;

      const bindings = targetSites.map((site) =>
        store.upsertSitePolicyBinding({
          tenant_id: template.tenant_id,
          site_id: site.id,
          template_id: template.id,
          status,
          applied_by: principal.token,
          notes,
        }),
      );

      store.addAuditLog({
        tenant_id: template.tenant_id,
        site_id: null,
        actor: principal.token,
        event_type: 'fleet.policy.applied',
        payload: {
          template_id: template.id,
          applied_sites: bindings.length,
          apply_all: applyAll,
          status,
        },
      });

      return json(200, {
        ok: true,
        template,
        applied_count: bindings.length,
        bindings,
      });
    }
  }

  if (method === 'GET' && pathname === '/api/conversations') {
    const principal = await authorize(req, store, 'viewer', context);
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
    const principal = await authorize(req, store, 'viewer', context);
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
    const principal = await authorize(req, store, 'operator', context);
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
    const principal = await authorize(req, store, 'viewer', context);
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

  if (method === 'POST' && pathname === '/api/actions/queue') {
    const principal = await authorize(req, store, 'operator', context);
    if (!principal) {
      return json(403, { ok: false, error: 'forbidden' });
    }

    const parsed = await parseObjectBody(req);
    if (!parsed.ok) {
      return json(400, { ok: false, error: parsed.error });
    }
    const body = parsed.body;

    const siteId = typeof body.site_id === 'string' ? body.site_id.trim() : '';
    const rawAction = typeof body.action === 'object' && body.action !== null ? body.action : null;
    if (siteId === '' || !rawAction) {
      return json(400, { ok: false, error: 'missing_site_or_action' });
    }

    const site = store.getSite(siteId);
    if (!site) {
      return json(404, { ok: false, error: 'site_not_found' });
    }
    if (!siteAllowed(principal, site)) {
      return json(403, { ok: false, error: 'tenant_scope_violation' });
    }

    const actionType = parseActionType((rawAction as Record<string, unknown>).type);
    if (!actionType) {
      return json(400, { ok: false, error: 'invalid_action_type' });
    }

    const actionArgs = parseJsonObjectValue((rawAction as Record<string, unknown>).args);
    const idempotencyKey =
      typeof body.idempotency_key === 'string' && body.idempotency_key.trim() !== ''
        ? body.idempotency_key.trim()
        : '';
    const action: AgentAction = {
      id:
        typeof (rawAction as Record<string, unknown>).id === 'string' &&
        ((rawAction as Record<string, unknown>).id as string).trim() !== ''
          ? ((rawAction as Record<string, unknown>).id as string).trim()
          : randomUUID(),
      type: actionType,
      description:
        typeof (rawAction as Record<string, unknown>).description === 'string' &&
        ((rawAction as Record<string, unknown>).description as string).trim() !== ''
          ? ((rawAction as Record<string, unknown>).description as string).trim()
          : `Manual action: ${actionType}`,
      risk: parseRiskLevel((rawAction as Record<string, unknown>).risk),
      requires_confirmation: parseBoolean((rawAction as Record<string, unknown>).requires_confirmation, false),
      args: actionArgs as Record<string, string | number | boolean>,
    };

    if (idempotencyKey !== '') {
      const existing = store.getActionByIdempotency({
        tenant_id: site.tenant_id,
        site_id: site.id,
        idempotency_key: idempotencyKey,
      });
      if (existing) {
        return json(200, {
          ok: true,
          deduped: true,
          action: existing,
        });
      }
    }

    const bindings = store.listSitePolicyBindings({
      tenant_id: site.tenant_id,
      site_id: site.id,
      limit: 200,
    });
    const templates = bindings
      .map((binding) => store.getPolicyTemplate(binding.template_id))
      .filter((item): item is PolicyTemplateRecord => Boolean(item));
    const policyHash = policyHashForTemplates(templates);
    const guardrail = enforceManualQueueGuardrails(action, templates);
    if (!guardrail.ok) {
      return json(403, {
        ok: false,
        error: guardrail.error,
        details: guardrail.details,
      });
    }

    const preview = await executor.execute(action, {
      dryRun: true,
      confirmed: true,
    });
    if (!preview.ok) {
      return json(400, { ok: false, error: 'invalid_action', details: preview.blocked_reason ?? 'invalid_action' });
    }

    const conversation = store.createConversation({
      site_id: site.id,
      tenant_id: site.tenant_id,
      last_message: `Manual queue action: ${action.type}`,
    });
    store.addChatMessage({
      conversation_id: conversation.id,
      role: 'system',
      content: `Queued via console host ops: ${action.description}`,
    });

    const queuedAction = store.enqueueAction({
      action,
      conversation_id: conversation.id,
      site_id: site.id,
      tenant_id: site.tenant_id,
      idempotency_key: idempotencyKey === '' ? null : idempotencyKey,
      policy_hash: policyHash,
      guardrail_decision: {
        ok: true,
        evaluated_templates: templates.map((item) => item.id),
      },
    });
    store.addAuditLog({
      tenant_id: site.tenant_id,
      site_id: site.id,
      actor: principal.token,
      event_type: 'action.queued_manual',
      payload: {
        action_id: queuedAction.id,
        type: queuedAction.type,
        conversation_id: conversation.id,
      },
    });

    return json(201, {
      ok: true,
      action: queuedAction,
      conversation_id: conversation.id,
      preview,
    });
  }

  if (method === 'GET' && pathname === '/api/audit') {
    const principal = await authorize(req, store, 'viewer', context);
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
      const principal = await authorize(req, store, 'admin', context);
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
      const principal = await authorize(req, store, 'operator', context);
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

      if (action.policy_hash) {
        const bindings = store.listSitePolicyBindings({
          tenant_id: action.tenant_id,
          site_id: action.site_id,
          limit: 200,
        });
        const templates = bindings
          .map((binding) => store.getPolicyTemplate(binding.template_id))
          .filter((item): item is PolicyTemplateRecord => Boolean(item));
        const currentPolicyHash = policyHashForTemplates(templates);
        if (currentPolicyHash !== action.policy_hash) {
          return json(409, {
            ok: false,
            error: 'action_policy_changed_requires_reapproval',
            details: {
              action_id: action.id,
              queued_policy_hash: action.policy_hash,
              current_policy_hash: currentPolicyHash,
            },
          });
        }
      }

      const parsed = await parseObjectBody(req);
      if (!parsed.ok) {
        return json(400, { ok: false, error: parsed.error });
      }
      const body = parsed.body;
      const dryRun = typeof body.dry_run === 'boolean' ? body.dry_run : true;
      const confirmed = typeof body.confirmed === 'boolean' ? body.confirmed : false;

      const executeRaw = await executor.execute(queuedToAgentAction(action), {
        dryRun,
        confirmed,
      });
      const execute = sanitizeExecuteResult(executeRaw);

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
    const principal = await authorize(req, store, 'operator', context);
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

    const resultRaw = await executor.execute(request.action, {
      dryRun: request.dry_run,
      confirmed: request.confirmed,
    });
    const result = sanitizeExecuteResult(resultRaw);

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
  const scriptContract = evaluateScriptContract();
  if (scriptContract.strict && scriptContract.issues.length > 0) {
    const summary = scriptContract.issues.map((item) => `${item.script}:${item.issue}`).join(', ');
    throw new Error(`script_contract_violation:${summary}`);
  }
  for (const issue of scriptContract.issues) {
    process.stderr.write(
      `[ai-vps-control-panel] script-contract warning script=${issue.script} issue=${issue.issue} path=${issue.path}\n`,
    );
  }
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
      const response = await route(req, store, context, scriptContract);
      if (context.rotated_token) {
        response.headers = {
          ...(response.headers ?? {}),
          'x-rotated-api-key': context.rotated_token,
        };
      }
      if (context.set_cookies && context.set_cookies.length > 0) {
        const existing = response.headers?.['set-cookie'];
        const existingValues = Array.isArray(existing) ? existing : existing ? [existing] : [];
        response.headers = {
          ...(response.headers ?? {}),
          'set-cookie': [...existingValues, ...context.set_cookies],
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
