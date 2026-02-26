<?php

namespace WebAdminEdgeAgent\Command;

use WebAdminEdgeAgent\Storage\JobStore;
use WebAdminEdgeAgent\Storage\Logger;

class Dispatcher
{
    private Logger $logger;

    private JobStore $jobStore;

    public function __construct(Logger $logger, JobStore $jobStore)
    {
        $this->logger = $logger;
        $this->jobStore = $jobStore;
    }

    /**
     * @param array<int, mixed> $commands
     * @return array<int, array<string, mixed>>
     */
    public function dispatch(array $commands, string $tab): array
    {
        $results = [];

        foreach ($commands as $command) {
            if (!is_array($command)) {
                $results[] = ['ok' => false, 'error' => 'invalid_command_shape'];
                continue;
            }

            $type = sanitize_key((string)($command['type'] ?? ''));
            if ($type === '') {
                $results[] = ['ok' => false, 'error' => 'missing_command_type'];
                continue;
            }

            if (!$this->isAllowlisted($type)) {
                $this->logger->log('warning', 'Rejected non-allowlisted command', ['type' => $type]);
                $this->jobStore->add($tab, $type, 'rejected', 0.0, true, ['error' => 'not_allowlisted']);
                $results[] = ['ok' => false, 'error' => 'command_not_allowlisted', 'type' => $type];
                continue;
            }

            $dryRun = isset($command['dry_run']) ? (bool)$command['dry_run'] : null;
            if ($this->isDestructive($type) && $dryRun === null) {
                $this->logger->log('warning', 'Rejected destructive command without dry_run', ['type' => $type]);
                $this->jobStore->add($tab, $type, 'rejected', 0.0, true, ['error' => 'missing_dry_run']);
                $results[] = ['ok' => false, 'error' => 'destructive_command_requires_dry_run', 'type' => $type];
                continue;
            }

            $result = $this->execute($type, $command, $dryRun ?? true, $tab);
            $results[] = $result;
        }

        return $results;
    }

    /**
     * @param array<string, mixed> $command
     * @return array<string, mixed>
     */
    private function execute(string $type, array $command, bool $dryRun, string $tab): array
    {
        if ($type === 'noop') {
            $this->logger->log('info', 'Command noop acknowledged', ['tab' => $tab]);
            $this->jobStore->add($tab, 'noop', 'completed', 0.0, $dryRun, ['source' => 'worker']);

            return ['ok' => true, 'type' => 'noop'];
        }

        if ($type === 'log_event') {
            $message = sanitize_text_field((string)($command['message'] ?? 'event'));
            $severity = sanitize_key((string)($command['severity'] ?? 'info'));
            $level = in_array($severity, ['info', 'warning', 'error'], true) ? $severity : 'info';
            $this->logger->log($level, 'Worker event: ' . $message, ['tab' => $tab]);
            $this->jobStore->add($tab, 'log_event', 'completed', 0.0, $dryRun, ['message' => $message]);

            return ['ok' => true, 'type' => 'log_event'];
        }

        if ($this->isDestructive($type)) {
            $status = $dryRun ? 'dry_run' : 'blocked';
            $this->logger->log('warning', 'Destructive command received and not executed', [
                'type' => $type,
                'dry_run' => $dryRun ? '1' : '0',
            ]);
            $this->jobStore->add($tab, $type, $status, 0.0, $dryRun, ['source' => 'worker']);

            return [
                'ok' => true,
                'type' => $type,
                'status' => $status,
                'message' => 'Destructive commands are guardrailed in milestone 1.',
            ];
        }

        $this->logger->log('warning', 'No handler for allowlisted command', ['type' => $type]);
        $this->jobStore->add($tab, $type, 'rejected', 0.0, $dryRun, ['error' => 'no_handler']);

        return ['ok' => false, 'error' => 'no_handler', 'type' => $type];
    }

    private function isAllowlisted(string $type): bool
    {
        return in_array($type, $this->allowlist(), true);
    }

    private function isDestructive(string $type): bool
    {
        return in_array(
            $type,
            [
                'deactivate_plugin',
                'apply_dns_fix',
                'remediate_security',
                'run_canary_optimization',
                'rollback_optimization',
                'stage_update',
                'execute_update_batch',
                'rollback_update',
            ],
            true
        );
    }

    /**
     * @return array<int, string>
     */
    private function allowlist(): array
    {
        return [
            'noop',
            'log_event',
            'deactivate_plugin',
            'apply_dns_fix',
            'remediate_security',
            'run_canary_optimization',
            'rollback_optimization',
            'stage_update',
            'execute_update_batch',
            'rollback_update',
        ];
    }
}
