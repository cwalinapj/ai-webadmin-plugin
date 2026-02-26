export interface Env {
  DB: D1Database;
  JOB_QUEUE: Queue;
  JOB_DLQ: Queue;
  SITE_LOCK: DurableObjectNamespace;
  WP_PLUGIN_SHARED_SECRET: string;
  CAP_TOKEN_UPTIME_WRITE: string;
  CAP_TOKEN_ANALYTICS_WRITE?: string;
  CAP_TOKEN_SANDBOX_WRITE?: string;
  CAP_TOKEN_HOST_OPTIMIZER_WRITE?: string;
  REPLAY_WINDOW_SECONDS?: string;
}
