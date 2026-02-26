import { describe, expect, it } from 'vitest';
import {
  computeSandboxRequestScore,
  isRequestReady,
  pickNextSandboxRequest,
  type RankedSandboxRequest,
} from '../src/sandbox/scheduler';

const nowMs = Date.parse('2026-02-26T01:00:00.000Z');

function makeRequest(
  overrides: Partial<RankedSandboxRequest> = {},
): RankedSandboxRequest {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    site_id: overrides.site_id ?? 'site-1',
    requested_by_agent: overrides.requested_by_agent ?? 'agent-a',
    task_type: overrides.task_type ?? 'upgrade',
    priority_base: overrides.priority_base ?? 3,
    estimated_minutes: overrides.estimated_minutes ?? 30,
    earliest_start_at: overrides.earliest_start_at ?? null,
    created_at: overrides.created_at ?? '2026-02-26T00:30:00.000Z',
    vote_total: overrides.vote_total ?? 0,
  };
}

describe('sandbox scheduler scoring', () => {
  it('weights votes and priority when scoring', () => {
    const base = makeRequest({ priority_base: 3, vote_total: 0 });
    const higherVotes = makeRequest({ priority_base: 3, vote_total: 4 });
    const higherPriority = makeRequest({ priority_base: 5, vote_total: 0 });

    expect(computeSandboxRequestScore(higherVotes, nowMs)).toBeGreaterThan(
      computeSandboxRequestScore(base, nowMs),
    );
    expect(computeSandboxRequestScore(higherPriority, nowMs)).toBeGreaterThan(
      computeSandboxRequestScore(higherVotes, nowMs),
    );
  });

  it('marks future earliest_start requests as not ready', () => {
    const ready = makeRequest({ earliest_start_at: '2026-02-26T00:00:00.000Z' });
    const notReady = makeRequest({ earliest_start_at: '2026-02-26T03:00:00.000Z' });

    expect(isRequestReady(ready, nowMs)).toBe(true);
    expect(isRequestReady(notReady, nowMs)).toBe(false);
  });

  it('picks highest scored ready request and ignores future requests', () => {
    const low = makeRequest({
      id: 'low',
      priority_base: 2,
      vote_total: 0,
      created_at: '2026-02-26T00:59:00.000Z',
    });
    const high = makeRequest({
      id: 'high',
      priority_base: 4,
      vote_total: 3,
      created_at: '2026-02-26T00:50:00.000Z',
    });
    const future = makeRequest({
      id: 'future',
      priority_base: 5,
      vote_total: 5,
      earliest_start_at: '2026-02-26T05:00:00.000Z',
    });

    const picked = pickNextSandboxRequest([low, high, future], nowMs);
    expect(picked).not.toBeNull();
    expect(picked?.request.id).toBe('high');
  });
});
