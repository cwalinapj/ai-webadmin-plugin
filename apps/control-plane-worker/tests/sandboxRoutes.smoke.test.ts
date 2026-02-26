import { beforeEach, describe, expect, it, vi } from 'vitest';

interface InMemoryRequest {
  id: string;
  plugin_id: string;
  site_id: string;
  requested_by_agent: string;
  task_type: string;
  priority_base: number;
  estimated_minutes: number;
  earliest_start_at: string | null;
  status: string;
  context_json: string | null;
  created_at: string;
  updated_at: string;
  claimed_by_agent: string | null;
  claimed_at: string | null;
}

interface InMemoryAllocation {
  id: string;
  request_id: string;
  sandbox_id: string;
  claimed_by_agent: string;
  start_at: string;
  end_at: string;
  status: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface InMemoryConflict {
  id: string;
  plugin_id: string;
  site_id: string;
  request_id: string | null;
  agent_id: string;
  conflict_type: string;
  severity: number;
  summary: string;
  details_json: string | null;
  blocked_by_request_id: string | null;
  sandbox_id: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  resolution_note: string | null;
  resolved_by_agent: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

const requests = new Map<string, InMemoryRequest>();
const votes = new Map<string, Map<string, number>>();
const allocations = new Map<string, InMemoryAllocation>();
const conflicts = new Map<string, InMemoryConflict>();

let requestCounter = 0;
let allocationCounter = 0;
let conflictCounter = 0;

vi.mock('../src/auth/verifySignature', () => ({
  verifySignedRequest: vi.fn(async () => ({
    ok: true,
    pluginId: 'plugin-1',
    nonce: crypto.randomUUID(),
    timestamp: Math.floor(Date.now() / 1000),
  })),
}));

vi.mock('../src/auth/replay', () => ({
  consumeNonce: vi.fn(async () => ({ ok: true })),
  consumeIdempotencyKey: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../src/durable/withSiteLock', () => ({
  withSiteLock: vi.fn(async (_namespace: unknown, _key: string, callback: () => Promise<unknown>) =>
    callback(),
  ),
}));

vi.mock('../src/sandbox/store', () => ({
  createSandboxRequest: vi.fn(
    async (
      _db: unknown,
      input: {
        pluginId: string;
        siteId: string;
        requestedByAgent: string;
        taskType: string;
        priorityBase: number;
        estimatedMinutes: number;
        earliestStartAt: string | null;
        contextJson: string | null;
      },
    ) => {
      requestCounter += 1;
      const id = `req-${requestCounter}`;
      const now = new Date().toISOString();
      const record: InMemoryRequest = {
        id,
        plugin_id: input.pluginId,
        site_id: input.siteId,
        requested_by_agent: input.requestedByAgent,
        task_type: input.taskType,
        priority_base: input.priorityBase,
        estimated_minutes: input.estimatedMinutes,
        earliest_start_at: input.earliestStartAt,
        status: 'queued',
        context_json: input.contextJson,
        created_at: now,
        updated_at: now,
        claimed_by_agent: null,
        claimed_at: null,
      };
      requests.set(id, record);
      return record;
    },
  ),
  upsertSandboxVote: vi.fn(
    async (_db: unknown, requestId: string, agentId: string, vote: number) => {
      const perRequest = votes.get(requestId) ?? new Map<string, number>();
      if (vote === 0) {
        perRequest.delete(agentId);
      } else {
        perRequest.set(agentId, vote);
      }
      votes.set(requestId, perRequest);
    },
  ),
  listQueuedSandboxRequestsWithVotes: vi.fn(async () => {
    return Array.from(requests.values())
      .filter((record) => record.status === 'queued')
      .map((record) => {
        const voteTotal = Array.from(votes.get(record.id)?.values() ?? []).reduce(
          (sum, vote) => sum + vote,
          0,
        );
        return {
          id: record.id,
          site_id: record.site_id,
          requested_by_agent: record.requested_by_agent,
          task_type: record.task_type,
          priority_base: record.priority_base,
          estimated_minutes: record.estimated_minutes,
          earliest_start_at: record.earliest_start_at,
          created_at: record.created_at,
          vote_total: voteTotal,
        };
      });
  }),
  claimSandboxRequest: vi.fn(async (_db: unknown, requestId: string, claimedByAgent: string) => {
    const record = requests.get(requestId);
    if (!record || record.status !== 'queued') {
      return false;
    }
    const now = new Date().toISOString();
    record.status = 'claimed';
    record.claimed_by_agent = claimedByAgent;
    record.claimed_at = now;
    record.updated_at = now;
    requests.set(requestId, record);
    return true;
  }),
  createSandboxAllocation: vi.fn(
    async (_db: unknown, requestId: string, sandboxId: string, claimedByAgent: string, slotMinutes: number) => {
      allocationCounter += 1;
      const id = `alloc-${allocationCounter}`;
      const start = new Date();
      const end = new Date(start.getTime() + slotMinutes * 60 * 1000);
      const record: InMemoryAllocation = {
        id,
        request_id: requestId,
        sandbox_id: sandboxId,
        claimed_by_agent: claimedByAgent,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        status: 'active',
        note: null,
        created_at: start.toISOString(),
        updated_at: start.toISOString(),
      };
      allocations.set(requestId, record);
      return record;
    },
  ),
  getSandboxRequestById: vi.fn(async (_db: unknown, requestId: string) => requests.get(requestId) ?? null),
  releaseSandboxRequest: vi.fn(
    async (
      _db: unknown,
      requestId: string,
      outcome: 'completed' | 'failed' | 'requeue',
      note: string | null,
    ) => {
      const record = requests.get(requestId);
      if (!record || (record.status !== 'claimed' && record.status !== 'running')) {
        return false;
      }

      if (outcome === 'requeue') {
        record.status = 'queued';
        record.claimed_by_agent = null;
        record.claimed_at = null;
      } else {
        record.status = outcome;
      }
      record.updated_at = new Date().toISOString();
      requests.set(requestId, record);

      const allocation = allocations.get(requestId);
      if (allocation) {
        allocation.status = 'released';
        allocation.note = note;
        allocation.updated_at = new Date().toISOString();
        allocations.set(requestId, allocation);
      }
      return true;
    },
  ),
  createSandboxConflict: vi.fn(
    async (
      _db: unknown,
      input: {
        pluginId: string;
        siteId: string;
        requestId: string | null;
        agentId: string;
        conflictType: string;
        severity: number;
        summary: string;
        detailsJson: string | null;
        blockedByRequestId: string | null;
        sandboxId: string | null;
      },
    ) => {
      conflictCounter += 1;
      const id = `conf-${conflictCounter}`;
      const now = new Date().toISOString();
      const record: InMemoryConflict = {
        id,
        plugin_id: input.pluginId,
        site_id: input.siteId,
        request_id: input.requestId,
        agent_id: input.agentId,
        conflict_type: input.conflictType,
        severity: input.severity,
        summary: input.summary,
        details_json: input.detailsJson,
        blocked_by_request_id: input.blockedByRequestId,
        sandbox_id: input.sandboxId,
        status: 'open',
        resolution_note: null,
        resolved_by_agent: null,
        resolved_at: null,
        created_at: now,
        updated_at: now,
      };
      conflicts.set(id, record);
      return record;
    },
  ),
  getSandboxConflictById: vi.fn(async (_db: unknown, conflictId: string) => conflicts.get(conflictId) ?? null),
  listSandboxConflicts: vi.fn(
    async (
      _db: unknown,
      input: {
        pluginId: string;
        siteId?: string;
        requestId?: string;
        status?: 'open' | 'resolved' | 'dismissed' | 'all';
        limit?: number;
      },
    ) => {
      const records = Array.from(conflicts.values())
        .filter((record) => record.plugin_id === input.pluginId)
        .filter((record) => !input.siteId || record.site_id === input.siteId)
        .filter((record) => !input.requestId || record.request_id === input.requestId)
        .filter((record) => !input.status || input.status === 'all' || record.status === input.status)
        .sort((left, right) => right.created_at.localeCompare(left.created_at));
      const limit = Math.max(1, Math.min(200, input.limit ?? 50));
      return records.slice(0, limit);
    },
  ),
  resolveSandboxConflict: vi.fn(
    async (
      _db: unknown,
      conflictId: string,
      pluginId: string,
      resolvedByAgent: string,
      status: 'resolved' | 'dismissed',
      resolutionNote: string | null,
    ) => {
      const record = conflicts.get(conflictId);
      if (!record || record.plugin_id !== pluginId || record.status !== 'open') {
        return false;
      }
      const now = new Date().toISOString();
      record.status = status;
      record.resolution_note = resolutionNote;
      record.resolved_by_agent = resolvedByAgent;
      record.resolved_at = now;
      record.updated_at = now;
      conflicts.set(conflictId, record);
      return true;
    },
  ),
}));

const { handleRequest } = await import('../src/routes');

const env = {
  DB: {} as D1Database,
  SITE_LOCK: {} as DurableObjectNamespace,
  JOB_QUEUE: {} as Queue,
  JOB_DLQ: {} as Queue,
  WP_PLUGIN_SHARED_SECRET: 'ignored-by-mock',
  CAP_TOKEN_UPTIME_WRITE: 'ignored-by-mock',
  CAP_TOKEN_SANDBOX_WRITE: 'ignored-by-mock',
  REPLAY_WINDOW_SECONDS: '300',
};

describe('sandbox routes smoke', () => {
  beforeEach(() => {
    requests.clear();
    votes.clear();
    allocations.clear();
    conflicts.clear();
    requestCounter = 0;
    allocationCounter = 0;
    conflictCounter = 0;
  });

  it('supports request, vote, claim, and release with vote-prioritized selection', async () => {
    const lowPriorityRes = await post('/plugin/wp/sandbox/request', {
      site_id: 'site-1',
      requested_by_agent: 'agent-low',
      task_type: 'scan',
      priority_base: 2,
      estimated_minutes: 25,
    });
    expect(lowPriorityRes.status).toBe(201);
    const lowPriorityBody = (await lowPriorityRes.json()) as {
      request: { id: string };
    };

    const highPriorityRes = await post('/plugin/wp/sandbox/request', {
      site_id: 'site-1',
      requested_by_agent: 'agent-high',
      task_type: 'patch',
      priority_base: 4,
      estimated_minutes: 15,
    });
    expect(highPriorityRes.status).toBe(201);
    const highPriorityBody = (await highPriorityRes.json()) as {
      request: { id: string };
    };

    // Push low priority request above high priority via collective voting.
    for (const voter of ['agent-v1', 'agent-v2', 'agent-v3']) {
      const voteRes = await post('/plugin/wp/sandbox/vote', {
        request_id: lowPriorityBody.request.id,
        agent_id: voter,
        vote: 4,
      });
      expect(voteRes.status).toBe(200);
    }

    const claimRes = await post('/plugin/wp/sandbox/claim', {
      agent_id: 'agent-runner',
      sandbox_id: 'sandbox-a',
      slot_minutes: 30,
    });
    expect(claimRes.status).toBe(200);
    const claimBody = (await claimRes.json()) as {
      selected_request: { id: string };
      allocation: { request_id: string };
    };

    expect(claimBody.selected_request.id).toBe(lowPriorityBody.request.id);
    expect(claimBody.selected_request.id).not.toBe(highPriorityBody.request.id);
    expect(claimBody.allocation.request_id).toBe(lowPriorityBody.request.id);

    const releaseRes = await post('/plugin/wp/sandbox/release', {
      request_id: lowPriorityBody.request.id,
      agent_id: 'agent-runner',
      outcome: 'completed',
      note: 'done',
    });
    expect(releaseRes.status).toBe(200);
    const releaseBody = (await releaseRes.json()) as { ok: boolean; outcome: string };
    expect(releaseBody.ok).toBe(true);
    expect(releaseBody.outcome).toBe('completed');
  });

  it('supports shared conflict pool report/list/resolve', async () => {
    const requestRes = await post('/plugin/wp/sandbox/request', {
      site_id: 'site-9',
      requested_by_agent: 'agent-a',
      task_type: 'migration',
      priority_base: 3,
      estimated_minutes: 30,
    });
    expect(requestRes.status).toBe(201);
    const requestBody = (await requestRes.json()) as { request: { id: string } };

    const reportRes = await post('/plugin/wp/sandbox/conflicts/report', {
      site_id: 'site-9',
      request_id: requestBody.request.id,
      agent_id: 'agent-a',
      conflict_type: 'resource_lock',
      severity: 4,
      summary: 'DB migration lock contention',
      details: { table: 'wp_options', reason: 'long-running transaction' },
      sandbox_id: 'sandbox-c1',
    });
    expect(reportRes.status).toBe(201);
    const reportBody = (await reportRes.json()) as {
      ok: boolean;
      conflict: { id: string; status: string; summary: string };
    };
    expect(reportBody.ok).toBe(true);
    expect(reportBody.conflict.status).toBe('open');
    expect(reportBody.conflict.summary).toBe('DB migration lock contention');

    const listOpenRes = await post('/plugin/wp/sandbox/conflicts/list', {
      site_id: 'site-9',
      status: 'open',
      limit: 20,
    });
    expect(listOpenRes.status).toBe(200);
    const listOpenBody = (await listOpenRes.json()) as {
      ok: boolean;
      count: number;
      conflicts: Array<{ id: string; status: string }>;
    };
    expect(listOpenBody.ok).toBe(true);
    expect(listOpenBody.count).toBe(1);
    expect(listOpenBody.conflicts[0]?.id).toBe(reportBody.conflict.id);
    expect(listOpenBody.conflicts[0]?.status).toBe('open');

    const resolveRes = await post('/plugin/wp/sandbox/conflicts/resolve', {
      conflict_id: reportBody.conflict.id,
      agent_id: 'agent-lead',
      status: 'resolved',
      resolution_note: 'Serialized operation order and retried migration.',
    });
    expect(resolveRes.status).toBe(200);
    const resolveBody = (await resolveRes.json()) as {
      ok: boolean;
      status: string;
      resolved_by_agent: string;
    };
    expect(resolveBody.ok).toBe(true);
    expect(resolveBody.status).toBe('resolved');
    expect(resolveBody.resolved_by_agent).toBe('agent-lead');

    const listResolvedRes = await post('/plugin/wp/sandbox/conflicts/list', {
      site_id: 'site-9',
      status: 'resolved',
      limit: 20,
    });
    expect(listResolvedRes.status).toBe(200);
    const listResolvedBody = (await listResolvedRes.json()) as {
      count: number;
      conflicts: Array<{ id: string; status: string; resolved_by_agent: string | null }>;
    };
    expect(listResolvedBody.count).toBe(1);
    expect(listResolvedBody.conflicts[0]?.id).toBe(reportBody.conflict.id);
    expect(listResolvedBody.conflicts[0]?.status).toBe('resolved');
    expect(listResolvedBody.conflicts[0]?.resolved_by_agent).toBe('agent-lead');
  });
});

async function post(path: string, payload: Record<string, unknown>): Promise<Response> {
  const request = new Request(`https://api.example.com${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return handleRequest(request, env as never);
}
