import { describe, expect, it } from 'vitest';
import { resolveRoutePolicy } from '../src/auth/routePolicy';

describe('resolveRoutePolicy', () => {
  describe('exact path matching', () => {
    it('matches /plugin/wp/watchdog/heartbeat with uptime capability', () => {
      const policy = resolveRoutePolicy('/plugin/wp/watchdog/heartbeat');
      expect(policy.capability).toBe('uptime');
      expect(policy.requireNonce).toBe(true);
      expect(policy.requireIdempotency).toBe(true);
    });

    it('matches /plugin/site/watchdog/heartbeat with uptime capability', () => {
      const policy = resolveRoutePolicy('/plugin/site/watchdog/heartbeat');
      expect(policy.capability).toBe('uptime');
      expect(policy.requireNonce).toBe(true);
      expect(policy.requireIdempotency).toBe(true);
    });

    it('matches /plugin/wp/host-optimizer/baseline with host_optimizer capability', () => {
      const policy = resolveRoutePolicy('/plugin/wp/host-optimizer/baseline');
      expect(policy.capability).toBe('host_optimizer');
      expect(policy.requireNonce).toBe(true);
      expect(policy.requireIdempotency).toBe(true);
    });

    it('matches /plugin/site/host-optimizer/baseline with host_optimizer capability', () => {
      const policy = resolveRoutePolicy('/plugin/site/host-optimizer/baseline');
      expect(policy.capability).toBe('host_optimizer');
      expect(policy.requireNonce).toBe(true);
      expect(policy.requireIdempotency).toBe(true);
    });

    it('matches /plugin/wp/auth/wallet/verify with null capability', () => {
      const policy = resolveRoutePolicy('/plugin/wp/auth/wallet/verify');
      expect(policy.capability).toBeNull();
      expect(policy.requireNonce).toBe(true);
      expect(policy.requireIdempotency).toBe(true);
    });

    it('matches /plugin/site/auth/wallet/verify with null capability', () => {
      const policy = resolveRoutePolicy('/plugin/site/auth/wallet/verify');
      expect(policy.capability).toBeNull();
      expect(policy.requireNonce).toBe(true);
      expect(policy.requireIdempotency).toBe(true);
    });
  });

  describe('prefix path matching', () => {
    it('matches /plugin/wp/performance/* with uptime capability', () => {
      const policy = resolveRoutePolicy('/plugin/wp/performance/slo/evaluate');
      expect(policy.capability).toBe('uptime');
    });

    it('matches /plugin/site/performance/* with uptime capability', () => {
      const policy = resolveRoutePolicy('/plugin/site/performance/slo/evaluate');
      expect(policy.capability).toBe('uptime');
    });

    it('matches /plugin/wp/updates/* with uptime capability', () => {
      const policy = resolveRoutePolicy('/plugin/wp/updates/safe/run');
      expect(policy.capability).toBe('uptime');
    });

    it('matches /plugin/site/updates/* with uptime capability', () => {
      const policy = resolveRoutePolicy('/plugin/site/updates/safe/run');
      expect(policy.capability).toBe('uptime');
    });

    it('matches /plugin/wp/sandbox/* with sandbox capability', () => {
      const policy = resolveRoutePolicy('/plugin/wp/sandbox/create');
      expect(policy.capability).toBe('sandbox');
    });

    it('matches /plugin/site/sandbox/* with sandbox capability', () => {
      const policy = resolveRoutePolicy('/plugin/site/sandbox/create');
      expect(policy.capability).toBe('sandbox');
    });

    it('matches /plugin/wp/analytics/* with analytics capability', () => {
      const policy = resolveRoutePolicy('/plugin/wp/analytics/goals/assistant');
      expect(policy.capability).toBe('analytics');
    });

    it('matches /plugin/site/analytics/* with analytics capability', () => {
      const policy = resolveRoutePolicy('/plugin/site/analytics/goals/assistant');
      expect(policy.capability).toBe('analytics');
    });

    it('matches /plugin/wp/incident/* with uptime capability', () => {
      const policy = resolveRoutePolicy('/plugin/wp/incident/mode');
      expect(policy.capability).toBe('uptime');
    });

    it('matches /plugin/site/incident/* with uptime capability', () => {
      const policy = resolveRoutePolicy('/plugin/site/incident/mode');
      expect(policy.capability).toBe('uptime');
    });

    it('matches /plugin/wp/jobs/* with uptime capability', () => {
      const policy = resolveRoutePolicy('/plugin/wp/jobs/reports');
      expect(policy.capability).toBe('uptime');
    });

    it('matches /plugin/site/jobs/* with uptime capability', () => {
      const policy = resolveRoutePolicy('/plugin/site/jobs/reports');
      expect(policy.capability).toBe('uptime');
    });
  });

  describe('default policy for unmatched paths', () => {
    it('returns default policy for unknown path', () => {
      const policy = resolveRoutePolicy('/unknown/path');
      expect(policy.capability).toBeNull();
      expect(policy.requireNonce).toBe(true);
      expect(policy.requireIdempotency).toBe(true);
    });

    it('returns default policy for empty path', () => {
      const policy = resolveRoutePolicy('');
      expect(policy.capability).toBeNull();
      expect(policy.requireNonce).toBe(true);
      expect(policy.requireIdempotency).toBe(true);
    });

    it('does not match exact path with extra suffix', () => {
      const policy = resolveRoutePolicy('/plugin/wp/watchdog/heartbeat/extra');
      expect(policy.capability).toBeNull();
    });

    it('does not match prefix without trailing slash', () => {
      const policy = resolveRoutePolicy('/plugin/wp/performance');
      expect(policy.capability).toBeNull();
    });
  });
});
