import type { RankedSandboxRequest } from './scheduler';

export interface CreateSandboxRequestInput {
  pluginId: string;
  siteId: string;
  requestedByAgent: string;
  taskType: string;
  priorityBase: number;
  estimatedMinutes: number;
  earliestStartAt: string | null;
  contextJson: string | null;
}

export interface SandboxRequestRecord {
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

export interface SandboxAllocationRecord {
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

export interface SandboxConflictRecord {
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

export interface CreateSandboxConflictInput {
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
}

export interface ListSandboxConflictsInput {
  pluginId: string;
  siteId?: string;
  requestId?: string;
  status?: 'open' | 'resolved' | 'dismissed' | 'all';
  limit?: number;
}

export async function createSandboxRequest(
  db: D1Database,
  input: CreateSandboxRequestInput,
): Promise<SandboxRequestRecord> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO sandbox_requests (
         id, plugin_id, site_id, requested_by_agent, task_type, priority_base, estimated_minutes,
         earliest_start_at, status, context_json, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'queued', ?9, ?10, ?11)`,
    )
    .bind(
      id,
      input.pluginId,
      input.siteId,
      input.requestedByAgent,
      input.taskType,
      input.priorityBase,
      input.estimatedMinutes,
      input.earliestStartAt,
      input.contextJson,
      now,
      now,
    )
    .run();

  return {
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
}

export async function upsertSandboxVote(
  db: D1Database,
  requestId: string,
  agentId: string,
  vote: number,
  reason: string | null,
): Promise<void> {
  const now = new Date().toISOString();

  if (vote === 0) {
    await db
      .prepare('DELETE FROM sandbox_votes WHERE request_id = ?1 AND agent_id = ?2')
      .bind(requestId, agentId)
      .run();
    return;
  }

  await db
    .prepare(
      `INSERT INTO sandbox_votes (request_id, agent_id, vote, reason, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(request_id, agent_id) DO UPDATE SET
         vote = excluded.vote,
         reason = excluded.reason,
         updated_at = excluded.updated_at`,
    )
    .bind(requestId, agentId, vote, reason, now, now)
    .run();
}

export async function listQueuedSandboxRequestsWithVotes(
  db: D1Database,
): Promise<RankedSandboxRequest[]> {
  const result = await db
    .prepare(
      `SELECT
         r.id,
         r.site_id,
         r.requested_by_agent,
         r.task_type,
         r.priority_base,
         r.estimated_minutes,
         r.earliest_start_at,
         r.created_at,
         COALESCE(SUM(v.vote), 0) AS vote_total
       FROM sandbox_requests r
       LEFT JOIN sandbox_votes v ON v.request_id = r.id
       WHERE r.status = 'queued'
       GROUP BY
         r.id, r.site_id, r.requested_by_agent, r.task_type, r.priority_base,
         r.estimated_minutes, r.earliest_start_at, r.created_at`,
    )
    .all<{
      id: string;
      site_id: string;
      requested_by_agent: string;
      task_type: string;
      priority_base: number;
      estimated_minutes: number;
      earliest_start_at: string | null;
      created_at: string;
      vote_total: number;
    }>();

  return (result.results ?? []).map((row) => ({
    id: row.id,
    site_id: row.site_id,
    requested_by_agent: row.requested_by_agent,
    task_type: row.task_type,
    priority_base: Number(row.priority_base),
    estimated_minutes: Number(row.estimated_minutes),
    earliest_start_at: row.earliest_start_at,
    created_at: row.created_at,
    vote_total: Number(row.vote_total ?? 0),
  }));
}

export async function claimSandboxRequest(
  db: D1Database,
  requestId: string,
  claimedByAgent: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE sandbox_requests
       SET status = 'claimed',
           claimed_by_agent = ?1,
           claimed_at = ?2,
           updated_at = ?2
       WHERE id = ?3
         AND status = 'queued'`,
    )
    .bind(claimedByAgent, now, requestId)
    .run();

  return Number(result.meta?.changes ?? 0) > 0;
}

export async function createSandboxAllocation(
  db: D1Database,
  requestId: string,
  sandboxId: string,
  claimedByAgent: string,
  slotMinutes: number,
): Promise<SandboxAllocationRecord> {
  const id = crypto.randomUUID();
  const start = new Date();
  const end = new Date(start.getTime() + slotMinutes * 60 * 1000);
  const now = start.toISOString();

  await db
    .prepare(
      `INSERT INTO sandbox_allocations (
         id, request_id, sandbox_id, claimed_by_agent, start_at, end_at, status, note, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', NULL, ?7, ?8)`,
    )
    .bind(id, requestId, sandboxId, claimedByAgent, start.toISOString(), end.toISOString(), now, now)
    .run();

  return {
    id,
    request_id: requestId,
    sandbox_id: sandboxId,
    claimed_by_agent: claimedByAgent,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    status: 'active',
    note: null,
    created_at: now,
    updated_at: now,
  };
}

export async function getSandboxRequestById(
  db: D1Database,
  requestId: string,
): Promise<SandboxRequestRecord | null> {
  const result = await db
    .prepare('SELECT * FROM sandbox_requests WHERE id = ?1 LIMIT 1')
    .bind(requestId)
    .first<SandboxRequestRecord>();
  return result ?? null;
}

export async function releaseSandboxRequest(
  db: D1Database,
  requestId: string,
  outcome: 'completed' | 'failed' | 'requeue',
  note: string | null,
): Promise<boolean> {
  const now = new Date().toISOString();

  if (outcome === 'requeue') {
    const result = await db
      .prepare(
        `UPDATE sandbox_requests
         SET status = 'queued',
             claimed_by_agent = NULL,
             claimed_at = NULL,
             updated_at = ?1
         WHERE id = ?2
           AND status IN ('claimed', 'running')`,
      )
      .bind(now, requestId)
      .run();

    if (Number(result.meta?.changes ?? 0) === 0) {
      return false;
    }

    await db
      .prepare(
        `UPDATE sandbox_allocations
         SET status = 'released',
             note = ?1,
             updated_at = ?2
         WHERE request_id = ?3
           AND status = 'active'`,
      )
      .bind(note, now, requestId)
      .run();

    return true;
  }

  const result = await db
    .prepare(
      `UPDATE sandbox_requests
       SET status = ?1,
           updated_at = ?2
       WHERE id = ?3
         AND status IN ('claimed', 'running')`,
    )
    .bind(outcome, now, requestId)
    .run();

  if (Number(result.meta?.changes ?? 0) === 0) {
    return false;
  }

  await db
    .prepare(
      `UPDATE sandbox_allocations
       SET status = 'released',
           note = ?1,
           updated_at = ?2
       WHERE request_id = ?3
         AND status = 'active'`,
    )
    .bind(note, now, requestId)
    .run();

  return true;
}

export async function createSandboxConflict(
  db: D1Database,
  input: CreateSandboxConflictInput,
): Promise<SandboxConflictRecord> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO sandbox_conflicts (
         id, plugin_id, site_id, request_id, agent_id, conflict_type, severity, summary,
         details_json, blocked_by_request_id, sandbox_id, status, resolution_note,
         resolved_by_agent, resolved_at, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'open', NULL, NULL, NULL, ?12, ?13)`,
    )
    .bind(
      id,
      input.pluginId,
      input.siteId,
      input.requestId,
      input.agentId,
      input.conflictType,
      input.severity,
      input.summary,
      input.detailsJson,
      input.blockedByRequestId,
      input.sandboxId,
      now,
      now,
    )
    .run();

  return {
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
}

export async function getSandboxConflictById(
  db: D1Database,
  conflictId: string,
): Promise<SandboxConflictRecord | null> {
  const result = await db
    .prepare('SELECT * FROM sandbox_conflicts WHERE id = ?1 LIMIT 1')
    .bind(conflictId)
    .first<SandboxConflictRecord>();
  return result ?? null;
}

export async function listSandboxConflicts(
  db: D1Database,
  input: ListSandboxConflictsInput,
): Promise<SandboxConflictRecord[]> {
  const conditions = ['plugin_id = ?1'];
  const binds: Array<string | number | null> = [input.pluginId];
  let nextBind = 2;

  if (input.siteId) {
    conditions.push(`site_id = ?${nextBind}`);
    binds.push(input.siteId);
    nextBind += 1;
  }

  if (input.requestId) {
    conditions.push(`request_id = ?${nextBind}`);
    binds.push(input.requestId);
    nextBind += 1;
  }

  if (input.status && input.status !== 'all') {
    conditions.push(`status = ?${nextBind}`);
    binds.push(input.status);
    nextBind += 1;
  }

  const limit = Math.max(1, Math.min(200, input.limit ?? 50));
  const query = `SELECT * FROM sandbox_conflicts
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE status WHEN 'open' THEN 0 WHEN 'resolved' THEN 1 ELSE 2 END ASC,
      created_at DESC
    LIMIT ?${nextBind}`;

  const result = await db
    .prepare(query)
    .bind(...binds, limit)
    .all<SandboxConflictRecord>();

  return result.results ?? [];
}

export async function resolveSandboxConflict(
  db: D1Database,
  conflictId: string,
  pluginId: string,
  resolvedByAgent: string,
  status: 'resolved' | 'dismissed',
  resolutionNote: string | null,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE sandbox_conflicts
       SET status = ?1,
           resolution_note = ?2,
           resolved_by_agent = ?3,
           resolved_at = ?4,
           updated_at = ?4
       WHERE id = ?5
         AND plugin_id = ?6
         AND status = 'open'`,
    )
    .bind(status, resolutionNote, resolvedByAgent, now, conflictId, pluginId)
    .run();

  return Number(result.meta?.changes ?? 0) > 0;
}
