import { describe, expect, it } from 'vitest';
import { resolveRoutePolicy } from '../src/auth/routePolicy';

describe('resolveRoutePolicy', () => {
  it('matches exact path /plugin/wp/watchdog/heartbeat', () => {
    const policy = resolveRoutePolicy('/plugin/wp/watchdog/heartbeat');
    expect(policy.capability).toBe('uptime');
    expect(policy.requireNonce).toBe(true);
    expect(policy.requireIdempotency).toBe(true);
  });

  it('matches exact path /plugin/site/watchdog/heartbeat', () => {
    const policy = resolveRoutePolicy('/plugin/site/watchdog/heartbeat');
    expect(policy.capability).toBe('uptime');
    expect(policy.requireNonce).toBe(true);
    expect(policy.requireIdempotency).toBe(true);
  });

  it('matches prefix /plugin/wp/performance/', () => {
    const policy = resolveRoutePolicy('/plugin/wp/performance/report');
    expect(policy.capability).toBe('uptime');
  });

  it('matches prefix /plugin/site/performance/', () => {
    const policy = resolveRoutePolicy('/plugin/site/performance/summary');
    expect(policy.capability).toBe('uptime');
  });

  it('matches prefix /plugin/wp/updates/', () => {
    const policy = resolveRoutePolicy('/plugin/wp/updates/check');
    expect(policy.capability).toBe('uptime');
  });

  it('matches prefix /plugin/site/updates/', () => {
    const policy = resolveRoutePolicy('/plugin/site/updates/apply');
    expect(policy.capability).toBe('uptime');
  });

  it('matches prefix /plugin/wp/sandbox/', () => {
    const policy = resolveRoutePolicy('/plugin/wp/sandbox/create');
    expect(policy.capability).toBe('sandbox');
  });

  it('matches prefix /plugin/site/sandbox/', () => {
    const policy = resolveRoutePolicy('/plugin/site/sandbox/destroy');
    expect(policy.capability).toBe('sandbox');
  });

  it('matches exact /plugin/wp/host-optimizer/baseline', () => {
    const policy = resolveRoutePolicy('/plugin/wp/host-optimizer/baseline');
    expect(policy.capability).toBe('host_optimizer');
  });

  it('matches exact /plugin/site/host-optimizer/baseline', () => {
    const policy = resolveRoutePolicy('/plugin/site/host-optimizer/baseline');
    expect(policy.capability).toBe('host_optimizer');
  });

  it('matches prefix /plugin/wp/analytics/', () => {
    const policy = resolveRoutePolicy('/plugin/wp/analytics/events');
    expect(policy.capability).toBe('analytics');
  });

  it('matches prefix /plugin/site/analytics/', () => {
    const policy = resolveRoutePolicy('/plugin/site/analytics/events');
    expect(policy.capability).toBe('analytics');
  });

  it('matches prefix /plugin/wp/incident/', () => {
    const policy = resolveRoutePolicy('/plugin/wp/incident/report');
    expect(policy.capability).toBe('uptime');
  });

  it('matches prefix /plugin/site/incident/', () => {
    const policy = resolveRoutePolicy('/plugin/site/incident/report');
    expect(policy.capability).toBe('uptime');
  });

  it('matches prefix /plugin/wp/jobs/', () => {
    const policy = resolveRoutePolicy('/plugin/wp/jobs/list');
    expect(policy.capability).toBe('uptime');
  });

  it('matches prefix /plugin/site/jobs/', () => {
    const policy = resolveRoutePolicy('/plugin/site/jobs/list');
    expect(policy.capability).toBe('uptime');
  });

  it('matches exact /plugin/wp/auth/wallet/verify with null capability', () => {
    const policy = resolveRoutePolicy('/plugin/wp/auth/wallet/verify');
    expect(policy.capability).toBeNull();
    expect(policy.requireNonce).toBe(true);
    expect(policy.requireIdempotency).toBe(true);
  });

  it('matches exact /plugin/site/auth/wallet/verify with null capability', () => {
    const policy = resolveRoutePolicy('/plugin/site/auth/wallet/verify');
    expect(policy.capability).toBeNull();
  });

  it('returns DEFAULT_SIGNED_POLICY for unknown path', () => {
    const policy = resolveRoutePolicy('/unknown/path');
    expect(policy.capability).toBeNull();
    expect(policy.requireNonce).toBe(true);
    expect(policy.requireIdempotency).toBe(true);
  });

  it('does not match prefix for path that is not a sub-path', () => {
    // /plugin/wp/performance is not under /plugin/wp/performance/ (missing trailing slash)
    const policy = resolveRoutePolicy('/plugin/wp/performance');
    expect(policy.capability).toBeNull();
  });

  it('does not match exact path for sub-path variant', () => {
    const policy = resolveRoutePolicy('/plugin/wp/watchdog/heartbeat/extra');
    // no exact match — falls through to default
    expect(policy.capability).toBeNull();
  });
});
