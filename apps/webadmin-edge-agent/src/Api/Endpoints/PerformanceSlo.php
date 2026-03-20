<?php

namespace WebAdminEdgeAgent\Api\Endpoints;

use WebAdminEdgeAgent\Api\Client;
use WebAdminEdgeAgent\Command\Dispatcher;
use WebAdminEdgeAgent\Security\Capabilities;
use WebAdminEdgeAgent\Storage\JobStore;
use WebAdminEdgeAgent\Storage\Logger;
use WebAdminEdgeAgent\Storage\Options;
use WebAdminEdgeAgent\Storage\TabState;

class PerformanceSlo
{
    private Options $options;

    private Logger $logger;

    private Client $client;

    private Dispatcher $dispatcher;

    private TabState $tabState;

    private JobStore $jobStore;

    public function __construct(
        Options $options,
        Logger $logger,
        Client $client,
        Dispatcher $dispatcher,
        TabState $tabState,
        JobStore $jobStore
    ) {
        $this->options = $options;
        $this->logger = $logger;
        $this->client = $client;
        $this->dispatcher = $dispatcher;
        $this->tabState = $tabState;
        $this->jobStore = $jobStore;
    }

    /**
     * @return array<string, mixed>
     */
    public function evaluate(string $source = 'manual'): array
    {
        $settings = $this->options->getSettings();
        $siteId = $this->resolveSiteId($settings);
        if ($siteId === '') {
            return [
                'ok' => false,
                'status' => 0,
                'error' => 'missing_site_id',
            ];
        }

        $signals = $this->collectSignals();
        $payload = [
            'site_id' => $siteId,
            'domain' => (string)$settings['domain'],
            'goals' => [
                'guest_p95_ttfb_ms' => (float)$settings['performance_slo_goal_guest_p95_ttfb_ms'],
                'error_rate_pct' => (float)$settings['performance_slo_goal_error_rate_pct'],
                'cache_hit_rate_pct' => (float)$settings['performance_slo_goal_cache_hit_pct'],
            ],
            'signals' => $signals,
            'signal_sources' => [
                'guest_p95_ttfb_ms' => 'worker_synthetic_required',
                'cache_hit_rate_pct' => 'worker_cache_logs_required',
                'error_rate_pct' => 'wp_agent_logs_1h',
            ],
            'allow_canary' => true,
            'dry_run' => !empty($settings['performance_slo_dry_run']),
        ];

        $response = $this->client->requestJson(
            'POST',
            '/plugin/wp/performance/slo/evaluate',
            $payload,
            Capabilities::UPTIME_WRITE
        );

        if (!empty($response['ok'])) {
            $resultJson = '';
            if (isset($response['body']) && is_array($response['body'])) {
                $encoded = wp_json_encode($response['body'], JSON_PRETTY_PRINT);
                if (is_string($encoded)) {
                    $resultJson = $encoded;
                }
            }

            $commands = [];
            if (isset($response['body']['commands']) && is_array($response['body']['commands'])) {
                $commands = $response['body']['commands'];
            }
            $this->dispatcher->dispatch($commands, 'uptime');

            $this->options->saveSettings([
                'performance_slo_last_status' => 'ok',
                'performance_slo_last_message' => 'SLO evaluation completed.',
                'performance_slo_last_at' => time(),
                'performance_slo_last_result_json' => $resultJson,
            ]);
            $this->tabState->recordSync('uptime', 'ok', 'Performance SLO evaluation completed.');
            $this->tabState->addFinding('uptime', 'info', 'Performance SLO evaluation complete', 'Review canary and rollback recommendation output.');
            $this->jobStore->add('uptime', 'performance_slo_evaluate', 'completed', 0.0, !empty($payload['dry_run']), ['source' => $source]);
            $this->logger->log('info', 'Performance SLO evaluated', [
                'source' => $source,
                'request_id' => (string)($response['request_id'] ?? ''),
            ]);
        } else {
            $message = 'Performance SLO evaluation failed.';
            if (!empty($response['status'])) {
                $message .= ' HTTP ' . (int)$response['status'];
            }
            if (!empty($response['error'])) {
                $message .= ' ' . sanitize_text_field((string)$response['error']);
            }

            $this->options->saveSettings([
                'performance_slo_last_status' => 'error',
                'performance_slo_last_message' => $message,
                'performance_slo_last_at' => time(),
            ]);
            $this->tabState->recordSync('uptime', 'error', $message);
            $this->tabState->addFinding('uptime', 'error', 'Performance SLO evaluation failed', $message);
            $this->jobStore->add('uptime', 'performance_slo_evaluate', 'failed', 0.7, true, ['source' => $source]);
            $this->logger->log('error', 'Performance SLO evaluation failed', [
                'status' => (string)($response['status'] ?? 0),
                'request_id' => (string)($response['request_id'] ?? ''),
            ]);
        }

        return $response;
    }

    /**
     * @param array<string, mixed> $settings
     */
    private function resolveSiteId(array $settings): string
    {
        $siteId = (string)$settings['site_id'];
        if ($siteId === '') {
            $siteId = (string)$settings['plugin_id'];
        }

        return $siteId;
    }

    /**
     * @return array<string, float>
     */
    private function collectSignals(): array
    {
        $activePlugins = (array)get_option('active_plugins', []);
        $activeCount = count($activePlugins);
        $errorCount = $this->logger->countSince('error', 3600);
        $warningCount = $this->logger->countSince('warning', 3600);
        $requestEstimate = max(200, $activeCount * 120);
        $errorRatePct = (($errorCount + ($warningCount * 0.5)) / $requestEstimate) * 100;

        return [
            // Real guest p95 TTFB must be measured by worker-side synthetic checks.
            'guest_p95_ttfb_ms' => 0.0,
            'error_rate_pct' => round(max(0.0, $errorRatePct), 4),
            // Cache hit rate must come from edge/cache telemetry, not origin heuristics.
            'cache_hit_rate_pct' => 0.0,
        ];
    }
}
