import { describe, expect, it } from 'vitest';
import {
  decideWatchdogAction,
  isWatchdogCooldownActive,
  resolveWatchdogObservedRps,
} from '../src/automation/watchdogLbAutomation';
import type { HeartbeatPayload } from '../src/sites/upsertSite';

describe('watchdog lb automation helpers', () => {
  it('uses traffic_rps directly when present', () => {
    const payload: HeartbeatPayload = {
      site_id: 'site-1',
      domain: 'example.com',
      traffic_rps: 234.17,
      load_avg: [1.2, 1.1, 1.0],
    };

    const observed = resolveWatchdogObservedRps(payload, 60);

    expect(observed).toBe(234.17);
    expect(decideWatchdogAction(observed, 180, 120)).toBe('enable');
  });

  it('falls back to load average multiplier when traffic_rps is absent', () => {
    const payload: HeartbeatPayload = {
      site_id: 'site-2',
      domain: 'example.org',
      load_avg: [2.5, 1.8, 1.2],
    };

    const observed = resolveWatchdogObservedRps(payload, 50);

    expect(observed).toBe(125);
    expect(decideWatchdogAction(observed, 180, 120)).toBe('noop');
  });

  it('enforces cooldown windows between state-changing actions', () => {
    const now = Date.parse('2026-02-26T12:00:00.000Z');
    const withinWindow = isWatchdogCooldownActive('2026-02-26T11:56:30.000Z', 300, now);
    const outsideWindow = isWatchdogCooldownActive('2026-02-26T11:50:00.000Z', 300, now);

    expect(withinWindow).toBe(true);
    expect(outsideWindow).toBe(false);
  });
});
