import { describe, expect, it } from 'vitest';
import { planAgentResponse } from '../src/agent/planner.js';

describe('agent planner', () => {
  it('creates restart action from chat prompt', () => {
    const response = planAgentResponse({
      site_id: 'site-1',
      message: 'Please restart nginx now',
    });

    expect(response.ok).toBe(true);
    expect(response.actions[0]?.type).toBe('restart_service');
    expect(response.actions[0]?.requires_confirmation).toBe(true);
  });

  it('creates status action from chat prompt', () => {
    const response = planAgentResponse({
      site_id: 'site-1',
      message: 'check mysql status',
    });

    expect(response.actions[0]?.type).toBe('check_service_status');
    expect(response.actions[0]?.args.service).toBe('mysql');
  });

  it('creates snapshot action from chat prompt with host-side args', () => {
    const response = planAgentResponse({
      site_id: 'site-1',
      message: 'take a snapshot before changes',
    });

    expect(response.actions[0]?.type).toBe('run_site_snapshot');
    expect(response.actions[0]?.args.site).toBe('site-1');
    expect(response.actions[0]?.args.site_path).toBe('/var/www/site-1');
  });

  it('creates rotate secret action from chat prompt', () => {
    const response = planAgentResponse({
      site_id: 'site-1',
      message: 'rotate secret for the runtime',
    });

    expect(response.actions[0]?.type).toBe('rotate_secret');
    expect(response.actions[0]?.requires_confirmation).toBe(true);
  });
});
