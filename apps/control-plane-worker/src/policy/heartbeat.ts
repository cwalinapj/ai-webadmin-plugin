import type { HeartbeatPayload } from '../sites/upsertSite';

export function shouldCreateHeartbeatJob(payload: HeartbeatPayload): boolean {
  const errorCounts = payload.error_counts ?? {};
  const hasErrors = Number(errorCounts.plugin_errors_24h ?? 0) > 0;

  const loadAvgArray = Array.isArray(payload.load_avg) ? payload.load_avg : [];
  const loadAvgOneMinute = Number(loadAvgArray[0] ?? 0);
  const highLoad = Number.isFinite(loadAvgOneMinute) && loadAvgOneMinute >= 4;

  return hasErrors || highLoad;
}

export function heartbeatRiskScore(payload: HeartbeatPayload): number {
  let score = 0;

  const errorCounts = payload.error_counts ?? {};
  score += Math.min(Number(errorCounts.plugin_errors_24h ?? 0) * 0.2, 4);

  const loadAvgArray = Array.isArray(payload.load_avg) ? payload.load_avg : [];
  score += Math.min(Number(loadAvgArray[0] ?? 0) * 0.5, 6);

  return Number(score.toFixed(2));
}
