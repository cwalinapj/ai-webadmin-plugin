<?php

namespace WebAdminEdgeAgent\Api\Endpoints;

use WebAdminEdgeAgent\Api\Client;
use WebAdminEdgeAgent\Command\Dispatcher;
use WebAdminEdgeAgent\Security\Capabilities;
use WebAdminEdgeAgent\Storage\JobStore;
use WebAdminEdgeAgent\Storage\Logger;
use WebAdminEdgeAgent\Storage\Options;
use WebAdminEdgeAgent\Storage\TabState;

class SafeUpdates
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
    public function run(string $source = 'manual'): array
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

        $inventory = $this->collectUpdateInventory(
            !empty($settings['safe_updates_include_core']),
            !empty($settings['safe_updates_include_plugins']),
            !empty($settings['safe_updates_include_themes'])
        );

        $payload = [
            'site_id' => $siteId,
            'domain' => (string)$settings['domain'],
            'targets' => [
                'core' => !empty($settings['safe_updates_include_core']),
                'plugins' => !empty($settings['safe_updates_include_plugins']),
                'themes' => !empty($settings['safe_updates_include_themes']),
                'plugin_allowlist' => $this->splitLines((string)$settings['safe_updates_plugin_allowlist']),
                'theme_allowlist' => $this->splitLines((string)$settings['safe_updates_theme_allowlist']),
            ],
            'candidates' => $inventory,
            'guardrails' => [
                'guest_p95_ttfb_ms' => (float)$settings['performance_slo_goal_guest_p95_ttfb_ms'],
                'error_rate_pct' => (float)$settings['performance_slo_goal_error_rate_pct'],
                'cache_hit_rate_pct' => (float)$settings['performance_slo_goal_cache_hit_pct'],
            ],
            'dry_run' => !empty($settings['safe_updates_dry_run']),
            'stage_percent' => 10,
        ];

        $response = $this->client->requestJson(
            'POST',
            '/plugin/wp/updates/safe/run',
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
            $this->dispatcher->dispatch($commands, 'security');

            $this->options->saveSettings([
                'safe_updates_last_status' => 'ok',
                'safe_updates_last_message' => 'Safe update workflow planned.',
                'safe_updates_last_at' => time(),
                'safe_updates_last_result_json' => $resultJson,
            ]);
            $this->tabState->recordSync('security', 'ok', 'Safe update workflow planned.');
            $this->tabState->addFinding('security', 'info', 'Safe update plan generated', 'Stage -> canary -> health checks -> rollback path ready.');
            $this->jobStore->add('security', 'safe_update_workflow', 'completed', 0.0, !empty($payload['dry_run']), ['source' => $source]);
            $this->logger->log('info', 'Safe update workflow planned', [
                'source' => $source,
                'request_id' => (string)($response['request_id'] ?? ''),
            ]);
        } else {
            $message = 'Safe update workflow failed.';
            if (!empty($response['status'])) {
                $message .= ' HTTP ' . (int)$response['status'];
            }
            if (!empty($response['error'])) {
                $message .= ' ' . sanitize_text_field((string)$response['error']);
            }

            $this->options->saveSettings([
                'safe_updates_last_status' => 'error',
                'safe_updates_last_message' => $message,
                'safe_updates_last_at' => time(),
            ]);
            $this->tabState->recordSync('security', 'error', $message);
            $this->tabState->addFinding('security', 'error', 'Safe update workflow failed', $message);
            $this->jobStore->add('security', 'safe_update_workflow', 'failed', 0.8, true, ['source' => $source]);
            $this->logger->log('error', 'Safe update workflow failed', [
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
     * @return array<string, mixed>
     */
    private function collectUpdateInventory(bool $includeCore, bool $includePlugins, bool $includeThemes): array
    {
        require_once ABSPATH . 'wp-admin/includes/update.php';
        wp_version_check();
        wp_update_plugins();
        wp_update_themes();

        $coreCandidate = null;
        if ($includeCore) {
            $coreUpdates = get_core_updates(['available' => true]);
            if (is_array($coreUpdates) && !empty($coreUpdates[0]) && is_object($coreUpdates[0])) {
                /** @var object $coreUpdate */
                $coreUpdate = $coreUpdates[0];
                $coreCandidate = [
                    'current' => (string)get_bloginfo('version'),
                    'target' => isset($coreUpdate->version) ? (string)$coreUpdate->version : '',
                    'locale' => isset($coreUpdate->locale) ? (string)$coreUpdate->locale : '',
                ];
            }
        }

        $pluginCandidates = [];
        if ($includePlugins) {
            $transient = get_site_transient('update_plugins');
            $responses = is_object($transient) && isset($transient->response) && is_object($transient->response)
                ? (array)$transient->response
                : [];
            foreach ($responses as $pluginFile => $item) {
                if (!is_object($item)) {
                    continue;
                }
                $pluginCandidates[] = [
                    'file' => (string)$pluginFile,
                    'slug' => isset($item->slug) ? (string)$item->slug : '',
                    'current' => isset($item->old_version) ? (string)$item->old_version : '',
                    'target' => isset($item->new_version) ? (string)$item->new_version : '',
                    'package' => isset($item->package) ? (string)$item->package : '',
                ];
            }
        }

        $themeCandidates = [];
        if ($includeThemes) {
            $transient = get_site_transient('update_themes');
            $responses = is_object($transient) && isset($transient->response) && is_array($transient->response)
                ? $transient->response
                : [];
            foreach ($responses as $stylesheet => $item) {
                if (!is_array($item)) {
                    continue;
                }
                $themeCandidates[] = [
                    'stylesheet' => (string)$stylesheet,
                    'current' => isset($item['current']) ? (string)$item['current'] : '',
                    'target' => isset($item['new_version']) ? (string)$item['new_version'] : '',
                    'package' => isset($item['package']) ? (string)$item['package'] : '',
                ];
            }
        }

        return [
            'core' => $coreCandidate,
            'plugins' => $pluginCandidates,
            'themes' => $themeCandidates,
        ];
    }

    /**
     * @return array<int, string>
     */
    private function splitLines(string $value): array
    {
        $parts = preg_split('/[\r\n,]+/', $value);
        if (!is_array($parts)) {
            return [];
        }

        $result = [];
        foreach ($parts as $part) {
            $item = sanitize_text_field(trim($part));
            if ($item === '') {
                continue;
            }
            $result[] = $item;
        }

        return array_values(array_unique($result));
    }
}
