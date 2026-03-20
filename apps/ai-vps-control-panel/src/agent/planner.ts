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
  let assistantMessage = 'I can help with service status, restarts, logs, snapshots, verification, and secret rotation.';

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
          site: input.site_id,
          site_path: `/var/www/${input.site_id}`,
          output_dir: '/var/backups/ai-webadmin',
        },
      ),
    );
    assistantMessage = 'I prepared a snapshot action. Confirm before live execution.';
  } else if (lower.includes('verify')) {
    actions.push(
      createAction(
        'verify_site_upgrade',
        'Run lightweight site verification checks.',
        'medium',
        false,
        {
          site: input.site_id,
          site_path: `/var/www/${input.site_id}`,
          expect_files_csv: `/var/www/${input.site_id}/index.php`,
        },
      ),
    );
    assistantMessage = 'I prepared a verification action for the site path.';
  } else if (lower.includes('rotate') && lower.includes('secret')) {
    actions.push(
      createAction(
        'rotate_secret',
        'Rotate a named runtime secret.',
        'high',
        true,
        {
          name: 'API_TOKEN',
          write_env_file: '/run/ai-vps-control-panel/runtime.env',
          prefix: 'tok_',
          length: 40,
        },
      ),
    );
    assistantMessage = 'I prepared a secret rotation action. Confirm before live execution.';
  } else {
    actions.push(
      createAction(
        'noop',
        'No matching operation. Ask for status, logs, restart, snapshot, verify, or rotate secret.',
        'low',
        false,
        {},
      ),
    );
  }

  return {
    ok: true,
    conversation_id: conversationId,
    assistant_message: assistantMessage,
    actions,
  };
}
