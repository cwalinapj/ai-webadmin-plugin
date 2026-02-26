import { createJob } from '../jobs/createJob';
import type { HeartbeatPayload } from '../sites/upsertSite';
import type { Env } from '../types';
import {
  getWatchdogAutomationState,
  saveWatchdogAutomationState,
  type WatchdogAction,
} from './watchdogState';

interface WatchdogAutomationConfig {
  enabled: boolean;
  reason: string;
  dryRun: boolean;
  panelBaseUrl: string;
  panelApiToken: string;
  enableRpsThreshold: number;
  disableRpsThreshold: number;
  rpsPerLoadAvg: number;
  cooldownSeconds: number;
  siteTemplate: string;
  siteConfigTemplate: string;
  backends: string[];
  requestTimeoutMs: number;
}

export interface RunWatchdogLbAutomationInput {
  pluginId: string;
  payload: HeartbeatPayload;
}

export interface WatchdogLbAutomationResult {
  enabled: boolean;
  dry_run: boolean;
  attempted: boolean;
  status: 'skipped' | 'success' | 'failed';
  action: WatchdogAction;
  observed_rps: number;
  reason: string;
  panel_status?: number;
  job_id?: string;
}

const DEFAULT_ENABLE_RPS_THRESHOLD = 180;
const DEFAULT_DISABLE_RPS_THRESHOLD = 120;
const DEFAULT_RPS_PER_LOAD_AVG = 60;
const DEFAULT_COOLDOWN_SECONDS = 300;
const DEFAULT_SITE_TEMPLATE = '{domain}';
const DEFAULT_SITE_CONFIG_TEMPLATE = '/etc/nginx/sites-available/{domain}.conf';
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_JSON_BYTES = 16_000;

export function resolveWatchdogObservedRps(payload: HeartbeatPayload, rpsPerLoadAvg: number): number {
  if (typeof payload.traffic_rps === 'number' && Number.isFinite(payload.traffic_rps) && payload.traffic_rps >= 0) {
    return roundMetric(payload.traffic_rps);
  }

  const loadAvgOneMinute =
    Array.isArray(payload.load_avg) && typeof payload.load_avg[0] === 'number'
      ? Number(payload.load_avg[0])
      : 0;
  if (!Number.isFinite(loadAvgOneMinute) || loadAvgOneMinute <= 0) {
    return 0;
  }

  return roundMetric(loadAvgOneMinute * rpsPerLoadAvg);
}

export function decideWatchdogAction(
  observedRps: number,
  enableRpsThreshold: number,
  disableRpsThreshold: number,
): WatchdogAction {
  if (observedRps >= enableRpsThreshold) {
    return 'enable';
  }
  if (observedRps <= disableRpsThreshold) {
    return 'disable';
  }
  return 'noop';
}

export function isWatchdogCooldownActive(
  lastRunAt: string,
  cooldownSeconds: number,
  nowMillis = Date.now(),
): boolean {
  if (cooldownSeconds <= 0) {
    return false;
  }

  const parsedMillis = Date.parse(lastRunAt);
  if (!Number.isFinite(parsedMillis)) {
    return false;
  }

  return nowMillis - parsedMillis < cooldownSeconds * 1000;
}

export async function runWatchdogLbAutomation(
  env: Env,
  input: RunWatchdogLbAutomationInput,
): Promise<WatchdogLbAutomationResult> {
  const config = readWatchdogAutomationConfig(env);
  const observedRps = resolveWatchdogObservedRps(input.payload, config.rpsPerLoadAvg);

  if (!config.enabled) {
    return {
      enabled: false,
      dry_run: config.dryRun,
      attempted: false,
      status: 'skipped',
      action: 'noop',
      observed_rps: observedRps,
      reason: config.reason,
    };
  }

  const action = decideWatchdogAction(
    observedRps,
    config.enableRpsThreshold,
    config.disableRpsThreshold,
  );

  if (action === 'noop') {
    return {
      enabled: true,
      dry_run: config.dryRun,
      attempted: false,
      status: 'skipped',
      action,
      observed_rps: observedRps,
      reason: 'within_hysteresis_band',
    };
  }

  try {
    const previousState = await getWatchdogAutomationState(env.DB, input.payload.site_id);
    if (
      previousState &&
      previousState.last_status === 'success' &&
      previousState.last_action === action
    ) {
      return {
        enabled: true,
        dry_run: config.dryRun,
        attempted: false,
        status: 'skipped',
        action,
        observed_rps: observedRps,
        reason: `already_${action}d`,
      };
    }

    if (
      previousState &&
      isWatchdogCooldownActive(previousState.last_run_at, config.cooldownSeconds)
    ) {
      return {
        enabled: true,
        dry_run: config.dryRun,
        attempted: false,
        status: 'skipped',
        action,
        observed_rps: observedRps,
        reason: 'cooldown_active',
      };
    }
  } catch {
    return {
      enabled: true,
      dry_run: config.dryRun,
      attempted: false,
      status: 'failed',
      action,
      observed_rps: observedRps,
      reason: 'state_read_failed',
    };
  }

  const requestBody = buildPanelExecutePayload(input, config, action, observedRps);
  const executeUrl = new URL('/api/agent/execute', config.panelBaseUrl);
  const timeout = createTimeoutSignal(config.requestTimeoutMs);

  let panelStatus = 0;
  let executionSucceeded = false;
  let responseSnapshot: unknown = null;
  try {
    const response = await fetch(executeUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.panelApiToken}`,
      },
      body: JSON.stringify(requestBody),
      signal: timeout.signal,
    });
    panelStatus = response.status;
    responseSnapshot = await parseJsonResponse(response);
    executionSucceeded =
      response.ok &&
      isObject(responseSnapshot) &&
      responseSnapshot.ok === true &&
      typeof responseSnapshot.dry_run === 'boolean';
  } catch (error) {
    responseSnapshot = {
      ok: false,
      error: 'panel_execute_request_failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    timeout.cancel();
  }

  let reason = executionSucceeded ? 'executed' : 'panel_execute_failed';
  try {
    await saveWatchdogAutomationState(env.DB, {
      siteId: input.payload.site_id,
      pluginId: input.pluginId,
      action,
      status: executionSucceeded ? 'success' : 'failed',
      rps: observedRps,
      responseJson: truncateForStorage(responseSnapshot),
    });
  } catch {
    reason = executionSucceeded ? 'executed_state_write_failed' : 'panel_execute_state_write_failed';
  }

  const jobId = await createWatchdogAutomationJob(env, input.payload.site_id, action, executionSucceeded);

  return {
    enabled: true,
    dry_run: config.dryRun,
    attempted: true,
    status: executionSucceeded ? 'success' : 'failed',
    action,
    observed_rps: observedRps,
    reason,
    panel_status: panelStatus || undefined,
    job_id: jobId ?? undefined,
  };
}

function readWatchdogAutomationConfig(env: Env): WatchdogAutomationConfig {
  const dryRun = parseBooleanFlag(env.WATCHDOG_AUTOMATION_DRY_RUN, true);
  const automationEnabled = parseBooleanFlag(env.WATCHDOG_AUTOMATION_ENABLED, false);
  if (!automationEnabled) {
    return {
      enabled: false,
      reason: 'automation_disabled',
      dryRun,
      panelBaseUrl: '',
      panelApiToken: '',
      enableRpsThreshold: DEFAULT_ENABLE_RPS_THRESHOLD,
      disableRpsThreshold: DEFAULT_DISABLE_RPS_THRESHOLD,
      rpsPerLoadAvg: DEFAULT_RPS_PER_LOAD_AVG,
      cooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
      siteTemplate: DEFAULT_SITE_TEMPLATE,
      siteConfigTemplate: DEFAULT_SITE_CONFIG_TEMPLATE,
      backends: [],
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    };
  }

  const panelBaseUrl = (env.WATCHDOG_AUTOMATION_PANEL_BASE_URL ?? '').trim();
  const panelApiToken = (env.WATCHDOG_AUTOMATION_PANEL_API_TOKEN ?? '').trim();
  const backends = parseBackendList(env.WATCHDOG_AUTOMATION_BACKENDS ?? '');
  if (panelBaseUrl === '' || panelApiToken === '' || backends.length === 0) {
    return {
      enabled: false,
      reason: 'automation_missing_panel_configuration',
      dryRun,
      panelBaseUrl,
      panelApiToken,
      enableRpsThreshold: DEFAULT_ENABLE_RPS_THRESHOLD,
      disableRpsThreshold: DEFAULT_DISABLE_RPS_THRESHOLD,
      rpsPerLoadAvg: DEFAULT_RPS_PER_LOAD_AVG,
      cooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
      siteTemplate: DEFAULT_SITE_TEMPLATE,
      siteConfigTemplate: DEFAULT_SITE_CONFIG_TEMPLATE,
      backends,
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    };
  }

  const disableRpsThreshold = Math.max(
    1,
    parsePositiveNumber(env.WATCHDOG_AUTOMATION_DISABLE_RPS_THRESHOLD, DEFAULT_DISABLE_RPS_THRESHOLD),
  );
  const enableRpsThreshold = Math.max(
    disableRpsThreshold + 1,
    parsePositiveNumber(env.WATCHDOG_AUTOMATION_ENABLE_RPS_THRESHOLD, DEFAULT_ENABLE_RPS_THRESHOLD),
  );

  return {
    enabled: true,
    reason: 'ready',
    dryRun,
    panelBaseUrl,
    panelApiToken,
    enableRpsThreshold,
    disableRpsThreshold,
    rpsPerLoadAvg: parsePositiveNumber(
      env.WATCHDOG_AUTOMATION_RPS_PER_LOAD_AVG,
      DEFAULT_RPS_PER_LOAD_AVG,
    ),
    cooldownSeconds: Math.max(
      0,
      Math.floor(
        parsePositiveNumber(env.WATCHDOG_AUTOMATION_COOLDOWN_SECONDS, DEFAULT_COOLDOWN_SECONDS),
      ),
    ),
    siteTemplate: (env.WATCHDOG_AUTOMATION_SITE_TEMPLATE ?? DEFAULT_SITE_TEMPLATE).trim(),
    siteConfigTemplate: (
      env.WATCHDOG_AUTOMATION_SITE_CONFIG_TEMPLATE ?? DEFAULT_SITE_CONFIG_TEMPLATE
    ).trim(),
    backends,
    requestTimeoutMs: Math.max(
      1000,
      Math.floor(
        parsePositiveNumber(
          env.WATCHDOG_AUTOMATION_REQUEST_TIMEOUT_MS,
          DEFAULT_REQUEST_TIMEOUT_MS,
        ),
      ),
    ),
  };
}

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no') {
    return false;
  }
  return fallback;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (typeof value !== 'string') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseBackendList(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed === '') {
    return [];
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter((item) => item !== '');
      }
    } catch {
      return [];
    }
  }

  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function buildPanelExecutePayload(
  input: RunWatchdogLbAutomationInput,
  config: WatchdogAutomationConfig,
  action: WatchdogAction,
  observedRps: number,
): Record<string, unknown> {
  const siteValue = renderTemplate(config.siteTemplate, input.payload);
  const siteConfigValue = renderTemplate(config.siteConfigTemplate, input.payload);
  const oneMinuteLoad =
    Array.isArray(input.payload.load_avg) && typeof input.payload.load_avg[0] === 'number'
      ? Number(input.payload.load_avg[0])
      : null;

  const args: Record<string, string | number | boolean> = {
    mode: action,
    site: siteValue,
    backends_csv: config.backends.join(','),
    rps: observedRps,
    enable_rps_threshold: config.enableRpsThreshold,
    disable_rps_threshold: config.disableRpsThreshold,
  };
  if (siteConfigValue !== '') {
    args.site_config = siteConfigValue;
  }
  if (oneMinuteLoad !== null && Number.isFinite(oneMinuteLoad)) {
    args.cpu_load = roundMetric(oneMinuteLoad);
  }

  return {
    site_id: input.payload.site_id,
    action: {
      id: crypto.randomUUID(),
      type: 'switch_load_balancer_mode',
      description: `Watchdog automation ${action} for ${input.payload.domain}`,
      risk: 'high',
      requires_confirmation: false,
      args,
    },
    dry_run: config.dryRun,
    confirmed: true,
  };
}

function renderTemplate(template: string, payload: HeartbeatPayload): string {
  const site = payload.domain.trim() !== '' ? payload.domain.trim() : payload.site_id;
  return template
    .replaceAll('{site_id}', payload.site_id)
    .replaceAll('{domain}', payload.domain)
    .replaceAll('{site}', site);
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (text.trim() === '') {
    return { ok: response.ok };
  }
  try {
    const parsed = JSON.parse(text);
    return isObject(parsed) ? parsed : { ok: response.ok, raw: parsed };
  } catch {
    return { ok: response.ok, raw: text };
  }
}

function truncateForStorage(value: unknown): string {
  let serialized = '';
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = JSON.stringify({ ok: false, error: 'response_not_serializable' });
  }

  if (serialized.length <= MAX_RESPONSE_JSON_BYTES) {
    return serialized;
  }
  return `${serialized.slice(0, MAX_RESPONSE_JSON_BYTES)}...`;
}

function createTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timeout),
  };
}

async function createWatchdogAutomationJob(
  env: Env,
  siteId: string,
  action: WatchdogAction,
  success: boolean,
): Promise<string | null> {
  try {
    const job = await createJob(env.DB, {
      siteId,
      tab: 'uptime',
      type: `watchdog_lb_${action}`,
      status: success ? 'completed' : 'failed',
      riskScore: action === 'enable' ? 8 : 6,
    });
    return job.id;
  } catch {
    return null;
  }
}

function roundMetric(value: number): number {
  return Number(value.toFixed(2));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
