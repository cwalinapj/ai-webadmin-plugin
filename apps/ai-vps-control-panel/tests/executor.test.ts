import { describe, expect, it, vi } from 'vitest';
import { SafeCommandExecutor } from '../src/commands/executor.js';
import type { AgentAction } from '../src/types.js';

describe('safe command executor', () => {
  it('returns command preview in dry-run mode', async () => {
    const executor = new SafeCommandExecutor();
    const action: AgentAction = {
      id: 'a1',
      type: 'check_service_status',
      description: 'status',
      risk: 'low',
      requires_confirmation: false,
      args: { service: 'nginx' },
    };

    const result = await executor.execute(action, { dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.dry_run).toBe(true);
    expect(result.command?.bin).toBe('systemctl');
  });

  it('blocks high risk actions when confirmation is missing', async () => {
    const execFn = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }));
    const executor = new SafeCommandExecutor(execFn);
    const action: AgentAction = {
      id: 'a2',
      type: 'restart_service',
      description: 'restart',
      risk: 'high',
      requires_confirmation: true,
      args: { service: 'nginx' },
    };

    const result = await executor.execute(action, { dryRun: false, confirmed: false });
    expect(result.ok).toBe(false);
    expect(result.blocked_reason).toBe('confirmation_required');
    expect(execFn).toHaveBeenCalledTimes(0);
  });

  it('builds watchdog load-balancer command in dry-run mode', async () => {
    const executor = new SafeCommandExecutor();
    const action: AgentAction = {
      id: 'a3',
      type: 'switch_load_balancer_mode',
      description: 'watchdog lb',
      risk: 'high',
      requires_confirmation: false,
      args: {
        site: 'example.com',
        site_config: '/etc/nginx/sites-available/example.com.conf',
        backends_csv: '127.0.0.1:18120,127.0.0.1:18122',
        rps: 225,
        enable_rps_threshold: 180,
        disable_rps_threshold: 120,
      },
    };

    const result = await executor.execute(action, { dryRun: true, confirmed: true });
    expect(result.ok).toBe(true);
    expect(result.command?.bin).toBe('/root/watchdog-heartbeat.sh');
    expect(result.command?.args).toContain('--backend');
    expect(result.command?.args).toContain('127.0.0.1:18120');
    expect(result.command?.args).toContain('127.0.0.1:18122');
  });

  it('rejects invalid backend target for watchdog load-balancer action', async () => {
    const executor = new SafeCommandExecutor();
    const action: AgentAction = {
      id: 'a4',
      type: 'switch_load_balancer_mode',
      description: 'watchdog lb',
      risk: 'high',
      requires_confirmation: false,
      args: {
        site: 'example.com',
        backends_csv: '127.0.0.1:notaport',
        rps: 225,
        enable_rps_threshold: 180,
        disable_rps_threshold: 120,
      },
    };

    const result = await executor.execute(action, { dryRun: true, confirmed: true });
    expect(result.ok).toBe(false);
    expect(result.blocked_reason).toBe('invalid_backend_target');
  });

  it('builds security scan command with validated args', async () => {
    process.env.AI_VPS_RUN_SECURITY_SCAN_SCRIPT_PATH = '/tmp/run-security-scan.sh';
    const executor = new SafeCommandExecutor();
    const action: AgentAction = {
      id: 'a5',
      type: 'run_security_scan',
      description: 'security scan',
      risk: 'medium',
      requires_confirmation: false,
      args: {
        site: 'example.com',
        path: '/var/www/example.com',
        output_path: '/var/log/ai-webadmin/example-scan.json',
        max_findings: 25,
      },
    };

    const result = await executor.execute(action, { dryRun: true, confirmed: true });
    expect(result.ok).toBe(true);
    expect(result.command?.bin).toBe('/tmp/run-security-scan.sh');
    expect(result.command?.args).toContain('--path');
    expect(result.command?.args).toContain('/var/www/example.com');
  });

  it('builds snapshot command through host script path', async () => {
    process.env.AI_VPS_SNAPSHOT_SCRIPT_PATH = '/tmp/snapshot-site.sh';
    const executor = new SafeCommandExecutor();
    const action: AgentAction = {
      id: 'a6',
      type: 'run_site_snapshot',
      description: 'snapshot site',
      risk: 'medium',
      requires_confirmation: true,
      args: {
        site: 'example.com',
        site_path: '/var/www/example.com',
        output_dir: '/tmp/backups',
      },
    };

    const result = await executor.execute(action, { dryRun: true, confirmed: true });
    expect(result.ok).toBe(true);
    expect(result.command?.bin).toBe('/tmp/snapshot-site.sh');
    expect(result.command?.args).toEqual(['--site', 'example.com', '--site-path', '/var/www/example.com', '--output-dir', '/tmp/backups']);
  });

  it('builds verify upgrade command with expected files', async () => {
    process.env.AI_VPS_VERIFY_UPGRADE_SCRIPT_PATH = '/tmp/verify-upgrade.sh';
    const executor = new SafeCommandExecutor();
    const action: AgentAction = {
      id: 'a7',
      type: 'verify_site_upgrade',
      description: 'verify site',
      risk: 'medium',
      requires_confirmation: false,
      args: {
        site: 'example.com',
        site_path: '/var/www/example.com',
        expect_files_csv: '/var/www/example.com/index.php,/tmp/check.txt',
        url: 'https://example.com/health',
      },
    };

    const result = await executor.execute(action, { dryRun: true, confirmed: true });
    expect(result.ok).toBe(true);
    expect(result.command?.bin).toBe('/tmp/verify-upgrade.sh');
    expect(result.command?.args).toContain('--expect-file');
    expect(result.command?.args).toContain('/tmp/check.txt');
  });

  it('builds rotate secret command with guarded env file', async () => {
    process.env.AI_VPS_ROTATE_SECRETS_SCRIPT_PATH = '/tmp/rotate-secrets.sh';
    const executor = new SafeCommandExecutor();
    const action: AgentAction = {
      id: 'a8',
      type: 'rotate_secret',
      description: 'rotate runtime secret',
      risk: 'high',
      requires_confirmation: true,
      args: {
        name: 'API_TOKEN',
        write_env_file: '/tmp/runtime.env',
        prefix: 'tok_',
        length: 48,
      },
    };

    const result = await executor.execute(action, { dryRun: true, confirmed: true });
    expect(result.ok).toBe(true);
    expect(result.command?.bin).toBe('/tmp/rotate-secrets.sh');
    expect(result.command?.args).toContain('/tmp/runtime.env');
  });

  it('builds plan upgrade command with output path', async () => {
    process.env.AI_VPS_PLAN_UPGRADE_SCRIPT_PATH = '/tmp/plan-upgrade.sh';
    const executor = new SafeCommandExecutor();
    const action: AgentAction = {
      id: 'a9',
      type: 'plan_site_upgrade',
      description: 'plan upgrade',
      risk: 'medium',
      requires_confirmation: false,
      args: {
        site: 'example.com',
        site_path: '/var/www/example.com',
        from_version: '6.5.5',
        to_version: '6.6.1',
        output_path: '/tmp/upgrade.plan',
      },
    };

    const result = await executor.execute(action, { dryRun: true, confirmed: true });
    expect(result.ok).toBe(true);
    expect(result.command?.bin).toBe('/tmp/plan-upgrade.sh');
    expect(result.command?.args).toContain('--from-version');
    expect(result.command?.args).toContain('/tmp/upgrade.plan');
  });

  it('builds rollback upgrade command with snapshot and target paths', async () => {
    process.env.AI_VPS_ROLLBACK_UPGRADE_SCRIPT_PATH = '/tmp/rollback-upgrade.sh';
    const executor = new SafeCommandExecutor();
    const action: AgentAction = {
      id: 'a10',
      type: 'rollback_site_upgrade',
      description: 'rollback site',
      risk: 'high',
      requires_confirmation: true,
      args: {
        snapshot_path: '/var/backups/example-snap.tgz',
        target_path: '/var/www/example.com',
        backup_dir: '/tmp/rollback-backups',
      },
    };

    const result = await executor.execute(action, { dryRun: true, confirmed: true });
    expect(result.ok).toBe(true);
    expect(result.command?.bin).toBe('/tmp/rollback-upgrade.sh');
    expect(result.command?.args).toContain('--snapshot-path');
    expect(result.command?.args).toContain('/var/backups/example-snap.tgz');
  });

  it('blocks live execution when non-root guardrail is enabled and process uid is root', async () => {
    const original = process.env.AI_VPS_REQUIRE_NON_ROOT_EXEC;
    process.env.AI_VPS_REQUIRE_NON_ROOT_EXEC = 'true';
    const execFn = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }));
    const executor = new SafeCommandExecutor(execFn);
    const getuidSpy =
      typeof process.getuid === 'function'
        ? vi.spyOn(process as typeof process & { getuid: () => number }, 'getuid').mockReturnValue(0)
        : null;
    const action: AgentAction = {
      id: 'a11',
      type: 'check_service_status',
      description: 'status',
      risk: 'low',
      requires_confirmation: false,
      args: { service: 'nginx' },
    };

    const result = await executor.execute(action, { dryRun: false, confirmed: true });
    expect(result.ok).toBe(false);
    expect(result.blocked_reason).toBe('runtime_guardrail_non_root_required');
    expect(execFn).toHaveBeenCalledTimes(0);

    getuidSpy?.mockRestore();
    if (typeof original === 'string') {
      process.env.AI_VPS_REQUIRE_NON_ROOT_EXEC = original;
    } else {
      delete process.env.AI_VPS_REQUIRE_NON_ROOT_EXEC;
    }
  });
});
