import { verifyLegacySignedRequest } from './auth/verifyLegacySignature';
import { consumeIdempotencyKey, consumeNonce } from './auth/replay';
import { resolveRoutePolicy } from './auth/routePolicy';
import { verifySignedRequest } from './auth/verifySignature';
import { verifyWalletChallenge, type WalletVerifyPayload } from './auth/verifyWallet';
import { type GoalAssistantPayload } from './analytics/buildGoalAssistant';
import { buildGoalAssistantPlanWithAI } from './analytics/buildGoalAssistantWithAI';
import { runWatchdogLbAutomation, type WatchdogLbAutomationResult } from './automation/watchdogLbAutomation';
import { checkSandboxBillingAccess, upsertBillingSubscription } from './billing/subscription';
import {
  evaluateAndReserveSandboxBudget,
  reconcileSandboxBudgetReservation,
  type SandboxBudgetDecision,
} from './cost/sandboxBudget';
import { withSiteLock } from './durable/withSiteLock';
import { ensureGa4Conversions } from './google/ga4';
import { deployGtm } from './google/gtm';
import {
  buildGoogleAuthUrl,
  createOauthSession,
  exchangeCodeForTokens,
  getGoogleToken,
  getGoogleUserEmail,
  getOauthSession,
  refreshGoogleAccessToken,
  saveRefreshedAccessToken,
  updateOauthSession,
  upsertGoogleToken,
} from './google/oauth';
import { createHostOptimizerBaseline } from './hostOptimizer/store';
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

  if (request.method === 'POST' && matchesPath(url.pathname, ['/internal/billing/subscription/upsert'])) {
    return handleInternalBillingSubscriptionUpsert(request, env);
  }

  if (
    request.method === 'POST' &&
    matchesPath(url.pathname, ['/plugin/wp/watchdog/heartbeat', '/plugin/site/watchdog/heartbeat'])
  ) {
    return handleHeartbeat(request, env, url.pathname);
  }

  if (
    request.method === 'POST' &&
    matchesPath(url.pathname, ['/plugin/wp/auth/wallet/verify', '/plugin/site/auth/wallet/verify'])
  ) {
    return handleWalletVerify(request, env);
  }

  if (
    request.method === 'POST' &&
    matchesPath(url.pathname, [
      '/plugin/wp/host-optimizer/baseline',
      '/plugin/site/host-optimizer/baseline',
    ])
  ) {
    return handleHostOptimizerBaseline(request, env, url.pathname);
  }

  if (
    request.method === 'POST' &&
    matchesPath(url.pathname, [
      '/plugin/wp/analytics/goals/assistant',
      '/plugin/site/analytics/goals/assistant',
    ])
  ) {
    return handleGoalAssistant(request, env, url.pathname);
  }

  if (
    request.method === 'POST' &&
    matchesPath(url.pathname, ['/plugin/wp/sandbox/request', '/plugin/site/sandbox/request'])
  ) {
    return handleSandboxRequest(request, env, url.pathname);
  }

  if (
    request.method === 'POST' &&
    matchesPath(url.pathname, ['/plugin/wp/sandbox/vote', '/plugin/site/sandbox/vote'])
  ) {
    return handleSandboxVote(request, env, url.pathname);
  }

  if (
    request.method === 'POST' &&
    matchesPath(url.pathname, ['/plugin/wp/sandbox/claim', '/plugin/site/sandbox/claim'])
  ) {
    return handleSandboxClaim(request, env, url.pathname);
  }

  if (
    request.method === 'POST' &&
    matchesPath(url.pathname, ['/plugin/wp/sandbox/release', '/plugin/site/sandbox/release'])
  ) {
    return handleSandboxRelease(request, env, url.pathname);
  }

  if (
    request.method === 'POST' &&
    matchesPath(url.pathname, [
      '/plugin/wp/sandbox/conflicts/report',
      '/plugin/site/sandbox/conflicts/report',
    ])
  ) {
    return handleSandboxConflictReport(request, env, url.pathname);
  }

  if (
    request.method === 'POST' &&
    matchesPath(url.pathname, [
      '/plugin/wp/sandbox/conflicts/list',
      '/plugin/site/sandbox/conflicts/list',
    ])
  ) {
    return handleSandboxConflictList(request, env, url.pathname);
  }

  if (
    request.method === 'POST' &&
    matchesPath(url.pathname, [
      '/plugin/wp/sandbox/conflicts/resolve',
      '/plugin/site/sandbox/conflicts/resolve',
    ])
  ) {
    return handleSandboxConflictResolve(request, env, url.pathname);
  }

  return json({ ok: false, error: 'not_found' }, 404);
}

function matchesPath(pathname: string, candidates: string[]): boolean {
  return candidates.includes(pathname);
}

async function handleInternalBillingSubscriptionUpsert(
  request: Request,
  env: Env,
): Promise<Response> {
  const token = env.BILLING_INTERNAL_API_TOKEN?.trim() ?? '';
  if (token === '') {
    return json({ ok: false, error: 'billing_internal_api_token_not_configured' }, 500);
  }

  const authorization = request.headers.get('authorization')?.trim() ?? '';
  const incomingToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!timingSafeEqual(incomingToken, token)) {
    return json({ ok: false, error: 'forbidden' }, 403);
  }

  const payloadResult = parseBillingSubscriptionUpsertPayload(await request.arrayBuffer());
  if (!payloadResult.ok) {
    return json({ ok: false, error: payloadResult.error }, 400);
  }

  try {
    await upsertBillingSubscription(env.DB, {
      siteId: payloadResult.payload.site_id,
      pluginId: payloadResult.payload.plugin_id,
      planCode: payloadResult.payload.plan_code,
      status: payloadResult.payload.status,
      sandboxEnabled: payloadResult.payload.sandbox_enabled,
      currentPeriodEnd: payloadResult.payload.current_period_end,
      gracePeriodEnd: payloadResult.payload.grace_period_end,
    });
  } catch {
    return json({ ok: false, error: 'billing_upsert_failed' }, 500);
  }

  return json(
    {
      ok: true,
      site_id: payloadResult.payload.site_id,
      plugin_id: payloadResult.payload.plugin_id,
      status: payloadResult.payload.status,
      sandbox_enabled: payloadResult.payload.sandbox_enabled,
    },
    200,
  );
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

  const replayGuard = await enforceReplayProtection(
    request,
    env,
    path,
    authResult.pluginId,
    authResult.nonce,
  );
  if (!replayGuard.ok) {
    return replayGuard.response;
  }

  const payloadResult = parseHeartbeatPayload(rawBody);
  if (!payloadResult.ok) {
    return json({ ok: false, error: payloadResult.error }, 400);
  }

  const payload = payloadResult.payload;
  let automation: WatchdogLbAutomationResult | null = null;
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

      automation = await runWatchdogLbAutomation(env, {
        pluginId: authResult.pluginId,
        payload,
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'site_lock_acquire_failed') {
      return json({ ok: false, error: 'site_lock_unavailable' }, 409);
    }
    return json({ ok: false, error: 'internal_error' }, 500);
  }

  return json({ ok: true, commands: [{ type: 'noop' }], automation }, 200);
}

async function handleGoogleConnectStart(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const oauthConfigError = ensureGoogleOauthConfig(env);
  if (oauthConfigError) {
    return json({ ok: false, error: oauthConfigError }, 500);
  }

  const auth = await authorizeSignedMutation(request, env, path);
  if (!auth.authorized) {
    return auth.response;
  }

  const payloadResult = parseGoogleConnectStartPayload(auth.rawBody);
  if (!payloadResult.ok) {
    return json({ ok: false, error: payloadResult.error }, 400);
  }

  if (payloadResult.payload.site_id === '') {
    return json({ ok: false, error: 'missing_site_id' }, 400);
  }

  const sessionId = await createOauthSession(env.DB, {
    pluginId: auth.pluginId,
    siteId: payloadResult.payload.site_id,
    returnUrl: payloadResult.payload.return_url,
  });
  const authUrl = buildGoogleAuthUrl(env, sessionId);

  return json(
    {
      ok: true,
      session_id: sessionId,
      auth_url: authUrl,
      commands: [{ type: 'noop' }],
    },
    200,
  );
}

async function handleGoogleCallback(request: Request, env: Env): Promise<Response> {
  const oauthConfigError = ensureGoogleOauthConfig(env);
  if (oauthConfigError) {
    return json({ ok: false, error: oauthConfigError }, 500);
  }

  const url = new URL(request.url);
  const state = (url.searchParams.get('state') ?? '').trim();
  const code = (url.searchParams.get('code') ?? '').trim();
  const oauthError = (url.searchParams.get('error') ?? '').trim();
  if (state === '') {
    return json({ ok: false, error: 'missing_state' }, 400);
  }

  const session = await getOauthSession(env.DB, state);
  if (!session) {
    return json({ ok: false, error: 'session_not_found' }, 404);
  }

  if (oauthError !== '') {
    await updateOauthSession(env.DB, session.id, 'error', oauthError);
    return createReturnRedirect(session.return_url, { awp_google_error: oauthError });
  }

  if (code === '') {
    await updateOauthSession(env.DB, session.id, 'error', 'missing_code');
    return createReturnRedirect(session.return_url, { awp_google_error: 'missing_code' });
  }

  try {
    const exchanged = await exchangeCodeForTokens(env, code);
    await upsertGoogleToken(env.DB, {
      siteId: session.site_id,
      pluginId: session.plugin_id,
      refreshToken: exchanged.refreshToken,
      accessToken: exchanged.accessToken,
      scope: exchanged.scope,
      tokenType: exchanged.tokenType,
      expiresAt: exchanged.expiresAt,
    });
    await updateOauthSession(env.DB, session.id, 'connected', null);
    return createReturnRedirect(session.return_url, { awp_google_connected: '1' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'oauth_exchange_failed';
    await updateOauthSession(env.DB, session.id, 'error', message);
    return createReturnRedirect(session.return_url, { awp_google_error: message });
  }
}

async function handleGoogleStatus(request: Request, env: Env, path: string): Promise<Response> {
  const auth = await authorizeSignedMutation(request, env, path);
  if (!auth.authorized) {
    return auth.response;
  }

  const payloadResult = parseGoogleStatusPayload(auth.rawBody);
  if (!payloadResult.ok) {
    return json({ ok: false, error: payloadResult.error }, 400);
  }

  const token = await getGoogleToken(env.DB, payloadResult.payload.site_id);
  if (!token || token.plugin_id !== auth.pluginId) {
    return json(
      {
        ok: true,
        connected: false,
        email: '',
        commands: [{ type: 'noop' }],
      },
      200,
    );
  }

  try {
    const accessToken = await ensureGoogleAccessToken(env, token);
    const email = await getGoogleUserEmail(accessToken);

    return json(
      {
        ok: true,
        connected: true,
        email,
        commands: [{ type: 'noop' }],
      },
      200,
    );
  } catch (error) {
    return json(
      {
        ok: true,
        connected: false,
        email: '',
        error: error instanceof Error ? error.message : 'google_token_error',
        commands: [{ type: 'noop' }],
      },
      200,
    );
  }
}

async function handleGoogleDeploy(request: Request, env: Env, path: string): Promise<Response> {
  const auth = await authorizeSignedMutation(request, env, path);
  if (!auth.authorized) {
    return auth.response;
  }

  const payloadResult = parseGoogleDeployPayload(auth.rawBody);
  if (!payloadResult.ok) {
    return json({ ok: false, error: payloadResult.error }, 400);
  }
  const payload = payloadResult.payload;

  const token = await getGoogleToken(env.DB, payload.site_id);
  if (!token || token.plugin_id !== auth.pluginId) {
    return json({ ok: false, error: 'google_not_connected' }, 409);
  }

  const uniqueConversionEvents = mergeConversionEvents(
    payload.primary_conversion,
    payload.secondary_conversions,
  );

  try {
    const output = await withSiteLock(env.SITE_LOCK, payload.site_id, async () => {
      const accessToken = await ensureGoogleAccessToken(env, token);
      if (payload.dry_run) {
        return {
          dry_run: true,
          events: uniqueConversionEvents,
          gtm: {
            status: 'skipped',
            reason: 'dry_run',
          },
          ga4: {
            status: 'skipped',
            reason: 'dry_run',
          },
        };
      }

      const [gtmResult, ga4Result] = await Promise.all([
        deployGtm(accessToken, {
          gtmAccountId: payload.gtm_account_id,
          gtmContainerId: payload.gtm_container_id,
          gtmWorkspaceName: payload.gtm_workspace_name,
          ga4MeasurementId: payload.ga4_measurement_id,
          conversionEvents: uniqueConversionEvents,
        }),
        ensureGa4Conversions(accessToken, payload.ga4_property_id, uniqueConversionEvents),
      ]);

      return {
        dry_run: false,
        events: uniqueConversionEvents,
        gtm: gtmResult,
        ga4: ga4Result,
      };
    });

    await createJob(env.DB, {
      siteId: payload.site_id,
      tab: 'analytics',
      type: 'google_deploy',
      status: payload.dry_run ? 'dry_run' : 'completed',
      riskScore: 0,
    });

    return json(
      {
        ok: true,
        deploy: output,
        commands: [{ type: 'noop' }],
      },
      200,
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'site_lock_acquire_failed') {
      return json({ ok: false, error: 'site_lock_unavailable' }, 409);
    }

    const message = error instanceof Error ? error.message : 'google_deploy_failed';
    await createJob(env.DB, {
      siteId: payload.site_id,
      tab: 'analytics',
      type: 'google_deploy',
      status: 'failed',
      riskScore: 0.7,
    });

    return json({ ok: false, error: message }, 500);
  }
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

async function handleHostOptimizerBaseline(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const auth = await authorizeSignedMutation(request, env, path);
  if (!auth.authorized) {
    return auth.response;
  }

  const payloadResult = parseHostOptimizerBaselinePayload(auth.rawBody);
  if (!payloadResult.ok) {
    return json({ ok: false, error: payloadResult.error }, 400);
  }

  const record = await createHostOptimizerBaseline(env.DB, {
    pluginId: auth.pluginId,
    siteUrl: payloadResult.payload.site_url,
    providerName: payloadResult.payload.provider_name,
    regionLabel: payloadResult.payload.region_label,
    virtualizationOs: payloadResult.payload.virtualization_os,
    cpuModel: payloadResult.payload.cpu_model,
    cpuYear: payloadResult.payload.cpu_year,
    ramGb: payloadResult.payload.ram_gb,
    memoryClass: payloadResult.payload.memory_class,
    webserverType: payloadResult.payload.webserver_type,
    storageType: payloadResult.payload.storage_type,
    uplinkMbps: payloadResult.payload.uplink_mbps,
    gpuAccelerationMode: payloadResult.payload.gpu_acceleration_mode,
    gpuModel: payloadResult.payload.gpu_model,
    gpuCount: payloadResult.payload.gpu_count,
    gpuVramGb: payloadResult.payload.gpu_vram_gb,
    reason: payloadResult.payload.reason,
    capturedAt: payloadResult.payload.captured_at,
    homeTtfbMs: payloadResult.payload.home_ttfb_ms,
    restTtfbMs: payloadResult.payload.rest_ttfb_ms,
    cpuOpsPerSec: payloadResult.payload.cpu_ops_per_sec,
    diskWriteMbPerSec: payloadResult.payload.disk_write_mb_per_sec,
    diskReadMbPerSec: payloadResult.payload.disk_read_mb_per_sec,
    memoryPressureScore: payloadResult.payload.memory_pressure_score,
    payloadJson: payloadResult.payload.payload_json,
  });

  return json(
    {
      ok: true,
      baseline_id: record.id,
      plugin_id: record.plugin_id,
      captured_at: record.captured_at,
      ingested_at: record.ingested_at,
    },
    201,
  );
}

async function handleGoalAssistant(request: Request, env: Env, path: string): Promise<Response> {
  const auth = await authorizeSignedMutation(request, env, path);
  if (!auth.authorized) {
    return auth.response;
  }

  const payloadResult = parseGoalAssistantPayload(auth.rawBody);
  if (!payloadResult.ok) {
    return json({ ok: false, error: payloadResult.error }, 400);
  }

  const plannerResult = await buildGoalAssistantPlanWithAI(payloadResult.payload, env);

  return json(
    {
      ok: true,
      plan: plannerResult.plan,
      planner: plannerResult.planner,
      commands: [{ type: 'noop' }],
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

  const requestId = crypto.randomUUID();
  let budgetDecision: SandboxBudgetDecision | null = null;
  if (typeof (env.DB as { prepare?: unknown }).prepare === 'function') {
    const billingEnforcementEnabled = toBoolean(env.BILLING_SANDBOX_ENFORCEMENT, false);
    const billing = await checkSandboxBillingAccess(env.DB, {
      siteId: payloadResult.payload.site_id,
      pluginId: auth.pluginId,
      defaultAllow: toBoolean(env.BILLING_SANDBOX_DEFAULT_ALLOW, true),
    });
    if (billingEnforcementEnabled && !billing.allowed) {
      return json(
        {
          ok: false,
          error: 'sandbox_subscription_inactive',
          subscription_status: billing.status,
          reason: billing.reason,
        },
        402,
      );
    }

    budgetDecision = await evaluateAndReserveSandboxBudget(env.DB, {
      siteId: payloadResult.payload.site_id,
      pluginId: auth.pluginId,
      requestId,
      estimatedMinutes: payloadResult.payload.estimated_minutes,
      allowOverage: payloadResult.payload.allow_overage,
      defaultBudgetUsd: numberOrDefault(env.SANDBOX_DEFAULT_MONTHLY_BUDGET_USD, 50),
      defaultCostPerMinuteUsd: numberOrDefault(env.SANDBOX_DEFAULT_COST_PER_MINUTE_USD, 0.08),
      defaultHardLimit: toBoolean(env.SANDBOX_DEFAULT_HARD_LIMIT, true),
    });
    if (!budgetDecision.allowed) {
      return json(
        {
          ok: false,
          error: 'sandbox_budget_exceeded',
          budget: budgetDecision,
        },
        402,
      );
    }
  }

  const record = await createSandboxRequest(env.DB, {
    requestId,
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
      budget: budgetDecision,
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

  let reconciliation:
    | Awaited<ReturnType<typeof reconcileSandboxBudgetReservation>>
    | { ok: false; reason: 'unsupported_mock_db' } = { ok: false, reason: 'unsupported_mock_db' };
  if (typeof (env.DB as { prepare?: unknown }).prepare === 'function') {
    reconciliation = await reconcileSandboxBudgetReservation(env.DB, {
      requestId: payloadResult.payload.request_id,
      siteId: requestRecord.site_id,
      actualMinutes: payloadResult.payload.actual_runtime_minutes ?? requestRecord.estimated_minutes,
      outcome: payloadResult.payload.outcome,
    });
  }

  return json(
    {
      ok: true,
      request_id: payloadResult.payload.request_id,
      outcome: payloadResult.payload.outcome,
      billing_reconciliation: reconciliation,
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

  const replayGuard = await enforceReplayProtection(
    request,
    env,
    path,
    authResult.pluginId,
    authResult.nonce,
  );
  if (!replayGuard.ok) {
    return {
      authorized: false,
      response: replayGuard.response,
    };
  }

  return {
    authorized: true,
    rawBody,
    pluginId: authResult.pluginId,
  };
}

async function enforceReplayProtection(
  request: Request,
  env: Env,
  path: string,
  pluginId: string,
  nonce: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const policy = resolveRoutePolicy(path);

  if (policy.requireNonce) {
    const nonceResult = await consumeNonce(env.DB, pluginId, nonce);
    if (!nonceResult.ok) {
      return {
        ok: false,
        response: json({ ok: false, error: nonceResult.error }, nonceResult.status ?? 409),
      };
    }
  }

  if (policy.requireIdempotency) {
    const idempotencyResult = await consumeIdempotencyKey(
      env.DB,
      pluginId,
      request.headers.get('Idempotency-Key'),
    );
    if (!idempotencyResult.ok) {
      return {
        ok: false,
        response: json({ ok: false, error: idempotencyResult.error }, idempotencyResult.status ?? 400),
      };
    }
  }

  return { ok: true };
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
      traffic_rps: optionalFiniteNumber(payload.traffic_rps),
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

function parseHostOptimizerBaselinePayload(
  rawBody: ArrayBuffer,
):
  | {
      ok: true;
      payload: {
        site_url: string;
        provider_name: string;
        region_label: string;
        virtualization_os: string;
        cpu_model: string;
        cpu_year: string;
        ram_gb: string;
        memory_class: string;
        webserver_type: string;
        storage_type: string;
        uplink_mbps: string;
        gpu_acceleration_mode: string;
        gpu_model: string;
        gpu_count: string;
        gpu_vram_gb: string;
        reason: string;
        captured_at: string;
        home_ttfb_ms: number | null;
        rest_ttfb_ms: number | null;
        cpu_ops_per_sec: number | null;
        disk_write_mb_per_sec: number | null;
        disk_read_mb_per_sec: number | null;
        memory_pressure_score: number | null;
        payload_json: string;
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

  const profile =
    payload.profile && typeof payload.profile === 'object' && !Array.isArray(payload.profile)
      ? (payload.profile as Record<string, unknown>)
      : {};
  const metrics =
    payload.metrics && typeof payload.metrics === 'object' && !Array.isArray(payload.metrics)
      ? (payload.metrics as Record<string, unknown>)
      : {};

  const capturedAt = normalizeOptionalIsoString(payload.captured_at) ?? new Date().toISOString();
  const reason = limitText(payload.reason, 64, 'manual');

  const payloadJson = JSON.stringify(payload);
  if (typeof payloadJson !== 'string') {
    return { ok: false, error: 'invalid_payload_json' };
  }
  if (payloadJson.length > 200_000) {
    return { ok: false, error: 'payload_too_large' };
  }

  return {
    ok: true,
    payload: {
      site_url: limitText(payload.site_url, 500, ''),
      provider_name: limitText(profile.provider_name, 160, ''),
      region_label: limitText(profile.region_label, 160, ''),
      virtualization_os: limitText(profile.virtualization_os, 64, ''),
      cpu_model: limitText(profile.cpu_model, 180, ''),
      cpu_year: limitText(profile.cpu_year, 16, ''),
      ram_gb: limitText(profile.ram_gb, 24, ''),
      memory_class: limitText(profile.memory_class, 24, ''),
      webserver_type: limitText(profile.webserver_type, 40, ''),
      storage_type: limitText(profile.storage_type, 32, ''),
      uplink_mbps: limitText(profile.uplink_mbps, 32, ''),
      gpu_acceleration_mode: limitText(profile.gpu_acceleration_mode, 24, ''),
      gpu_model: limitText(profile.gpu_model, 180, ''),
      gpu_count: limitText(profile.gpu_count, 16, ''),
      gpu_vram_gb: limitText(profile.gpu_vram_gb, 16, ''),
      reason,
      captured_at: capturedAt,
      home_ttfb_ms: nestedNumber(metrics, ['home_ttfb', 'ms']),
      rest_ttfb_ms: nestedNumber(metrics, ['rest_ttfb', 'ms']),
      cpu_ops_per_sec: nestedNumber(metrics, ['cpu_benchmark', 'ops_per_sec']),
      disk_write_mb_per_sec: nestedNumber(metrics, ['disk_benchmark', 'write_mb_per_sec']),
      disk_read_mb_per_sec: nestedNumber(metrics, ['disk_benchmark', 'read_mb_per_sec']),
      memory_pressure_score: nestedNumber(metrics, ['memory', 'pressure_score']),
      payload_json: payloadJson,
    },
  };
}

function parseGoogleConnectStartPayload(
  rawBody: ArrayBuffer,
):
  | {
      ok: true;
      payload: {
        site_id: string;
        return_url: string;
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
  const returnUrl = typeof payload.return_url === 'string' ? payload.return_url.trim() : '';
  if (siteId === '' || returnUrl === '') {
    return { ok: false, error: 'missing_site_or_return_url' };
  }

  return {
    ok: true,
    payload: {
      site_id: siteId,
      return_url: returnUrl,
    },
  };
}

function parseGoalAssistantPayload(
  rawBody: ArrayBuffer,
):
  | {
      ok: true;
      payload: GoalAssistantPayload;
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
  const domain = typeof payload.domain === 'string' ? payload.domain.trim() : '';
  if (siteId === '' || domain === '') {
    return { ok: false, error: 'missing_site_or_domain' };
  }

  return {
    ok: true,
    payload: {
      site_id: siteId,
      domain,
      business_type: limitText(payload.business_type, 120, ''),
      objective: limitText(payload.objective, 160, ''),
      channels: parseStringList(payload.channels),
      form_types: parseStringList(payload.form_types),
      avg_lead_value: numberOrDefault(payload.avg_lead_value, 0),
      ga4_measurement_id: limitText(payload.ga4_measurement_id, 32, ''),
      gtm_container_id: limitText(payload.gtm_container_id, 32, ''),
    },
  };
}

function parseGoogleStatusPayload(
  rawBody: ArrayBuffer,
):
  | {
      ok: true;
      payload: {
        site_id: string;
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
  if (siteId === '') {
    return { ok: false, error: 'missing_site_id' };
  }

  return {
    ok: true,
    payload: {
      site_id: siteId,
    },
  };
}

function parseGoogleDeployPayload(
  rawBody: ArrayBuffer,
):
  | {
      ok: true;
      payload: {
        site_id: string;
        ga4_measurement_id: string;
        ga4_property_id: string;
        gtm_account_id: string;
        gtm_container_id: string;
        gtm_workspace_name: string;
        primary_conversion: string;
        secondary_conversions: string[];
        dry_run: boolean;
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
  if (siteId === '') {
    return { ok: false, error: 'missing_site_id' };
  }

  return {
    ok: true,
    payload: {
      site_id: siteId,
      ga4_measurement_id:
        typeof payload.ga4_measurement_id === 'string' ? payload.ga4_measurement_id.trim() : '',
      ga4_property_id:
        typeof payload.ga4_property_id === 'string' ? payload.ga4_property_id.trim() : '',
      gtm_account_id: typeof payload.gtm_account_id === 'string' ? payload.gtm_account_id.trim() : '',
      gtm_container_id:
        typeof payload.gtm_container_id === 'string' ? payload.gtm_container_id.trim() : '',
      gtm_workspace_name:
        typeof payload.gtm_workspace_name === 'string' && payload.gtm_workspace_name.trim() !== ''
          ? payload.gtm_workspace_name.trim()
          : 'WebAdmin Auto',
      primary_conversion:
        typeof payload.primary_conversion === 'string' && payload.primary_conversion.trim() !== ''
          ? payload.primary_conversion.trim()
          : 'lead_submit',
      secondary_conversions: parseStringList(payload.secondary_conversions),
      dry_run:
        payload.dry_run === true ||
        (typeof payload.dry_run === 'string' && payload.dry_run.trim().toLowerCase() === 'true') ||
        payload.dry_run === 1 ||
        payload.dry_run === '1',
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
        allow_overage: boolean;
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
      allow_overage: toBoolean(payload.allow_overage, false),
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
        actual_runtime_minutes: number | null;
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
  const actualRuntimeRaw =
    typeof payload.actual_runtime_minutes === 'number' || typeof payload.actual_runtime_minutes === 'string'
      ? Number.parseInt(String(payload.actual_runtime_minutes), 10)
      : NaN;
  const actualRuntimeMinutes = Number.isInteger(actualRuntimeRaw)
    ? Math.max(0, Math.min(1440, actualRuntimeRaw))
    : null;

  return {
    ok: true,
    payload: {
      request_id: requestId,
      agent_id: agentId,
      outcome,
      note,
      actual_runtime_minutes: actualRuntimeMinutes,
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

function parseBillingSubscriptionUpsertPayload(
  rawBody: ArrayBuffer,
):
  | {
      ok: true;
      payload: {
        site_id: string;
        plugin_id: string;
        plan_code: string;
        status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid';
        sandbox_enabled: boolean;
        current_period_end: string | null;
        grace_period_end: string | null;
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
  const pluginId = typeof payload.plugin_id === 'string' ? payload.plugin_id.trim() : '';
  if (siteId === '' || pluginId === '') {
    return { ok: false, error: 'missing_site_or_plugin' };
  }

  const status = normalizeBillingStatus(
    typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : '',
  );
  if (!status) {
    return { ok: false, error: 'invalid_billing_status' };
  }

  const planCode =
    typeof payload.plan_code === 'string' && payload.plan_code.trim() !== ''
      ? payload.plan_code.trim()
      : 'sandbox_monthly';

  return {
    ok: true,
    payload: {
      site_id: siteId,
      plugin_id: pluginId,
      plan_code: planCode,
      status,
      sandbox_enabled: toBoolean(payload.sandbox_enabled, true),
      current_period_end: normalizeOptionalIsoString(payload.current_period_end),
      grace_period_end: normalizeOptionalIsoString(payload.grace_period_end),
    },
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

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0);
  }

  if (typeof value === 'string') {
    return value
      .split(/[\r\n,]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return [];
}

function mergeConversionEvents(primary: string, secondary: string[]): string[] {
  const values = [primary, ...secondary];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeEventName(value);
    if (normalized === '' || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  if (result.length === 0) {
    return ['lead_submit'];
  }

  return result;
}

function normalizeEventName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function ensureGoogleAccessToken(
  env: Env,
  token: {
    site_id: string;
    refresh_token: string;
    access_token: string | null;
    scope: string | null;
    token_type: string | null;
    expires_at: string | null;
  },
): Promise<string> {
  const now = Date.now();
  const expiresAtMs = token.expires_at ? Date.parse(token.expires_at) : NaN;
  const hasValidAccessToken =
    typeof token.access_token === 'string' &&
    token.access_token.trim() !== '' &&
    Number.isFinite(expiresAtMs) &&
    expiresAtMs - now > 60_000;
  if (hasValidAccessToken) {
    return token.access_token as string;
  }

  const refreshed = await refreshGoogleAccessToken(env, token.refresh_token);
  await saveRefreshedAccessToken(env.DB, {
    siteId: token.site_id,
    accessToken: refreshed.accessToken,
    scope: refreshed.scope,
    tokenType: refreshed.tokenType,
    expiresAt: refreshed.expiresAt,
  });
  return refreshed.accessToken;
}

function createReturnRedirect(returnUrl: string, params: Record<string, string>): Response {
  try {
    const target = new URL(returnUrl);
    for (const [key, value] of Object.entries(params)) {
      target.searchParams.set(key, value);
    }
    return Response.redirect(target.toString(), 302);
  } catch {
    return json({ ok: false, error: 'invalid_return_url' }, 400);
  }
}

function ensureGoogleOauthConfig(env: Env): string | null {
  if (!env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID.trim() === '') {
    return 'missing_google_client_id';
  }
  if (!env.GOOGLE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET.trim() === '') {
    return 'missing_google_client_secret';
  }
  if (!env.GOOGLE_OAUTH_REDIRECT_URI || env.GOOGLE_OAUTH_REDIRECT_URI.trim() === '') {
    return 'missing_google_oauth_redirect_uri';
  }

  return null;
}

function limitText(value: unknown, maxLength: number, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return fallback;
  }
  return trimmed.slice(0, maxLength);
}

function nestedNumber(record: Record<string, unknown>, path: string[]): number | null {
  let cursor: unknown = record;
  for (const key of path) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
      return null;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  if (typeof cursor === 'number') {
    return Number.isFinite(cursor) ? cursor : null;
  }
  if (typeof cursor === 'string') {
    const parsed = Number(cursor);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function numberOrDefault(value: unknown, fallback: number): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
      return true;
    }
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
      return false;
    }
  }

  return fallback;
}

function normalizeBillingStatus(
  value: string,
): 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | null {
  if (
    value === 'active' ||
    value === 'trialing' ||
    value === 'past_due' ||
    value === 'canceled' ||
    value === 'unpaid'
  ) {
    return value;
  }

  return null;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(normalizeErrorPayload(payload, status)), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

export function normalizeErrorPayload(payload: unknown, status: number): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  if (record.ok !== false) {
    return payload;
  }

  const rawCode = record.error_code ?? record.error;
  const errorCode =
    typeof rawCode === 'string' && rawCode.trim() !== '' ? rawCode.trim() : 'unknown_error';
  const rawMessage = record.message;
  const message =
    typeof rawMessage === 'string' && rawMessage.trim() !== ''
      ? rawMessage.trim()
      : defaultErrorMessage(errorCode, status);

  const normalized: Record<string, unknown> = {
    ...record,
    ok: false,
    error_code: errorCode,
    message,
  };

  if (!('details' in normalized) && 'error_details' in normalized) {
    normalized.details = normalized.error_details;
  }

  if (!('error' in normalized)) {
    normalized.error = errorCode;
  }

  return normalized;
}

function defaultErrorMessage(errorCode: string, status: number): string {
  if (status === 401) {
    return 'Authentication failed.';
  }
  if (status === 403) {
    return 'Access forbidden for this capability.';
  }
  if (status === 404) {
    return 'Requested route or resource was not found.';
  }
  if (status === 409) {
    return 'Conflict detected for this request.';
  }
  if (status >= 500) {
    return 'Control plane encountered an internal error.';
  }
  if (status >= 400) {
    return 'Request validation failed.';
  }

  return errorCode.replace(/_/g, ' ');
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length || left.length === 0) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}
