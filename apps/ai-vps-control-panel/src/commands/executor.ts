import { execFile } from 'node:child_process';
import type { AgentAction, ExecuteActionResult } from '../types.js';

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

type ExecFn = (bin: string, args: string[], timeoutMs: number) => Promise<ExecResult>;

const ALLOWED_SERVICES = new Set(['nginx', 'apache2', 'httpd', 'mysql', 'mariadb', 'php-fpm', 'redis']);
const WATCHDOG_SCRIPT_PATH = '/root/watchdog-heartbeat.sh';
const BACKEND_TARGET_REGEX = /^[a-zA-Z0-9.-]+:\d{2,5}$/;
const SITE_VALUE_REGEX = /^[a-zA-Z0-9.-]+$/;

async function defaultExec(bin: string, args: string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve) => {
    execFile(bin, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        const code = typeof error.code === 'number' ? error.code : 1;
        resolve({
          stdout: stdout ?? '',
          stderr: stderr || error.message,
          code,
        });
        return;
      }

      resolve({
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        code: 0,
      });
    });
  });
}

export class SafeCommandExecutor {
  private readonly execFn: ExecFn;
  private readonly timeoutMs: number;

  constructor(execFn: ExecFn = defaultExec, timeoutMs = 10_000) {
    this.execFn = execFn;
    this.timeoutMs = timeoutMs;
  }

  async execute(
    action: AgentAction,
    options: { dryRun?: boolean; confirmed?: boolean } = {},
  ): Promise<ExecuteActionResult> {
    const dryRun = options.dryRun ?? true;
    const confirmed = options.confirmed ?? false;
    const command = this.commandForAction(action);

    if (!command.ok) {
      return {
        ok: false,
        dry_run: dryRun,
        blocked_reason: command.error,
      };
    }

    if (action.requires_confirmation && !confirmed) {
      return {
        ok: false,
        dry_run: dryRun,
        blocked_reason: 'confirmation_required',
        command: command.value,
      };
    }

    if (dryRun) {
      return {
        ok: true,
        dry_run: true,
        command: command.value,
      };
    }

    const result = await this.execFn(command.value.bin, command.value.args, this.timeoutMs);
    return {
      ok: result.code === 0,
      dry_run: false,
      command: command.value,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.code,
    };
  }

  private commandForAction(
    action: AgentAction,
  ): { ok: true; value: { bin: string; args: string[] } } | { ok: false; error: string } {
    if (action.type === 'noop') {
      return { ok: false, error: 'noop_action' };
    }

    if (
      action.type === 'check_service_status' ||
      action.type === 'restart_service' ||
      action.type === 'tail_service_logs'
    ) {
      const serviceRaw = String(action.args.service ?? '').trim().toLowerCase();
      const service = serviceRaw === '' ? 'nginx' : serviceRaw;
      if (!ALLOWED_SERVICES.has(service)) {
        return { ok: false, error: 'service_not_allowed' };
      }
      if (action.type === 'check_service_status') {
        return { ok: true, value: { bin: 'systemctl', args: ['status', service, '--no-pager'] } };
      }

      if (action.type === 'restart_service') {
        return { ok: true, value: { bin: 'systemctl', args: ['restart', service] } };
      }

      const lines = Math.max(10, Math.min(2000, Number(action.args.lines ?? 200)));
      return {
        ok: true,
        value: {
          bin: 'journalctl',
          args: ['-u', service, '-n', String(lines), '--no-pager'],
        },
      };
    }

    if (action.type === 'run_site_snapshot') {
      const sitePath = String(action.args.site_path ?? '/var/www');
      const outputPath = String(action.args.output_path ?? '/var/backups/site-snapshot.tgz');
      if (!sitePath.startsWith('/var/www')) {
        return { ok: false, error: 'site_path_not_allowed' };
      }
      if (!outputPath.startsWith('/var/backups/')) {
        return { ok: false, error: 'output_path_not_allowed' };
      }
      return { ok: true, value: { bin: 'tar', args: ['-czf', outputPath, sitePath] } };
    }

    if (action.type === 'switch_load_balancer_mode') {
      const site = String(action.args.site ?? '').trim().toLowerCase();
      if (site === '' || !SITE_VALUE_REGEX.test(site)) {
        return { ok: false, error: 'invalid_site' };
      }

      const siteConfig = String(action.args.site_config ?? '').trim();
      if (siteConfig !== '' && !siteConfig.startsWith('/etc/nginx/')) {
        return { ok: false, error: 'site_config_not_allowed' };
      }

      const backendsCsv = String(action.args.backends_csv ?? '').trim();
      const backends = backendsCsv
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '');
      if (backends.length === 0) {
        return { ok: false, error: 'missing_backends' };
      }
      if (backends.some((target) => !BACKEND_TARGET_REGEX.test(target))) {
        return { ok: false, error: 'invalid_backend_target' };
      }

      const enableThreshold = boundedInteger(action.args.enable_rps_threshold, 180, 1, 1_000_000);
      const disableThreshold = boundedInteger(action.args.disable_rps_threshold, 120, 1, 1_000_000);
      if (enableThreshold <= disableThreshold) {
        return { ok: false, error: 'invalid_threshold_window' };
      }

      const rps = boundedNumber(action.args.rps, 0);
      const args: string[] = [
        '--site',
        site,
        '--rps',
        String(rps),
        '--enable-rps-threshold',
        String(enableThreshold),
        '--disable-rps-threshold',
        String(disableThreshold),
      ];

      if (siteConfig !== '') {
        args.push('--site-config', siteConfig);
      }

      for (const target of backends) {
        args.push('--backend', target);
      }

      const cpuLoad = boundedOptionalNumber(action.args.cpu_load);
      if (cpuLoad !== null) {
        args.push('--cpu-load', String(cpuLoad));
      }

      const stateDir = String(action.args.state_dir ?? '').trim();
      if (stateDir !== '') {
        if (!stateDir.startsWith('/var/lib/ai-webadmin')) {
          return { ok: false, error: 'state_dir_not_allowed' };
        }
        args.push('--state-dir', stateDir);
      }

      return {
        ok: true,
        value: {
          bin: WATCHDOG_SCRIPT_PATH,
          args,
        },
      };
    }

    return { ok: false, error: 'unsupported_action' };
  }
}

function boundedInteger(
  value: string | number | boolean | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const normalized = Math.floor(parsed);
  return Math.max(min, Math.min(max, normalized));
}

function boundedNumber(value: string | number | boolean | undefined, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Number(parsed.toFixed(2));
}

function boundedOptionalNumber(value: string | number | boolean | undefined): number | null {
  if (typeof value === 'undefined') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Number(parsed.toFixed(2));
}
