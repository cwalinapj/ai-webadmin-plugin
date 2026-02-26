<?php

namespace WebAdminEdgeAgent\Api\Endpoints;

use WebAdminEdgeAgent\Api\Client;
use WebAdminEdgeAgent\Command\Dispatcher;
use WebAdminEdgeAgent\Security\Capabilities;
use WebAdminEdgeAgent\Storage\JobStore;
use WebAdminEdgeAgent\Storage\Logger;
use WebAdminEdgeAgent\Storage\Options;
use WebAdminEdgeAgent\Storage\TabState;

class Heartbeat
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
    )
    {
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
    public function send(string $source = 'manual'): array
    {
        $settings = $this->options->getSettings();
        $siteId = (string)$settings['site_id'];
        if ($siteId === '') {
            $siteId = (string)$settings['plugin_id'];
        }

        if ($siteId === '') {
            $this->options->updateHeartbeatStatus('error', 'Missing site_id or plugin_id.');
            $this->tabState->recordSync('uptime', 'error', 'Missing site_id or plugin_id.');
            $this->jobStore->add('uptime', 'heartbeat', 'failed', 0.0, true, ['source' => $source]);

            return [
                'ok' => false,
                'error' => 'missing_site_id',
            ];
        }

        $payload = [
            'site_id' => $siteId,
            'domain' => (string)$settings['domain'],
            'plan' => (string)$settings['plan'],
            'timezone' => (string)$settings['timezone'],
            'wp_version' => get_bloginfo('version'),
            'php_version' => PHP_VERSION,
            'theme' => wp_get_theme()->get('Name'),
            'active_plugins_count' => count((array)get_option('active_plugins', [])),
            'load_avg' => $this->getLoadAverage(),
            'error_counts' => [
                'plugin_errors_24h' => $this->logger->countSince('error', 86400),
                'plugin_warnings_24h' => $this->logger->countSince('warning', 86400),
            ],
            'site_url' => home_url('/'),
        ];

        $response = $this->client->requestJson('POST', '/plugin/wp/watchdog/heartbeat', $payload, Capabilities::UPTIME_WRITE);

        if (!empty($response['ok'])) {
            $commands = [];
            if (isset($response['body']['commands']) && is_array($response['body']['commands'])) {
                $commands = $response['body']['commands'];
            }
            $dispatchResults = $this->dispatcher->dispatch($commands, 'uptime');
            $message = 'Heartbeat accepted. Commands: ' . count($commands);
            $this->options->updateHeartbeatStatus('ok', $message);
            $this->tabState->recordSync('uptime', 'ok', $message);
            $this->jobStore->add('uptime', 'heartbeat', 'completed', 0.0, true, ['source' => $source]);
            $this->logger->log('info', 'Heartbeat accepted', [
                'commands' => (string)count($commands),
                'request_id' => (string)($response['request_id'] ?? ''),
            ]);

            $failedDispatch = 0;
            foreach ($dispatchResults as $dispatchResult) {
                if (!is_array($dispatchResult)) {
                    continue;
                }
                if (empty($dispatchResult['ok'])) {
                    $failedDispatch += 1;
                }
            }
            if ($failedDispatch > 0) {
                $this->tabState->addFinding(
                    'uptime',
                    'warning',
                    'Command dispatch issues',
                    'Some worker commands were rejected by local guardrails.'
                );
            }
        } else {
            $message = 'Heartbeat failed.';
            if (!empty($response['status'])) {
                $message .= ' HTTP ' . (int)$response['status'];
            }
            if (!empty($response['error'])) {
                $message .= ' ' . sanitize_text_field((string)$response['error']);
            }
            $this->options->updateHeartbeatStatus('error', $message);
            $this->tabState->recordSync('uptime', 'error', $message);
            $this->tabState->addFinding('uptime', 'error', 'Heartbeat failed', $message);
            $this->jobStore->add('uptime', 'heartbeat', 'failed', 1.0, true, ['source' => $source]);
            $this->logger->log('error', 'Heartbeat failed', [
                'status' => (string)($response['status'] ?? 0),
                'request_id' => (string)($response['request_id'] ?? ''),
            ]);
        }

        return $response;
    }

    /**
     * @return array<int, float>
     */
    private function getLoadAverage(): array
    {
        if (!function_exists('sys_getloadavg')) {
            return [];
        }

        $value = sys_getloadavg();
        if (!is_array($value)) {
            return [];
        }

        return array_map('floatval', $value);
    }
}
