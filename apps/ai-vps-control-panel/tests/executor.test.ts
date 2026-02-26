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
});
