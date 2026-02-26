import { verifyLegacySignedRequest } from './auth/verifyLegacySignature';
import { consumeIdempotencyKey, consumeNonce } from './auth/replay';
import { verifySignedRequest } from './auth/verifySignature';
import { verifyWalletChallenge, type WalletVerifyPayload } from './auth/verifyWallet';
import { withSiteLock } from './durable/withSiteLock';
import { createJob } from './jobs/createJob';
import { heartbeatRiskScore, shouldCreateHeartbeatJob } from './policy/heartbeat';
import { enqueueJob } from './queue/publish';
import { pickNextSandboxRequest } from './sandbox/scheduler';
import {
  claimSandboxRequest,
  createSandboxAllocation,
  createSandboxConflict,
  createSandboxRequest,
  getSandboxConflictById,
  getSandboxRequestById,
  listSandboxConflicts,
  listQueuedSandboxRequestsWithVotes,
  resolveSandboxConflict,
  releaseSandboxRequest,
  upsertSandboxVote,
} from './sandbox/store';
import { upsertSite, type HeartbeatPayload } from './sites/upsertSite';
import type { Env } from './types';

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'POST' && url.pathname === '/plugin/wp/watchdog/heartbeat') {
    return handleHeartbeat(request, env, url.pathname);
  }

  if (request.method === 'POST' && url.pathname === '/plugin/wp/auth/wallet/verify') {
    return handleWalletVerify(request, env);
  }

  if (request.method === 'POST' && url.pathname === '/plugin/wp/sandbox/request') {
    return handleSandboxRequest(request, env, url.pathname);
  }

  if (request.method === 'POST' && url.pathname === '/plugin/wp/sandbox/vote') {
    return handleSandboxVote(request, env, url.pathname);
  }

  if (request.method === 'POST' && url.pathname === '/plugin/wp/sandbox/claim') {
    return handleSandboxClaim(request, env, url.pathname);
  }

  if (request.method === 'POST' && url.pathname === '/plugin/wp/sandbox/release') {
    return handleSandboxRelease(request, env, url.pathname);
  }

  if (request.method === 'POST' && url.pathname === '/plugin/wp/sandbox/conflicts/report') {
    return handleSandboxConflictReport(request, env, url.pathname);
  }

  if (request.method === 'POST' && url.pathname === '/plugin/wp/sandbox/conflicts/list') {
    return handleSandboxConflictList(request, env, url.pathname);
  }

  if (request.method === 'POST' && url.pathname === '/plugin/wp/sandbox/conflicts/resolve') {
    return handleSandboxConflictResolve(request, env, url.pathname);
  }

  return json({ ok: false, error: 'not_found' }, 404);
}

async function handleHeartbeat(request: Request, env: Env, path: string): Promise<Response> {
  const rawBody = await request.arrayBuffer();
  const authResult = await verifySignedRequest({
    request,
    rawBody,
    path,
    env,
  });

  if (!authResult.ok) {
    return json({ ok: false, error: authResult.error }, authResult.status);
  }

  const nonceResult = await consumeNonce(env.DB, authResult.pluginId, authResult.nonce);
  if (!nonceResult.ok) {
    return json({ ok: false, error: nonceResult.error }, nonceResult.status ?? 409);
  }

  const idempotencyResult = await consumeIdempotencyKey(
    env.DB,
    authResult.pluginId,
    request.headers.get('Idempotency-Key'),
  );
  if (!idempotencyResult.ok) {
    return json({ ok: false, error: idempotencyResult.error }, idempotencyResult.status ?? 400);
  }

  const payloadResult = parseHeartbeatPayload(rawBody);
  if (!payloadResult.ok) {
    return json({ ok: false, error: payloadResult.error }, 400);
  }

  const payload = payloadResult.payload;
  try {
    await withSiteLock(env.SITE_LOCK, payload.site_id, async () => {
      await upsertSite(env.DB, payload);

      if (shouldCreateHeartbeatJob(payload)) {
        const job = await createJob(env.DB, {
          siteId: payload.site_id,
          tab: 'uptime',
          type: 'investigate_health',
          status: 'queued',
          riskScore: heartbeatRiskScore(payload),
        });

        await enqueueJob(env.JOB_QUEUE, job);
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'site_lock_acquire_failed') {
      return json({ ok: false, error: 'site_lock_unavailable' }, 409);
    }
    return json({ ok: false, error: 'internal_error' }, 500);
  }

  return json({ ok: true, commands: [{ type: 'noop' }] }, 200);
}

async function handleWalletVerify(request: Request, env: Env): Promise<Response> {
  const rawBody = await request.arrayBuffer();
  const authResult = await verifyLegacySignedRequest({
    request,
    rawBody,
    env,
  });

  if (!authResult.ok) {
    return json({ ok: false, verified: false, error: authResult.error }, authResult.status);
  }

  const payloadResult = parseWalletVerifyPayload(rawBody);
  if (!payloadResult.ok) {
    return json({ ok: false, verified: false, error: payloadResult.error }, 400);
  }

  const verification = await verifyWalletChallenge(payloadResult.payload);
  if (!verification.ok) {
    return json(
      {
        ok: false,
        verified: false,
        error: verification.error,
      },
      verification.status,
    );
  }

  return json(
    {
      ok: true,
      verified: true,
      wallet_address: verification.walletAddress,
      wallet_network: verification.walletNetwork,
    },
    200,
  );
}

async function handleSandboxRequest(request: Request, env: Env, path: string): Promise<Response> {
  const auth = await authorizeSignedMutation(request, env, path);
  if (!auth.authorized) {
    return auth.response;
  }

  const payloadResult = parseSandboxRequestPayload(auth.rawBody);
  if (!payloadResult.ok) {
    return json({ ok: false, error: payloadResult.error }, 400);
  }

  const record = await createSandboxRequest(env.DB, {
    pluginId: auth.pluginId,
    siteId: payloadResult.payload.site_id,
    requestedByAgent: payloadResult.payload.requested_by_agent,
    taskType: payloadResult.payload.task_type,
    priorityBase: payloadResult.payload.priority_base,
    estimatedMinutes: payloadResult.payload.estimated_minutes,
    earliestStartAt: payloadResult.payload.earliest_start_at,
    contextJson: payloadResult.payload.context_json,
  });

  return json(
    {
      ok: true,
      request: record,
    },
    201,
  );
}

async function handleSandboxVote(request: Request, env: Env, path: string): Promise<Response> {
  const auth = await authorizeSignedMutation(request, env, path);
  if (!auth.authorized) {
    return auth.response;
  }

  const payloadResult = parseSandboxVotePayload(auth.rawBody);
  if (!payloadResult.ok) {
    return json({ ok: false, error: payloadResult.error }, 400);
  }

  const requestRecord = await getSandboxRequestById(env.DB, payloadResult.payload.request_id);
  if (!requestRecord) {
    return json({ ok: false, error: 'sandbox_request_not_found' }, 404);
  }

  await upsertSandboxVote(
    env.DB,
    payloadResult.payload.request_id,
    payloadResult.payload.agent_id,
    payloadResult.payload.vote,
    payloadResult.payload.reason,
  );

  return json(
    {
      ok: true,
      request_id: payloadResult.payload.request_id,
      agent_id: payloadResult.payload.agent_id,
      vote: payloadResult.payload.vote,
    },
    200,
  );
}

async function handleSandboxClaim(request: Request, env: Env, path: string): Promise<Response> {
  const auth = await authorizeSignedMutation(request, env, path);
  if (!auth.authorized) {
    return auth.response;
  }

  const payloadResult = parseSandboxClaimPayload(auth.rawBody);
  if (!payloadResult.ok) {
    return json({ ok: false, error: payloadResult.error }, 400);
  }

  try {
    const result = await withSiteLock(env.SITE_LOCK, '__sandbox_scheduler__', async () => {
      const queued = await listQueuedSandboxRequestsWithVotes(env.DB);
      const picked = pickNextSandboxRequest(queued);
      if (!picked) {
        return null;
      }

      const claimed = await claimSandboxRequest(env.DB, picked.request.id, payloadResult.payload.agent_id);
      if (!claimed) {
        return null;
      }

      const slotMinutes = payloadResult.payload.slot_minutes ?? picked.request.estimated_minutes;
      const sandboxId = payloadResult.payload.sandbox_id ?? `sandbox-${crypto.randomUUID().slice(0, 8)}`;
      const allocation = await createSandboxAllocation(
        env.DB,
        picked.request.id,
        sandboxId,
        payloadResult.payload.agent_id,
        slotMinutes,
      );

      return {
        selected: picked.request,
        score: picked.score,
        allocation,
      };
    });

    if (!result) {
      return json({ ok: false, error: 'no_sandbox_request_available' }, 409);
    }

    return json(
      {
        ok: true,
        selected_request: result.selected,
        selected_score: result.score,
        allocation: result.allocation,
      },
      200,
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'site_lock_acquire_failed') {
      return json({ ok: false, error: 'site_lock_unavailable' }, 409);
    }
    return json({ ok: false, error: 'internal_error' }, 500);
  }
}

async function handleSandboxRelease(request: Request, env: Env, path: string): Promise<Response> {
  const auth = await authorizeSignedMutation(request, env, path);
  if (!auth.authorized) {
    return auth.response;
  }

  const payloadResult = parseSandboxReleasePayload(auth.rawBody);
  if (!payloadResult.ok) {
    return json({ ok: false, error: payloadResult.error }, 400);
  }

  const requestRecord = await getSandboxRequestById(env.DB, payloadResult.payload.request_id);
  if (!requestRecord) {
    return json({ ok: false, error: 'sandbox_request_not_found' }, 404);
  }

  if (
    requestRecord.claimed_by_agent &&
    requestRecord.claimed_by_agent !== payloadResult.payload.agent_id &&
    requestRecord.requested_by_agent !== payloadResult.payload.agent_id
  ) {
    return json({ ok: false, error: 'sandbox_release_forbidden' }, 403);
  }

  const released = await releaseSandboxRequest(
    env.DB,
    payloadResult.payload.request_id,
    payloadResult.payload.outcome,
    payloadResult.payload.note,
  );
  if (!released) {
    return json({ ok: false, error: 'sandbox_release_conflict' }, 409);
  }

  return json(
    {
      ok: true,
      request_id: payloadResult.payload.request_id,
      outcome: payloadResult.payload.outcome,
    },
    200,
  );
}

async function handleSandboxConflictReport(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const auth = await authorizeSignedMutation(request, env, path);
  if (!auth.authorized) {
    return auth.response;
  }

  const payloadResult = parseSandboxConflictReportPayload(auth.rawBody);
  if (!payloadResult.ok) {
    return json({ ok: false, error: payloadResult.error }, 400);
  }

  if (payloadResult.payload.request_id) {
    const requestRecord = await getSandboxRequestById(env.DB, payloadResult.payload.request_id);
    if (!requestRecord) {
      return json({ ok: false, error: 'sandbox_request_not_found' }, 404);
    }
    if (requestRecord.plugin_id !== auth.pluginId) {
      return json({ ok: false, error: 'sandbox_request_forbidden' }, 403);
    }
    if (requestRecord.site_id !== payloadResult.payload.site_id) {
      return json({ ok: false, error: 'sandbox_conflict_site_mismatch' }, 400);
    }
  }

  const conflict = await createSandboxConflict(env.DB, {
    pluginId: auth.pluginId,
    siteId: payloadResult.payload.site_id,
    requestId: payloadResult.payload.request_id,
    agentId: payloadResult.payload.agent_id,
    conflictType: payloadResult.payload.conflict_type,
    severity: payloadResult.payload.severity,
    summary: payloadResult.payload.summary,
    detailsJson: payloadResult.payload.details_json,
    blockedByRequestId: payloadResult.payload.blocked_by_request_id,
    sandboxId: payloadResult.payload.sandbox_id,
  });

  return json({ ok: true, conflict }, 201);
}

async function handleSandboxConflictList(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const auth = await authorizeSignedMutation(request, env, path);
  if (!auth.authorized) {
    return auth.response;
  }

  const payloadResult = parseSandboxConflictListPayload(auth.rawBody);
  if (!payloadResult.ok) {
    return json({ ok: false, error: payloadResult.error }, 400);
  }

  const conflicts = await listSandboxConflicts(env.DB, {
    pluginId: auth.pluginId,
    siteId: payloadResult.payload.site_id ?? undefined,
    requestId: payloadResult.payload.request_id ?? undefined,
    status: payloadResult.payload.status,
    limit: payloadResult.payload.limit,
  });

  return json(
    {
      ok: true,
      count: conflicts.length,
      conflicts,
    },
    200,
  );
}

async function handleSandboxConflictResolve(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const auth = await authorizeSignedMutation(request, env, path);
  if (!auth.authorized) {
    return auth.response;
  }

  const payloadResult = parseSandboxConflictResolvePayload(auth.rawBody);
  if (!payloadResult.ok) {
    return json({ ok: false, error: payloadResult.error }, 400);
  }

  const conflict = await getSandboxConflictById(env.DB, payloadResult.payload.conflict_id);
  if (!conflict || conflict.plugin_id !== auth.pluginId) {
    return json({ ok: false, error: 'sandbox_conflict_not_found' }, 404);
  }

  const resolved = await resolveSandboxConflict(
    env.DB,
    payloadResult.payload.conflict_id,
    auth.pluginId,
    payloadResult.payload.agent_id,
    payloadResult.payload.status,
    payloadResult.payload.resolution_note,
  );
  if (!resolved) {
    return json({ ok: false, error: 'sandbox_conflict_already_closed' }, 409);
  }

  return json(
    {
      ok: true,
      conflict_id: payloadResult.payload.conflict_id,
      status: payloadResult.payload.status,
      resolved_by_agent: payloadResult.payload.agent_id,
    },
    200,
  );
}

async function authorizeSignedMutation(
  request: Request,
  env: Env,
  path: string,
):
  Promise<
    | {
        authorized: true;
        rawBody: ArrayBuffer;
        pluginId: string;
      }
    | {
        authorized: false;
        response: Response;
      }
  > {
  const rawBody = await request.arrayBuffer();
  const authResult = await verifySignedRequest({
    request,
    rawBody,
    path,
    env,
  });
  if (!authResult.ok) {
    return { authorized: false, response: json({ ok: false, error: authResult.error }, authResult.status) };
  }

  const nonceResult = await consumeNonce(env.DB, authResult.pluginId, authResult.nonce);
  if (!nonceResult.ok) {
    return {
      authorized: false,
      response: json({ ok: false, error: nonceResult.error }, nonceResult.status ?? 409),
    };
  }

  const idempotencyResult = await consumeIdempotencyKey(
    env.DB,
    authResult.pluginId,
    request.headers.get('Idempotency-Key'),
  );
  if (!idempotencyResult.ok) {
    return {
      authorized: false,
      response: json({ ok: false, error: idempotencyResult.error }, idempotencyResult.status ?? 400),
    };
  }

  return {
    authorized: true,
    rawBody,
    pluginId: authResult.pluginId,
  };
}

function parseHeartbeatPayload(
  rawBody: ArrayBuffer,
):
  | {
      ok: true;
      payload: HeartbeatPayload;
    }
  | {
      ok: false;
      error: string;
    } {
  const text = new TextDecoder().decode(rawBody);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'invalid_payload' };
  }

  const payload = parsed as Record<string, unknown>;
  const siteId = typeof payload.site_id === 'string' ? payload.site_id.trim() : '';
  const domain = typeof payload.domain === 'string' ? payload.domain.trim() : '';

  if (siteId === '' || domain === '') {
    return { ok: false, error: 'missing_site_or_domain' };
  }

  return {
    ok: true,
    payload: {
      site_id: siteId,
      domain,
      plan: typeof payload.plan === 'string' ? payload.plan : 'unknown',
      timezone: typeof payload.timezone === 'string' ? payload.timezone : 'UTC',
      wp_version: typeof payload.wp_version === 'string' ? payload.wp_version : '',
      php_version: typeof payload.php_version === 'string' ? payload.php_version : '',
      theme: typeof payload.theme === 'string' ? payload.theme : '',
      active_plugins_count:
        typeof payload.active_plugins_count === 'number' ? payload.active_plugins_count : 0,
      load_avg: Array.isArray(payload.load_avg)
        ? payload.load_avg.map((item) => Number(item)).filter((item) => Number.isFinite(item))
        : [],
      error_counts:
        payload.error_counts && typeof payload.error_counts === 'object'
          ? Object.fromEntries(
              Object.entries(payload.error_counts as Record<string, unknown>).map(([key, value]) => [
                key,
                Number(value),
              ]),
            )
          : {},
      site_url: typeof payload.site_url === 'string' ? payload.site_url : '',
    },
  };
}

function parseSandboxRequestPayload(
  rawBody: ArrayBuffer,
):
  | {
      ok: true;
      payload: {
        site_id: string;
        requested_by_agent: string;
        task_type: string;
        priority_base: number;
        estimated_minutes: number;
        earliest_start_at: string | null;
        context_json: string | null;
      };
    }
  | {
      ok: false;
      error: string;
    } {
  const parsedResult = parseJsonObjectBody(rawBody);
  if (!parsedResult.ok) {
    return parsedResult;
  }
  const payload = parsedResult.payload;

  const siteId = typeof payload.site_id === 'string' ? payload.site_id.trim() : '';
  const requestedByAgent =
    typeof payload.requested_by_agent === 'string' ? payload.requested_by_agent.trim() : '';
  if (siteId === '' || requestedByAgent === '') {
    return { ok: false, error: 'missing_site_or_agent' };
  }

  const taskType =
    typeof payload.task_type === 'string' && payload.task_type.trim() !== ''
      ? payload.task_type.trim()
      : 'generic';
  const priorityBase = clampInteger(payload.priority_base, 1, 5, 3);
  const estimatedMinutes = clampInteger(payload.estimated_minutes, 5, 240, 30);
  const earliestStartAt = normalizeOptionalIsoString(payload.earliest_start_at);

  let contextJson: string | null = null;
  if (payload.context && typeof payload.context === 'object') {
    contextJson = JSON.stringify(payload.context);
  }

  return {
    ok: true,
    payload: {
      site_id: siteId,
      requested_by_agent: requestedByAgent,
      task_type: taskType,
      priority_base: priorityBase,
      estimated_minutes: estimatedMinutes,
      earliest_start_at: earliestStartAt,
      context_json: contextJson,
    },
  };
}

function parseSandboxVotePayload(
  rawBody: ArrayBuffer,
):
  | {
      ok: true;
      payload: {
        request_id: string;
        agent_id: string;
        vote: number;
        reason: string | null;
      };
    }
  | {
      ok: false;
      error: string;
    } {
  const parsedResult = parseJsonObjectBody(rawBody);
  if (!parsedResult.ok) {
    return parsedResult;
  }
  const payload = parsedResult.payload;

  const requestId = typeof payload.request_id === 'string' ? payload.request_id.trim() : '';
  const agentId = typeof payload.agent_id === 'string' ? payload.agent_id.trim() : '';
  if (requestId === '' || agentId === '') {
    return { ok: false, error: 'missing_request_or_agent' };
  }

  const vote = clampInteger(payload.vote, -5, 5, 0);
  const reason =
    typeof payload.reason === 'string' && payload.reason.trim() !== ''
      ? payload.reason.trim().slice(0, 280)
      : null;

  return {
    ok: true,
    payload: {
      request_id: requestId,
      agent_id: agentId,
      vote,
      reason,
    },
  };
}

function parseSandboxClaimPayload(
  rawBody: ArrayBuffer,
):
  | {
      ok: true;
      payload: {
        agent_id: string;
        sandbox_id: string | null;
        slot_minutes: number | null;
      };
    }
  | {
      ok: false;
      error: string;
    } {
  const parsedResult = parseJsonObjectBody(rawBody);
  if (!parsedResult.ok) {
    return parsedResult;
  }
  const payload = parsedResult.payload;

  const agentId = typeof payload.agent_id === 'string' ? payload.agent_id.trim() : '';
  if (agentId === '') {
    return { ok: false, error: 'missing_agent_id' };
  }

  const sandboxId =
    typeof payload.sandbox_id === 'string' && payload.sandbox_id.trim() !== ''
      ? payload.sandbox_id.trim().slice(0, 64)
      : null;
  const slotMinutesRaw =
    typeof payload.slot_minutes === 'number' || typeof payload.slot_minutes === 'string'
      ? Number.parseInt(String(payload.slot_minutes), 10)
      : NaN;
  const slotMinutes = Number.isInteger(slotMinutesRaw)
    ? Math.max(5, Math.min(240, slotMinutesRaw))
    : null;

  return {
    ok: true,
    payload: {
      agent_id: agentId,
      sandbox_id: sandboxId,
      slot_minutes: slotMinutes,
    },
  };
}

function parseSandboxReleasePayload(
  rawBody: ArrayBuffer,
):
  | {
      ok: true;
      payload: {
        request_id: string;
        agent_id: string;
        outcome: 'completed' | 'failed' | 'requeue';
        note: string | null;
      };
    }
  | {
      ok: false;
      error: string;
    } {
  const parsedResult = parseJsonObjectBody(rawBody);
  if (!parsedResult.ok) {
    return parsedResult;
  }
  const payload = parsedResult.payload;

  const requestId = typeof payload.request_id === 'string' ? payload.request_id.trim() : '';
  const agentId = typeof payload.agent_id === 'string' ? payload.agent_id.trim() : '';
  if (requestId === '' || agentId === '') {
    return { ok: false, error: 'missing_request_or_agent' };
  }

  const outcomeRaw =
    typeof payload.outcome === 'string' ? payload.outcome.trim().toLowerCase() : 'completed';
  const outcome: 'completed' | 'failed' | 'requeue' =
    outcomeRaw === 'failed' || outcomeRaw === 'requeue' ? outcomeRaw : 'completed';
  const note =
    typeof payload.note === 'string' && payload.note.trim() !== ''
      ? payload.note.trim().slice(0, 500)
      : null;

  return {
    ok: true,
    payload: {
      request_id: requestId,
      agent_id: agentId,
      outcome,
      note,
    },
  };
}

function parseSandboxConflictReportPayload(
  rawBody: ArrayBuffer,
):
  | {
      ok: true;
      payload: {
        site_id: string;
        request_id: string | null;
        agent_id: string;
        conflict_type: string;
        severity: number;
        summary: string;
        details_json: string | null;
        blocked_by_request_id: string | null;
        sandbox_id: string | null;
      };
    }
  | {
      ok: false;
      error: string;
    } {
  const parsedResult = parseJsonObjectBody(rawBody);
  if (!parsedResult.ok) {
    return parsedResult;
  }
  const payload = parsedResult.payload;

  const siteId = typeof payload.site_id === 'string' ? payload.site_id.trim() : '';
  const agentId = typeof payload.agent_id === 'string' ? payload.agent_id.trim() : '';
  const summary = typeof payload.summary === 'string' ? payload.summary.trim().slice(0, 280) : '';
  if (siteId === '' || agentId === '' || summary === '') {
    return { ok: false, error: 'missing_conflict_fields' };
  }

  const requestId =
    typeof payload.request_id === 'string' && payload.request_id.trim() !== ''
      ? payload.request_id.trim()
      : null;
  const conflictType =
    typeof payload.conflict_type === 'string' && payload.conflict_type.trim() !== ''
      ? payload.conflict_type.trim().slice(0, 64)
      : 'general';
  const severity = clampInteger(payload.severity, 1, 5, 3);
  const blockedByRequestId =
    typeof payload.blocked_by_request_id === 'string' && payload.blocked_by_request_id.trim() !== ''
      ? payload.blocked_by_request_id.trim()
      : null;
  const sandboxId =
    typeof payload.sandbox_id === 'string' && payload.sandbox_id.trim() !== ''
      ? payload.sandbox_id.trim().slice(0, 64)
      : null;

  let detailsJson: string | null = null;
  if (typeof payload.details === 'string' && payload.details.trim() !== '') {
    detailsJson = payload.details.trim().slice(0, 4000);
  } else if (payload.details && typeof payload.details === 'object') {
    detailsJson = JSON.stringify(payload.details).slice(0, 4000);
  }

  return {
    ok: true,
    payload: {
      site_id: siteId,
      request_id: requestId,
      agent_id: agentId,
      conflict_type: conflictType,
      severity: severity,
      summary: summary,
      details_json: detailsJson,
      blocked_by_request_id: blockedByRequestId,
      sandbox_id: sandboxId,
    },
  };
}

function parseSandboxConflictListPayload(
  rawBody: ArrayBuffer,
):
  | {
      ok: true;
      payload: {
        site_id: string | null;
        request_id: string | null;
        status: 'open' | 'resolved' | 'dismissed' | 'all';
        limit: number;
      };
    }
  | {
      ok: false;
      error: string;
    } {
  const parsedResult = parseJsonObjectBody(rawBody);
  if (!parsedResult.ok) {
    return parsedResult;
  }
  const payload = parsedResult.payload;

  const siteId =
    typeof payload.site_id === 'string' && payload.site_id.trim() !== '' ? payload.site_id.trim() : null;
  const requestId =
    typeof payload.request_id === 'string' && payload.request_id.trim() !== ''
      ? payload.request_id.trim()
      : null;
  const statusRaw = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : 'open';
  const status: 'open' | 'resolved' | 'dismissed' | 'all' =
    statusRaw === 'resolved' || statusRaw === 'dismissed' || statusRaw === 'all'
      ? statusRaw
      : 'open';
  const limit = clampInteger(payload.limit, 1, 200, 50);

  return {
    ok: true,
    payload: {
      site_id: siteId,
      request_id: requestId,
      status,
      limit,
    },
  };
}

function parseSandboxConflictResolvePayload(
  rawBody: ArrayBuffer,
):
  | {
      ok: true;
      payload: {
        conflict_id: string;
        agent_id: string;
        status: 'resolved' | 'dismissed';
        resolution_note: string | null;
      };
    }
  | {
      ok: false;
      error: string;
    } {
  const parsedResult = parseJsonObjectBody(rawBody);
  if (!parsedResult.ok) {
    return parsedResult;
  }
  const payload = parsedResult.payload;

  const conflictId = typeof payload.conflict_id === 'string' ? payload.conflict_id.trim() : '';
  const agentId = typeof payload.agent_id === 'string' ? payload.agent_id.trim() : '';
  if (conflictId === '' || agentId === '') {
    return { ok: false, error: 'missing_conflict_or_agent' };
  }

  const statusRaw = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : 'resolved';
  const status: 'resolved' | 'dismissed' = statusRaw === 'dismissed' ? 'dismissed' : 'resolved';
  const resolutionNote =
    typeof payload.resolution_note === 'string' && payload.resolution_note.trim() !== ''
      ? payload.resolution_note.trim().slice(0, 500)
      : null;

  return {
    ok: true,
    payload: {
      conflict_id: conflictId,
      agent_id: agentId,
      status,
      resolution_note: resolutionNote,
    },
  };
}

function parseWalletVerifyPayload(
  rawBody: ArrayBuffer,
):
  | {
      ok: true;
      payload: WalletVerifyPayload;
    }
  | {
      ok: false;
      error: string;
    } {
  const text = new TextDecoder().decode(rawBody);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'invalid_payload' };
  }

  const payload = parsed as Record<string, unknown>;

  if (
    typeof payload.wallet_address !== 'string' ||
    typeof payload.wallet_signature !== 'string' ||
    typeof payload.wallet_message !== 'string'
  ) {
    return { ok: false, error: 'missing_wallet_fields' };
  }

  return {
    ok: true,
    payload: {
      wallet_address: payload.wallet_address.trim(),
      wallet_signature: payload.wallet_signature.trim(),
      wallet_message: payload.wallet_message,
      wallet_network: typeof payload.wallet_network === 'string' ? payload.wallet_network : 'ethereum',
    },
  };
}

function parseJsonObjectBody(
  rawBody: ArrayBuffer,
):
  | {
      ok: true;
      payload: Record<string, unknown>;
    }
  | {
      ok: false;
      error: string;
    } {
  const text = new TextDecoder().decode(rawBody);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'invalid_payload' };
  }

  return {
    ok: true,
    payload: parsed as Record<string, unknown>,
  };
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed =
    typeof value === 'number'
      ? Math.floor(value)
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : NaN;
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function normalizeOptionalIsoString(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }
  return new Date(parsedMs).toISOString();
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}
