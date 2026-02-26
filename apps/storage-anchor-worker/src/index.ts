import { handleAnchorRequest, processAnchorTask } from './router';
import type { AnchorTaskMessage, Env } from './types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleAnchorRequest(request, env);
  },

  async queue(batch: MessageBatch<AnchorTaskMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const taskId = message.body?.taskId;
        if (!taskId) {
          message.ack();
          continue;
        }

        await processAnchorTask(env, taskId);
        message.ack();
      } catch (error) {
        console.error('anchor_task_failed', error);
        message.retry();
      }
    }
  },
};
