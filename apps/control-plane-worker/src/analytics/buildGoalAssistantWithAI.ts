import { buildGoalAssistantPlan, type GoalAssistantPayload } from './buildGoalAssistant';
import type { Env } from '../types';

const DEFAULT_GOAL_ASSISTANT_MODEL = '@cf/meta/llama-3.1-8b-instruct';

const SYSTEM_PROMPT =
  'You are a conversion analytics planner. Return strict JSON only. ' +
  'Use concise recommendations for GA4+GTM conversion setup and funnel tracking.';

export interface GoalAssistantPlannerMeta {
  source: 'workers_ai' | 'deterministic';
  model?: string;
  gateway_id?: string;
  reason?: string;
}

export async function buildGoalAssistantPlanWithAI(
  payload: GoalAssistantPayload,
  env: Env,
): Promise<{ plan: Record<string, unknown>; planner: GoalAssistantPlannerMeta }> {
  const baselinePlan = buildGoalAssistantPlan(payload);
  if (!isAiEnabled(env)) {
    return {
      plan: baselinePlan,
      planner: {
        source: 'deterministic',
        reason: 'ai_not_enabled',
      },
    };
  }

  const ai = env.AI;
  if (!ai) {
    return {
      plan: baselinePlan,
      planner: {
        source: 'deterministic',
        reason: 'ai_binding_missing',
      },
    };
  }

  const model = normalizeModelName(env.ANALYTICS_GOAL_ASSISTANT_MODEL);
  const gatewayId = normalizeGatewayId(env.ANALYTICS_GOAL_ASSISTANT_GATEWAY_ID);

  try {
    const aiRequest = {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            task: 'build_conversion_goal_plan',
            constraints: [
              'Keep event names snake_case.',
              'Keep steps practical for WordPress + GA4 + GTM.',
              'Do not output markdown.',
            ],
            payload,
            baseline_plan: baselinePlan,
            output_contract: {
              summary: 'string',
              goals: {
                primary: { name: 'string', event: 'string', rationale: 'string' },
                secondary: [{ name: 'string', event: 'string', priority: 'high|medium' }],
              },
              tracking_plan: {
                recommended_events: ['string'],
                key_funnel_events: ['string'],
                attribution_dimensions: ['string'],
              },
              suggested_plugin_settings: {
                analytics_primary_conversion: 'string',
                analytics_secondary_conversions: ['string'],
                analytics_funnel_steps: ['string'],
                analytics_key_pages: ['string'],
              },
              kpi_targets: {
                target_cvr_pct: 'number',
                target_cost_per_lead: 'number|null',
                target_monthly_leads: 'number',
              },
              execution_steps: ['string'],
              quick_wins: ['string'],
            },
          }),
        },
      ],
      response_format: {
        type: 'json_object',
      },
      temperature: 0.2,
      max_tokens: 1300,
    };

    const aiOptions = gatewayId
      ? {
          gateway: {
            id: gatewayId,
          },
        }
      : undefined;

    const output = await ai.run(
      model as keyof AiModels,
      aiRequest as never,
      aiOptions as never,
    );

    const aiObject = extractAiObject(output);
    if (!aiObject) {
      return {
        plan: baselinePlan,
        planner: {
          source: 'deterministic',
          reason: 'ai_invalid_output',
        },
      };
    }

    const plan = coercePlan(aiObject, baselinePlan);
    return {
      plan,
      planner: {
        source: 'workers_ai',
        model,
        gateway_id: gatewayId || undefined,
      },
    };
  } catch {
    return {
      plan: baselinePlan,
      planner: {
        source: 'deterministic',
        reason: 'ai_execution_error',
      },
    };
  }
}

function coercePlan(
  aiPlan: Record<string, unknown>,
  baselinePlan: Record<string, unknown>,
): Record<string, unknown> {
  const baselinePrimaryEvent = normalizeEventName(
    getString(readPath(baselinePlan, ['goals', 'primary', 'event'])) || 'lead_submit',
  );
  const primaryEvent = normalizeEventName(
    getString(readPath(aiPlan, ['suggested_plugin_settings', 'analytics_primary_conversion'])) ||
      getString(readPath(aiPlan, ['goals', 'primary', 'event'])) ||
      baselinePrimaryEvent,
  );

  const secondaryEvents = nonEmptyOrFallback(
    normalizeEventList(readPath(aiPlan, ['suggested_plugin_settings', 'analytics_secondary_conversions'])),
    normalizeEventList(extractSecondaryGoalEvents(aiPlan)),
    normalizeEventList(extractSecondaryGoalEvents(baselinePlan)),
  );

  const keyFunnel = nonEmptyOrFallback(
    normalizeEventList(readPath(aiPlan, ['suggested_plugin_settings', 'analytics_funnel_steps'])),
    normalizeEventList(readPath(aiPlan, ['tracking_plan', 'key_funnel_events'])),
    normalizeEventList(readPath(baselinePlan, ['tracking_plan', 'key_funnel_events'])),
  );

  const keyPages = nonEmptyOrFallback(
    normalizePageList(readPath(aiPlan, ['suggested_plugin_settings', 'analytics_key_pages'])),
    normalizePageList(readPath(baselinePlan, ['suggested_plugin_settings', 'analytics_key_pages'])),
  );

  const recommendedEvents = uniqueStrings([
    ...normalizeEventList(readPath(aiPlan, ['tracking_plan', 'recommended_events'])),
    primaryEvent,
    ...secondaryEvents,
  ]);

  const attributionDimensions = nonEmptyOrFallback(
    normalizePlainStringList(readPath(aiPlan, ['tracking_plan', 'attribution_dimensions'])),
    normalizePlainStringList(readPath(baselinePlan, ['tracking_plan', 'attribution_dimensions'])),
  );

  const executionSteps = nonEmptyOrFallback(
    normalizeSentenceList(readPath(aiPlan, ['execution_steps'])),
    normalizeSentenceList(readPath(baselinePlan, ['execution_steps'])),
  );

  const quickWins = nonEmptyOrFallback(
    normalizeSentenceList(readPath(aiPlan, ['quick_wins'])),
    normalizeSentenceList(readPath(baselinePlan, ['quick_wins'])),
  );

  const summary =
    getString(aiPlan.summary) || getString(baselinePlan.summary) || 'Conversion goal strategy generated.';

  const primaryName =
    getString(readPath(aiPlan, ['goals', 'primary', 'name'])) ||
    getString(readPath(baselinePlan, ['goals', 'primary', 'name'])) ||
    'Primary Conversion';
  const primaryRationale =
    getString(readPath(aiPlan, ['goals', 'primary', 'rationale'])) ||
    getString(readPath(baselinePlan, ['goals', 'primary', 'rationale'])) ||
    'Primary conversion selected by assistant.';

  const secondaryGoals = buildSecondaryGoals(aiPlan, baselinePlan, secondaryEvents);
  const kpiTargets = mergeKpiTargets(aiPlan, baselinePlan);

  return {
    ...baselinePlan,
    generated_at: new Date().toISOString(),
    summary: truncate(summary, 240),
    goals: {
      primary: {
        name: truncate(primaryName, 120),
        event: primaryEvent,
        rationale: truncate(primaryRationale, 220),
      },
      secondary: secondaryGoals,
    },
    tracking_plan: {
      recommended_events: recommendedEvents,
      key_funnel_events: keyFunnel,
      attribution_dimensions: attributionDimensions,
    },
    suggested_plugin_settings: {
      analytics_primary_conversion: primaryEvent,
      analytics_secondary_conversions: secondaryEvents,
      analytics_funnel_steps: keyFunnel,
      analytics_key_pages: keyPages,
    },
    kpi_targets: kpiTargets,
    execution_steps: executionSteps,
    quick_wins: quickWins,
  };
}

function buildSecondaryGoals(
  aiPlan: Record<string, unknown>,
  baselinePlan: Record<string, unknown>,
  secondaryEvents: string[],
): Array<{ name: string; event: string; priority: 'high' | 'medium' }> {
  const aiSecondary = readPath(aiPlan, ['goals', 'secondary']);
  if (Array.isArray(aiSecondary) && aiSecondary.length > 0) {
    const goals: Array<{ name: string; event: string; priority: 'high' | 'medium' }> = [];
    for (const item of aiSecondary) {
      if (!isRecord(item)) {
        continue;
      }
      const event = normalizeEventName(getString(item.event) || '');
      if (!event) {
        continue;
      }
      goals.push({
        name: truncate(getString(item.name) || `Secondary: ${event}`, 120),
        event,
        priority: normalizePriority(getString(item.priority)),
      });
    }

    const normalized = uniqueGoals(goals);
    if (normalized.length > 0) {
      return normalized.slice(0, 8);
    }
  }

  const baselineSecondary = readPath(baselinePlan, ['goals', 'secondary']);
  if (Array.isArray(baselineSecondary) && baselineSecondary.length > 0) {
    const goals: Array<{ name: string; event: string; priority: 'high' | 'medium' }> = [];
    for (const item of baselineSecondary) {
      if (!isRecord(item)) {
        continue;
      }
      const event = normalizeEventName(getString(item.event) || '');
      if (!event) {
        continue;
      }
      goals.push({
        name: truncate(getString(item.name) || `Secondary: ${event}`, 120),
        event,
        priority: normalizePriority(getString(item.priority)),
      });
    }
    const normalized = uniqueGoals(goals);
    if (normalized.length > 0) {
      return normalized.slice(0, 8);
    }
  }

  return secondaryEvents.map((event) => ({
    name: `Secondary: ${event}`,
    event,
    priority: 'medium',
  }));
}

function mergeKpiTargets(
  aiPlan: Record<string, unknown>,
  baselinePlan: Record<string, unknown>,
): Record<string, unknown> {
  const ai = isRecord(aiPlan.kpi_targets) ? aiPlan.kpi_targets : {};
  const baseline = isRecord(baselinePlan.kpi_targets) ? baselinePlan.kpi_targets : {};

  const targetCvrPct =
    getFiniteNumber(ai.target_cvr_pct) ??
    getFiniteNumber(baseline.target_cvr_pct) ??
    0;
  const targetCostPerLead =
    getFiniteNumber(ai.target_cost_per_lead) ??
    getFiniteNumber(baseline.target_cost_per_lead);
  const targetMonthlyLeads =
    getFiniteNumber(ai.target_monthly_leads) ??
    getFiniteNumber(baseline.target_monthly_leads) ??
    0;

  return {
    target_cvr_pct: round(targetCvrPct, 2),
    target_cost_per_lead:
      typeof targetCostPerLead === 'number' ? round(targetCostPerLead, 2) : null,
    target_monthly_leads: Math.max(0, Math.round(targetMonthlyLeads)),
  };
}

function extractSecondaryGoalEvents(plan: Record<string, unknown>): string[] {
  const secondary = readPath(plan, ['goals', 'secondary']);
  if (!Array.isArray(secondary)) {
    return [];
  }

  const events: string[] = [];
  for (const item of secondary) {
    if (!isRecord(item)) {
      continue;
    }
    const event = normalizeEventName(getString(item.event) || '');
    if (event) {
      events.push(event);
    }
  }

  return uniqueStrings(events);
}

function normalizeModelName(model: string | undefined): string {
  const value = (model || '').trim();
  if (value === '') {
    return DEFAULT_GOAL_ASSISTANT_MODEL;
  }

  return value;
}

function normalizeGatewayId(gatewayId: string | undefined): string {
  return (gatewayId || '').trim();
}

function isAiEnabled(env: Env): boolean {
  if (!env.AI) {
    return false;
  }

  const flag = (env.ANALYTICS_GOAL_ASSISTANT_USE_AI || '').trim().toLowerCase();
  if (flag === '' || flag === '1' || flag === 'true' || flag === 'yes' || flag === 'on') {
    return true;
  }

  return false;
}

function extractAiObject(output: unknown): Record<string, unknown> | null {
  if (isRecord(output)) {
    const direct = sanitizeAiRoot(output);
    if (direct) {
      return direct;
    }

    const candidates = [
      getString(output.response),
      getString(output.output_text),
      getString(readPath(output, ['result', 'response'])),
      getString(readPath(output, ['choices', 0, 'message', 'content'])),
    ];
    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      const parsed = parsePotentialJson(candidate);
      if (parsed) {
        const safe = sanitizeAiRoot(parsed);
        if (safe) {
          return safe;
        }
      }
    }
  }

  if (typeof output === 'string') {
    const parsed = parsePotentialJson(output);
    const safe = parsed ? sanitizeAiRoot(parsed) : null;
    if (safe) {
      return safe;
    }
  }

  return null;
}

function sanitizeAiRoot(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    isRecord(value.goals) ||
    isRecord(value.suggested_plugin_settings) ||
    isRecord(value.tracking_plan)
  ) {
    return value;
  }

  if (isRecord(value.plan)) {
    const nested = value.plan;
    if (
      isRecord(nested.goals) ||
      isRecord(nested.suggested_plugin_settings) ||
      isRecord(nested.tracking_plan)
    ) {
      return nested;
    }
  }

  return null;
}

function parsePotentialJson(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  const parsed = parseJsonObject(trimmed);
  if (parsed) {
    return parsed;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return parseJsonObject(trimmed.slice(start, end + 1));
  }

  return null;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    if (isRecord(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return value.slice(0, max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPath(root: unknown, path: Array<string | number>): unknown {
  let cursor: unknown = root;
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(cursor) || segment < 0 || segment >= cursor.length) {
        return undefined;
      }
      cursor = cursor[segment];
      continue;
    }

    if (!isRecord(cursor)) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value !== '')));
}

function nonEmptyOrFallback(...options: string[][]): string[] {
  for (const option of options) {
    if (option.length > 0) {
      return option;
    }
  }
  return [];
}

function normalizeEventList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const values: string[] = [];
  for (const raw of input) {
    const normalized = normalizeEventName(getString(raw));
    if (normalized) {
      values.push(normalized);
    }
  }
  return uniqueStrings(values).slice(0, 12);
}

function normalizePlainStringList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const values: string[] = [];
  for (const raw of input) {
    const value = truncate(getString(raw), 40);
    if (!value) {
      continue;
    }
    values.push(value);
  }
  return uniqueStrings(values).slice(0, 10);
}

function normalizeSentenceList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const values: string[] = [];
  for (const raw of input) {
    const value = truncate(getString(raw), 180);
    if (!value) {
      continue;
    }
    values.push(value);
  }
  return uniqueStrings(values).slice(0, 8);
}

function normalizePageList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const values: string[] = [];
  for (const raw of input) {
    const page = normalizePage(getString(raw));
    if (!page) {
      continue;
    }
    values.push(page);
  }

  return uniqueStrings(values).slice(0, 8);
}

function normalizePage(value: string): string {
  if (!value) {
    return '';
  }
  const normalized = value.startsWith('/') ? value : `/${value}`;
  return normalized.replace(/[^a-zA-Z0-9/_-]+/g, '').replace(/\/+/g, '/');
}

function normalizeEventName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizePriority(value: string): 'high' | 'medium' {
  return value === 'high' ? 'high' : 'medium';
}

function uniqueGoals(
  goals: Array<{ name: string; event: string; priority: 'high' | 'medium' }>,
): Array<{ name: string; event: string; priority: 'high' | 'medium' }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; event: string; priority: 'high' | 'medium' }> = [];
  for (const goal of goals) {
    if (!goal.event || seen.has(goal.event)) {
      continue;
    }
    seen.add(goal.event);
    out.push(goal);
  }
  return out;
}
