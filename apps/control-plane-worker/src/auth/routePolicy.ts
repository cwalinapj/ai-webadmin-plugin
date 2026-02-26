export type RouteCapability = 'uptime' | 'analytics' | 'sandbox' | 'host_optimizer' | null;

export interface RoutePolicy {
  capability: RouteCapability;
  requireNonce: boolean;
  requireIdempotency: boolean;
}

interface RoutePolicyRule extends RoutePolicy {
  match: 'exact' | 'prefix';
  value: string;
}

const DEFAULT_SIGNED_POLICY: RoutePolicy = {
  capability: null,
  requireNonce: true,
  requireIdempotency: true,
};

const ROUTE_POLICY_RULES: RoutePolicyRule[] = [
  {
    match: 'exact',
    value: '/plugin/wp/watchdog/heartbeat',
    capability: 'uptime',
    requireNonce: true,
    requireIdempotency: true,
  },
  {
    match: 'exact',
    value: '/plugin/site/watchdog/heartbeat',
    capability: 'uptime',
    requireNonce: true,
    requireIdempotency: true,
  },
  {
    match: 'prefix',
    value: '/plugin/wp/performance/',
    capability: 'uptime',
    requireNonce: true,
    requireIdempotency: true,
  },
  {
    match: 'prefix',
    value: '/plugin/site/performance/',
    capability: 'uptime',
    requireNonce: true,
    requireIdempotency: true,
  },
  {
    match: 'prefix',
    value: '/plugin/wp/updates/',
    capability: 'uptime',
    requireNonce: true,
    requireIdempotency: true,
  },
  {
    match: 'prefix',
    value: '/plugin/site/updates/',
    capability: 'uptime',
    requireNonce: true,
    requireIdempotency: true,
  },
  {
    match: 'prefix',
    value: '/plugin/wp/sandbox/',
    capability: 'sandbox',
    requireNonce: true,
    requireIdempotency: true,
  },
  {
    match: 'prefix',
    value: '/plugin/site/sandbox/',
    capability: 'sandbox',
    requireNonce: true,
    requireIdempotency: true,
  },
  {
    match: 'exact',
    value: '/plugin/wp/host-optimizer/baseline',
    capability: 'host_optimizer',
    requireNonce: true,
    requireIdempotency: true,
  },
  {
    match: 'exact',
    value: '/plugin/site/host-optimizer/baseline',
    capability: 'host_optimizer',
    requireNonce: true,
    requireIdempotency: true,
  },
  {
    match: 'prefix',
    value: '/plugin/wp/analytics/',
    capability: 'analytics',
    requireNonce: true,
    requireIdempotency: true,
  },
  {
    match: 'prefix',
    value: '/plugin/site/analytics/',
    capability: 'analytics',
    requireNonce: true,
    requireIdempotency: true,
  },
  {
    match: 'prefix',
    value: '/plugin/wp/incident/',
    capability: 'uptime',
    requireNonce: true,
    requireIdempotency: true,
  },
  {
    match: 'prefix',
    value: '/plugin/site/incident/',
    capability: 'uptime',
    requireNonce: true,
    requireIdempotency: true,
  },
  {
    match: 'prefix',
    value: '/plugin/wp/jobs/',
    capability: 'uptime',
    requireNonce: true,
    requireIdempotency: true,
  },
  {
    match: 'prefix',
    value: '/plugin/site/jobs/',
    capability: 'uptime',
    requireNonce: true,
    requireIdempotency: true,
  },
  {
    match: 'exact',
    value: '/plugin/wp/auth/wallet/verify',
    capability: null,
    requireNonce: true,
    requireIdempotency: true,
  },
  {
    match: 'exact',
    value: '/plugin/site/auth/wallet/verify',
    capability: null,
    requireNonce: true,
    requireIdempotency: true,
  },
];

export function resolveRoutePolicy(path: string): RoutePolicy {
  for (const rule of ROUTE_POLICY_RULES) {
    if (rule.match === 'exact' && path === rule.value) {
      return {
        capability: rule.capability,
        requireNonce: rule.requireNonce,
        requireIdempotency: rule.requireIdempotency,
      };
    }

    if (rule.match === 'prefix' && path.startsWith(rule.value)) {
      return {
        capability: rule.capability,
        requireNonce: rule.requireNonce,
        requireIdempotency: rule.requireIdempotency,
      };
    }
  }

  return DEFAULT_SIGNED_POLICY;
}
