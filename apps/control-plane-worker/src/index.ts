import { cleanupReplayArtifacts } from './auth/replay';
import { SiteLock } from './durable/siteLock';
import { handleRequest } from './routes';
import type { Env } from './types';

export { SiteLock };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const retention = parseOptionalInteger(env.REPLAY_RETENTION_SECONDS) ?? 24 * 60 * 60;
    await cleanupReplayArtifacts(env.DB, {
      retentionSeconds: retention,
    });
  },

  async queue(batch: MessageBatch<unknown>): Promise<void> {
    for (const message of batch.messages) {
      try {
        console.log('job_message', JSON.stringify(message.body));
        message.ack();
      } catch (error) {
        console.error('job_message_failed', error);
        message.retry();
      }
    }
  },
};

function parseOptionalInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
