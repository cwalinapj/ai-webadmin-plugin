import { execFile } from 'node:child_process';
import type { AgentAction, ExecuteActionResult } from '../types.js';

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

type ExecFn = (bin: string, args: string[], timeoutMs: number) => Promise<ExecResult>;

const ALLOWED_SERVICES = new Set(['nginx', 'apache2', 'httpd', 'mysql', 'mariadb', 'php-fpm', 'redis']);

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

    const serviceRaw = String(action.args.service ?? '').trim().toLowerCase();
    const service = serviceRaw === '' ? 'nginx' : serviceRaw;

    if (['check_service_status', 'restart_service', 'tail_service_logs'].includes(action.type)) {
      if (!ALLOWED_SERVICES.has(service)) {
        return { ok: false, error: 'service_not_allowed' };
      }
    }

    if (action.type === 'check_service_status') {
      return { ok: true, value: { bin: 'systemctl', args: ['status', service, '--no-pager'] } };
    }

    if (action.type === 'restart_service') {
      return { ok: true, value: { bin: 'systemctl', args: ['restart', service] } };
    }

    if (action.type === 'tail_service_logs') {
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

    return { ok: false, error: 'unsupported_action' };
  }
}
