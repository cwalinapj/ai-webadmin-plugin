import { describe, expect, it } from 'vitest';
import { resolveRoutePolicy } from '../src/auth/routePolicy';

describe('resolveRoutePolicy', () => {
  describe('exact path matching', () => {
    it('matches /plugin/wp/watchdog/heartbeat exactly', () => {
      const policy = resolveRoutePolicy('/plugin/wp/watchdog/heartbeat');
      expect(policy.capability).toBe('uptime');
      expect(policy.requireNonce).toBe(true);
      expect(policy.requireIdempotency).toBe(true);
    });

    it('matches /plugin/site/watchdog/heartbeat exactly', () => {
      const policy = resolveRoutePolicy('/plugin/site/watchdog/heartbeat');
      expect(policy.capability).toBe('uptime');
    });

    it('does not match /plugin/wp/watchdog/heartbeat with trailing slash', () => {
      const policy = resolveRoutePolicy('/plugin/wp/watchdog/heartbeat/');
      expect(policy.capability).toBeNull();
    });

    it('matches /plugin/wp/host-optimizer/baseline exactly', () => {
      const policy = resolveRoutePolicy('/plugin/wp/host-optimizer/baseline');
      expect(policy.capability).toBe('host_optimizer');
    });

    it('matches /plugin/site/host-optimizer/baseline exactly', () => {
      const policy = resolveRoutePolicy('/plugin/site/host-optimizer/baseline');
      expect(policy.capability).toBe('host_optimizer');
    });

    it('matches /plugin/wp/auth/wallet/verify exactly with null capability', () => {
      const policy = resolveRoutePolicy('/plugin/wp/auth/wallet/verify');
      expect(policy.capability).toBeNull();
      expect(policy.requireNonce).toBe(true);
      expect(policy.requireIdempotency).toBe(true);
    });

    it('matches /plugin/site/auth/wallet/verify exactly with null capability', () => {
      const policy = resolveRoutePolicy('/plugin/site/auth/wallet/verify');
      expect(policy.capability).toBeNull();
    });
  });

  describe('prefix path matching', () => {
    it('matches /plugin/wp/performance/ prefix', () => {
      const policy = resolveRoutePolicy('/plugin/wp/performance/slo/evaluate');
      expect(policy.capability).toBe('uptime');
    });

    it('matches /plugin/site/performance/ prefix', () => {
      const policy = resolveRoutePolicy('/plugin/site/performance/report');
      expect(policy.capability).toBe('uptime');
    });

    it('matches /plugin/wp/updates/ prefix', () => {
      const policy = resolveRoutePolicy('/plugin/wp/updates/safe/run');
      expect(policy.capability).toBe('uptime');
    });

    it('matches /plugin/site/updates/ prefix', () => {
      const policy = resolveRoutePolicy('/plugin/site/updates/safe/run');
      expect(policy.capability).toBe('uptime');
    });

    it('matches /plugin/wp/sandbox/ prefix', () => {
      const policy = resolveRoutePolicy('/plugin/wp/sandbox/create');
      expect(policy.capability).toBe('sandbox');
    });

    it('matches /plugin/site/sandbox/ prefix', () => {
      const policy = resolveRoutePolicy('/plugin/site/sandbox/create');
      expect(policy.capability).toBe('sandbox');
    });

    it('matches /plugin/wp/analytics/ prefix', () => {
      const policy = resolveRoutePolicy('/plugin/wp/analytics/goals/assistant');
      expect(policy.capability).toBe('analytics');
    });

    it('matches /plugin/site/analytics/ prefix', () => {
      const policy = resolveRoutePolicy('/plugin/site/analytics/goals/assistant');
      expect(policy.capability).toBe('analytics');
    });

    it('matches /plugin/wp/incident/ prefix', () => {
      const policy = resolveRoutePolicy('/plugin/wp/incident/mode');
      expect(policy.capability).toBe('uptime');
    });

    it('matches /plugin/site/incident/ prefix', () => {
      const policy = resolveRoutePolicy('/plugin/site/incident/mode');
      expect(policy.capability).toBe('uptime');
    });

    it('matches /plugin/wp/jobs/ prefix', () => {
      const policy = resolveRoutePolicy('/plugin/wp/jobs/reports');
      expect(policy.capability).toBe('uptime');
    });

    it('matches /plugin/site/jobs/ prefix', () => {
      const policy = resolveRoutePolicy('/plugin/site/jobs/reports');
      expect(policy.capability).toBe('uptime');
    });
  });

  describe('DEFAULT_SIGNED_POLICY fallback', () => {
    it('returns default policy for an unrecognized path', () => {
      const policy = resolveRoutePolicy('/unknown/route');
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

    it('returns default policy for partial prefix without trailing slash', () => {
      // '/plugin/wp/analytics' does not start with '/plugin/wp/analytics/'
      const policy = resolveRoutePolicy('/plugin/wp/analytics');
      expect(policy.capability).toBeNull();
    });
  });
});
