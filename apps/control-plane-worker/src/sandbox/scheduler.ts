export interface RankedSandboxRequest {
  id: string;
  site_id: string;
  requested_by_agent: string;
  task_type: string;
  priority_base: number;
  estimated_minutes: number;
  earliest_start_at: string | null;
  created_at: string;
  vote_total: number;
}

export interface ScoredSandboxRequest {
  request: RankedSandboxRequest;
  score: number;
}

const PRIORITY_WEIGHT = 100;
const VOTE_WEIGHT = 20;
const AGE_WEIGHT_PER_MINUTE = 1;

export function computeSandboxRequestScore(
  request: RankedSandboxRequest,
  nowMs = Date.now(),
): number {
  const priority = clamp(request.priority_base, 1, 5);
  const votes = clamp(request.vote_total, -50, 50);
  const createdMs = parseDateMs(request.created_at);
  const waitMinutes =
    createdMs > 0 ? Math.max(0, Math.floor((nowMs - createdMs) / (60 * 1000))) : 0;

  return priority * PRIORITY_WEIGHT + votes * VOTE_WEIGHT + waitMinutes * AGE_WEIGHT_PER_MINUTE;
}

export function isRequestReady(request: RankedSandboxRequest, nowMs = Date.now()): boolean {
  if (!request.earliest_start_at) {
    return true;
  }
  const earliestMs = parseDateMs(request.earliest_start_at);
  if (earliestMs <= 0) {
    return true;
  }
  return earliestMs <= nowMs;
}

export function pickNextSandboxRequest(
  requests: RankedSandboxRequest[],
  nowMs = Date.now(),
): ScoredSandboxRequest | null {
  const ready = requests.filter((request) => isRequestReady(request, nowMs));
  if (ready.length === 0) {
    return null;
  }

  const scored = ready.map((request) => ({
    request,
    score: computeSandboxRequestScore(request, nowMs),
  }));

  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    const leftCreated = parseDateMs(left.request.created_at);
    const rightCreated = parseDateMs(right.request.created_at);
    if (leftCreated !== rightCreated) {
      return leftCreated - rightCreated;
    }

    return left.request.id.localeCompare(right.request.id);
  });

  return scored[0] ?? null;
}

function parseDateMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
