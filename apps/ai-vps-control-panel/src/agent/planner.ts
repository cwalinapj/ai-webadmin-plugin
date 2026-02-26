import type { AgentAction, ChatRequest, ChatResponse } from '../types.js';

function createAction(
  type: AgentAction['type'],
  description: string,
  risk: AgentAction['risk'],
  requiresConfirmation: boolean,
  args: AgentAction['args'],
): AgentAction {
  return {
    id: crypto.randomUUID(),
    type,
    description,
    risk,
    requires_confirmation: requiresConfirmation,
    args,
  };
}

function firstMatch(text: string, options: string[], fallback: string): string {
  for (const option of options) {
    if (text.includes(option)) {
      return option;
    }
  }
  return fallback;
}

export function planAgentResponse(input: ChatRequest): ChatResponse {
  const message = input.message.trim();
  const lower = message.toLowerCase();
  const conversationId = input.conversation_id ?? crypto.randomUUID();
  const actions: AgentAction[] = [];
  let assistantMessage = 'I can help with service status, restarts, logs, and snapshots.';

  if (lower.includes('restart')) {
    const service = firstMatch(lower, ['nginx', 'apache2', 'httpd', 'mysql', 'mariadb', 'redis'], 'nginx');
    actions.push(
      createAction(
        'restart_service',
        `Restart ${service} on the VPS host.`,
        'high',
        true,
        { service },
      ),
    );
    assistantMessage = `I prepared a restart action for ${service}. Confirm before live execution.`;
  } else if (lower.includes('status')) {
    const service = firstMatch(
      lower,
      ['nginx', 'apache2', 'httpd', 'mysql', 'mariadb', 'redis', 'php-fpm'],
      'nginx',
    );
    actions.push(
      createAction(
        'check_service_status',
        `Check service status for ${service}.`,
        'low',
        false,
        { service },
      ),
    );
    assistantMessage = `I prepared a status check for ${service}.`;
  } else if (lower.includes('log')) {
    const service = firstMatch(lower, ['nginx', 'apache2', 'httpd', 'mysql', 'mariadb', 'redis'], 'nginx');
    actions.push(
      createAction(
        'tail_service_logs',
        `Read recent logs for ${service}.`,
        'medium',
        false,
        { service, lines: 200 },
      ),
    );
    assistantMessage = `I prepared a log tail action for ${service}.`;
  } else if (lower.includes('backup') || lower.includes('snapshot')) {
    actions.push(
      createAction(
        'run_site_snapshot',
        'Create compressed site snapshot.',
        'medium',
        true,
        {
          site_path: '/var/www',
          output_path: '/var/backups/site-snapshot.tgz',
        },
      ),
    );
    assistantMessage = 'I prepared a snapshot action. Confirm before live execution.';
  } else {
    actions.push(createAction('noop', 'No matching operation. Ask for status, logs, restart, or snapshot.', 'low', false, {}));
  }

  return {
    ok: true,
    conversation_id: conversationId,
    assistant_message: assistantMessage,
    actions,
  };
}
