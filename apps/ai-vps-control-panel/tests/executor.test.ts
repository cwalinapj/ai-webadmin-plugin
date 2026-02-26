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
});
