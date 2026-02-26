import { SiteLock } from './durable/siteLock';
import { handleRequest } from './routes';
import type { Env } from './types';

export { SiteLock };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
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
