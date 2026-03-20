<?php

namespace WebAdminEdgeAgent\Api\Endpoints;

use WebAdminEdgeAgent\Api\Client;
use WebAdminEdgeAgent\Security\Capabilities;
use WebAdminEdgeAgent\Storage\JobStore;
use WebAdminEdgeAgent\Storage\Logger;
use WebAdminEdgeAgent\Storage\Options;
use WebAdminEdgeAgent\Storage\TabState;

class AnalyticsGoogle
{
    private Options $options;

    private Logger $logger;

    private Client $client;

    private TabState $tabState;

    private JobStore $jobStore;

    public function __construct(
        Options $options,
        Logger $logger,
        Client $client,
        TabState $tabState,
        JobStore $jobStore
    ) {
        $this->options = $options;
        $this->logger = $logger;
        $this->client = $client;
        $this->tabState = $tabState;
        $this->jobStore = $jobStore;
    }

    /**
     * @return array<string, mixed>
     */
    public function startConnect(string $returnUrl): array
    {
        $siteId = $this->resolveSiteId();
        if ($siteId === '') {
            return [
                'ok' => false,
                'status' => 0,
                'error' => 'missing_site_id',
            ];
        }

        $settings = $this->options->getSettings();
        $payload = [
            'site_id' => $siteId,
            'domain' => (string)$settings['domain'],
            'return_url' => esc_url_raw($returnUrl),
        ];

        $response = $this->client->requestJson(
            'POST',
            '/plugin/wp/analytics/google/connect/start',
            $payload,
            Capabilities::ANALYTICS_WRITE
        );

        if (!empty($response['ok']) && isset($response['body']['session_id'])) {
            $this->options->saveSettings([
                'analytics_google_session_id' => sanitize_text_field((string)$response['body']['session_id']),
                'analytics_google_last_status' => 'pending',
                'analytics_google_last_message' => 'Awaiting Google authorization callback.',
                'analytics_google_last_sync_at' => time(),
            ]);
            $this->tabState->recordSync('analytics', 'ok', 'Google OAuth flow started.');
            $this->logger->log('info', 'Google OAuth connect started', [
                'request_id' => (string)($response['request_id'] ?? ''),
            ]);
        }

        return $response;
    }

    /**
     * @return array<string, mixed>
     */
    public function status(string $source = 'manual'): array
    {
        $siteId = $this->resolveSiteId();
        if ($siteId === '') {
            return [
                'ok' => false,
                'status' => 0,
                'error' => 'missing_site_id',
            ];
        }

        $settings = $this->options->getSettings();
        $payload = [
            'site_id' => $siteId,
            'domain' => (string)$settings['domain'],
        ];

        $response = $this->client->requestJson(
            'POST',
            '/plugin/wp/analytics/google/status',
            $payload,
            Capabilities::ANALYTICS_WRITE
        );

        if (!empty($response['ok']) && isset($response['body']) && is_array($response['body'])) {
            $connected = !empty($response['body']['connected']);
            $email = isset($response['body']['email']) ? sanitize_email((string)$response['body']['email']) : '';

            $this->options->saveSettings([
                'analytics_google_connected' => $connected ? 1 : 0,
                'analytics_google_account_email' => $email,
                'analytics_google_last_status' => $connected ? 'connected' : 'disconnected',
                'analytics_google_last_message' => $connected ? 'Google account connected.' : 'Google account not connected.',
                'analytics_google_last_sync_at' => time(),
            ]);
            $this->tabState->recordSync('analytics', 'ok', 'Google status synced.');
            $this->jobStore->add('analytics', 'google_status', 'completed', 0.0, true, ['source' => $source]);
        } else {
            $this->options->saveSettings([
                'analytics_google_last_status' => 'error',
                'analytics_google_last_message' => 'Failed to sync Google status.',
                'analytics_google_last_sync_at' => time(),
            ]);
            $this->tabState->recordSync('analytics', 'error', 'Failed to sync Google status.');
            $this->jobStore->add('analytics', 'google_status', 'failed', 0.3, true, ['source' => $source]);
        }

        return $response;
    }

    /**
     * @return array<string, mixed>
     */
    public function deploy(string $source = 'manual', bool $dryRun = false): array
    {
        $siteId = $this->resolveSiteId();
        if ($siteId === '') {
            return [
                'ok' => false,
                'status' => 0,
                'error' => 'missing_site_id',
            ];
        }

        $settings = $this->options->getSettings();
        $payload = [
            'site_id' => $siteId,
            'domain' => (string)$settings['domain'],
            'ga4_measurement_id' => (string)$settings['ga4_measurement_id'],
            'ga4_property_id' => (string)$settings['ga4_property_id'],
            'gtm_account_id' => (string)$settings['gtm_account_id'],
            'gtm_container_id' => (string)$settings['gtm_container_id'],
            'gtm_workspace_name' => (string)$settings['gtm_workspace_name'],
            'primary_conversion' => (string)$settings['analytics_primary_conversion'],
            'secondary_conversions' => $this->splitLines((string)$settings['analytics_secondary_conversions']),
            'funnel_steps' => $this->splitLines((string)$settings['analytics_funnel_steps']),
            'key_pages' => $this->splitLines((string)$settings['analytics_key_pages']),
            'dry_run' => $dryRun,
        ];

        $response = $this->client->requestJson(
            'POST',
            '/plugin/wp/analytics/google/deploy',
            $payload,
            Capabilities::ANALYTICS_WRITE
        );

        if (!empty($response['ok']) && isset($response['body']) && is_array($response['body'])) {
            $deployBody = $response['body'];
            $deployStatus = $dryRun ? 'dry_run' : 'ok';
            $deployMessage = $dryRun
                ? 'Preview generated. Review diff and deploy plan.'
                : 'Google deploy completed.';

            if (!$dryRun) {
                $verification = $this->status('post_deploy_verify');
                $verified = !empty($verification['ok']) && !empty($verification['body']['connected']);
                $deployBody['post_deploy_verification'] = [
                    'connected' => $verified,
                    'status_response' => $verification['body'] ?? [],
                ];
                if ($verified) {
                    $deployMessage = 'Google deploy completed and verification succeeded.';
                } else {
                    $deployStatus = 'warning';
                    $deployMessage = 'Deploy completed, but verification failed. Rollback is recommended.';
                    $this->tabState->addFinding('analytics', 'warning', 'Deploy verification failed', 'Deploy finished but verification did not confirm an active connected account. Review and rollback if needed.');
                }
            }

            $deployJson = wp_json_encode($deployBody, JSON_PRETTY_PRINT);
            $this->options->saveSettings([
                'analytics_google_last_deploy_json' => $this->capDeployArtifact($deployJson),
                'analytics_google_last_deploy_status' => $deployStatus,
                'analytics_google_last_deploy_message' => $deployMessage,
                'analytics_google_last_deploy_at' => time(),
            ]);
            $tabSyncStatus = $deployStatus === 'warning' ? 'warning' : 'ok';
            $this->tabState->recordSync('analytics', $tabSyncStatus, $deployMessage);
            $findingTitle = $dryRun ? 'Google deploy preview generated' : 'Google deploy complete';
            $findingDetail = $dryRun
                ? 'Review preview payload for tags/triggers/conversions before applying.'
                : 'GTM and GA4 conversions were deployed.';
            $this->tabState->addFinding('analytics', 'info', $findingTitle, $findingDetail);
            $this->jobStore->add('analytics', $dryRun ? 'google_deploy_preview' : 'google_deploy', 'completed', 0.0, $dryRun, ['source' => $source]);
            $this->logger->log('info', $dryRun ? 'Google deploy preview generated' : 'Google deploy completed', [
                'source' => $source,
                'dry_run' => $dryRun ? '1' : '0',
                'request_id' => (string)($response['request_id'] ?? ''),
            ]);
        } else {
            $message = $dryRun ? 'Google preview failed.' : 'Google deploy failed.';
            if (!empty($response['status'])) {
                $message .= ' HTTP ' . (int)$response['status'];
            }
            if (!empty($response['error'])) {
                $message .= ' ' . sanitize_text_field((string)$response['error']);
            }

            $this->options->saveSettings([
                'analytics_google_last_deploy_status' => 'error',
                'analytics_google_last_deploy_message' => $message,
                'analytics_google_last_deploy_at' => time(),
            ]);
            $this->tabState->recordSync('analytics', 'error', $message);
            $this->tabState->addFinding('analytics', 'error', $dryRun ? 'Google preview failed' : 'Google deploy failed', $message);
            $this->jobStore->add('analytics', $dryRun ? 'google_deploy_preview' : 'google_deploy', 'failed', 0.7, $dryRun, ['source' => $source]);
            $this->logger->log('error', $dryRun ? 'Google deploy preview failed' : 'Google deploy failed', [
                'status' => (string)($response['status'] ?? 0),
                'dry_run' => $dryRun ? '1' : '0',
                'request_id' => (string)($response['request_id'] ?? ''),
            ]);
        }

        return $response;
    }

    private function resolveSiteId(): string
    {
        $settings = $this->options->getSettings();
        $siteId = (string)$settings['site_id'];
        if ($siteId === '') {
            $siteId = (string)$settings['plugin_id'];
        }

        return $siteId;
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

    private function capDeployArtifact($json): string
    {
        if (!is_string($json) || $json === '') {
            return '';
        }

        $limit = 100000;
        if (strlen($json) <= $limit) {
            return $json;
        }

        $payload = [
            'truncated' => true,
            'limit_bytes' => $limit,
            'message' => 'Deploy artifact exceeded local storage cap and was truncated.',
            'excerpt' => substr($json, 0, $limit),
        ];
        $encoded = wp_json_encode($payload, JSON_PRETTY_PRINT);

        return is_string($encoded) ? $encoded : '';
    }
}
