import { execFile } from 'node:child_process';
import type { AgentAction, ExecuteActionResult } from '../types.js';

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

type ExecFn = (bin: string, args: string[], timeoutMs: number) => Promise<ExecResult>;

const ALLOWED_SERVICES = new Set(['nginx', 'apache2', 'httpd', 'mysql', 'mariadb', 'php-fpm', 'redis']);
const BACKEND_TARGET_REGEX = /^[a-zA-Z0-9.-]+:\d{2,5}$/;
const SITE_VALUE_REGEX = /^[a-zA-Z0-9.-]+$/;

function scriptPath(envName: string, fallback: string): string {
  const value = String(process.env[envName] ?? '').trim();
  return value === '' ? fallback : value;
}

function pathStartsWithAllowedPrefix(value: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => {
    const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    return value === normalized || value.startsWith(prefix);
  });
}

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
      const site = String(action.args.site ?? '').trim().toLowerCase();
      if (site === '' || !SITE_VALUE_REGEX.test(site)) {
        return { ok: false, error: 'invalid_site' };
      }

      const sitePath = String(action.args.site_path ?? '').trim();
      if (sitePath === '' || !pathStartsWithAllowedPrefix(sitePath, ['/var/www/', '/srv/www/', '/tmp/'])) {
        return { ok: false, error: 'site_path_not_allowed' };
      }

      const outputDir = String(action.args.output_dir ?? '/var/backups/ai-webadmin').trim();
      if (!pathStartsWithAllowedPrefix(outputDir, ['/var/backups/', '/tmp/'])) {
        return { ok: false, error: 'output_dir_not_allowed' };
      }

      return {
        ok: true,
        value: {
          bin: scriptPath('AI_VPS_SNAPSHOT_SCRIPT_PATH', '/root/snapshot-site.sh'),
          args: ['--site', site, '--site-path', sitePath, '--output-dir', outputDir],
        },
      };
    }

    if (action.type === 'plan_site_upgrade') {
      const site = String(action.args.site ?? '').trim().toLowerCase();
      if (site === '' || !SITE_VALUE_REGEX.test(site)) {
        return { ok: false, error: 'invalid_site' };
      }

      const sitePath = String(action.args.site_path ?? '').trim();
      if (sitePath === '' || !pathStartsWithAllowedPrefix(sitePath, ['/var/www/', '/srv/www/', '/tmp/'])) {
        return { ok: false, error: 'site_path_not_allowed' };
      }

      const outputPath = String(action.args.output_path ?? '').trim();
      if (outputPath !== '' && !pathStartsWithAllowedPrefix(outputPath, ['/var/lib/ai-webadmin/', '/tmp/'])) {
        return { ok: false, error: 'output_path_not_allowed' };
      }

      const fromVersion = String(action.args.from_version ?? '').trim();
      const toVersion = String(action.args.to_version ?? '').trim();
      const args: string[] = ['--site', site, '--site-path', sitePath];
      if (fromVersion !== '') {
        args.push('--from-version', fromVersion);
      }
      if (toVersion !== '') {
        args.push('--to-version', toVersion);
      }
      if (outputPath !== '') {
        args.push('--output-path', outputPath);
      }

      return {
        ok: true,
        value: {
          bin: scriptPath('AI_VPS_PLAN_UPGRADE_SCRIPT_PATH', '/root/plan-upgrade.sh'),
          args,
        },
      };
    }

    if (action.type === 'verify_site_upgrade') {
      const site = String(action.args.site ?? '').trim().toLowerCase();
      if (site === '' || !SITE_VALUE_REGEX.test(site)) {
        return { ok: false, error: 'invalid_site' };
      }

      const args: string[] = ['--site', site];
      const sitePath = String(action.args.site_path ?? '').trim();
      if (sitePath !== '') {
        if (!pathStartsWithAllowedPrefix(sitePath, ['/var/www/', '/srv/www/', '/tmp/'])) {
          return { ok: false, error: 'site_path_not_allowed' };
        }
        args.push('--site-path', sitePath);
      }

      const expectFilesCsv = String(action.args.expect_files_csv ?? '').trim();
      if (expectFilesCsv !== '') {
        const files = expectFilesCsv
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item !== '');
        for (const file of files) {
          if (!pathStartsWithAllowedPrefix(file, ['/var/www/', '/srv/www/', '/tmp/'])) {
            return { ok: false, error: 'expect_file_not_allowed' };
          }
          args.push('--expect-file', file);
        }
      }

      const url = String(action.args.url ?? '').trim();
      if (url !== '') {
        if (!/^https?:\/\//.test(url)) {
          return { ok: false, error: 'invalid_url' };
        }
        args.push('--url', url);
      }

      return {
        ok: true,
        value: {
          bin: scriptPath('AI_VPS_VERIFY_UPGRADE_SCRIPT_PATH', '/root/verify-upgrade.sh'),
          args,
        },
      };
    }

    if (action.type === 'rollback_site_upgrade') {
      const snapshotPath = String(action.args.snapshot_path ?? '').trim();
      if (snapshotPath === '' || !pathStartsWithAllowedPrefix(snapshotPath, ['/var/backups/', '/tmp/'])) {
        return { ok: false, error: 'snapshot_path_not_allowed' };
      }

      const targetPath = String(action.args.target_path ?? '').trim();
      if (targetPath === '' || !pathStartsWithAllowedPrefix(targetPath, ['/var/www/', '/srv/www/', '/tmp/'])) {
        return { ok: false, error: 'target_path_not_allowed' };
      }

      const backupDir = String(action.args.backup_dir ?? '').trim();
      if (backupDir !== '' && !pathStartsWithAllowedPrefix(backupDir, ['/var/backups/', '/tmp/'])) {
        return { ok: false, error: 'backup_dir_not_allowed' };
      }

      const args: string[] = ['--snapshot-path', snapshotPath, '--target-path', targetPath];
      if (backupDir !== '') {
        args.push('--backup-dir', backupDir);
      }

      return {
        ok: true,
        value: {
          bin: scriptPath('AI_VPS_ROLLBACK_UPGRADE_SCRIPT_PATH', '/root/rollback-upgrade.sh'),
          args,
        },
      };
    }

    if (action.type === 'run_security_scan') {
      const site = String(action.args.site ?? '').trim().toLowerCase();
      if (site === '' || !SITE_VALUE_REGEX.test(site)) {
        return { ok: false, error: 'invalid_site' };
      }

      const scanPath = String(action.args.path ?? '').trim();
      if (scanPath === '' || !scanPath.startsWith('/')) {
        return { ok: false, error: 'invalid_scan_path' };
      }

      const outputPath = String(action.args.output_path ?? '').trim();
      if (outputPath !== '' && !outputPath.startsWith('/var/log/ai-webadmin/')) {
        return { ok: false, error: 'output_path_not_allowed' };
      }

      const maxFindings = boundedInteger(action.args.max_findings, 50, 1, 1000);
      const args: string[] = ['--site', site, '--path', scanPath, '--max-findings', String(maxFindings)];
      if (outputPath !== '') {
        args.push('--output-path', outputPath);
      }

      return {
        ok: true,
        value: {
          bin: scriptPath('AI_VPS_RUN_SECURITY_SCAN_SCRIPT_PATH', '/root/run-security-scan.sh'),
          args,
        },
      };
    }

    if (action.type === 'rotate_secret') {
      const name = String(action.args.name ?? '').trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(name)) {
        return { ok: false, error: 'invalid_secret_name' };
      }

      const args: string[] = ['--name', name];
      const writeEnvFile = String(action.args.write_env_file ?? '').trim();
      if (writeEnvFile !== '') {
        if (!pathStartsWithAllowedPrefix(writeEnvFile, ['/etc/', '/run/', '/var/lib/ai-webadmin/', '/tmp/'])) {
          return { ok: false, error: 'env_file_not_allowed' };
        }
        args.push('--write-env-file', writeEnvFile);
      }

      const prefix = String(action.args.prefix ?? '').trim();
      if (prefix !== '') {
        args.push('--prefix', prefix);
      }

      const length = boundedInteger(action.args.length, 40, 12, 256);
      args.push('--length', String(length));

      return {
        ok: true,
        value: {
          bin: scriptPath('AI_VPS_ROTATE_SECRETS_SCRIPT_PATH', '/root/rotate-secrets.sh'),
          args,
        },
      };
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
          bin: scriptPath('AI_VPS_WATCHDOG_SCRIPT_PATH', '/root/watchdog-heartbeat.sh'),
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
