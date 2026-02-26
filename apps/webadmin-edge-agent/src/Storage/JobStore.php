<?php

namespace WebAdminEdgeAgent\Storage;

class JobStore
{
    public const OPTION_KEY = 'webadmin_edge_agent_jobs';

    /**
     * @param array<string, mixed> $context
     */
    public function add(
        string $tab,
        string $type,
        string $status,
        float $riskScore,
        bool $dryRun,
        array $context = []
    ): void {
        $jobs = get_option(self::OPTION_KEY, []);
        if (!is_array($jobs)) {
            $jobs = [];
        }

        $jobs[] = [
            'id' => wp_generate_uuid4(),
            'ts' => gmdate('c'),
            'tab' => sanitize_key($tab),
            'type' => sanitize_text_field($type),
            'status' => sanitize_text_field($status),
            'risk_score' => round($riskScore, 2),
            'dry_run' => $dryRun ? 1 : 0,
            'context' => $this->sanitizeContext($context),
        ];

        if (count($jobs) > 250) {
            $jobs = array_slice($jobs, -250);
        }

        update_option(self::OPTION_KEY, $jobs, false);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function recent(int $limit = 25): array
    {
        $jobs = get_option(self::OPTION_KEY, []);
        if (!is_array($jobs)) {
            return [];
        }

        return array_reverse(array_slice($jobs, -1 * max(1, $limit)));
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function recentByTab(string $tab, int $limit = 10): array
    {
        $filtered = [];
        foreach ($this->recent(250) as $job) {
            if (!is_array($job)) {
                continue;
            }
            if ((string)($job['tab'] ?? '') !== $tab) {
                continue;
            }
            $filtered[] = $job;
            if (count($filtered) >= $limit) {
                break;
            }
        }

        return $filtered;
    }

    /**
     * @param array<string, mixed> $context
     * @return array<string, string>
     */
    private function sanitizeContext(array $context): array
    {
        $clean = [];
        foreach ($context as $key => $value) {
            $clean[sanitize_key((string)$key)] = is_scalar($value)
                ? sanitize_text_field((string)$value)
                : (string)wp_json_encode($value);
        }

        return $clean;
    }
}
