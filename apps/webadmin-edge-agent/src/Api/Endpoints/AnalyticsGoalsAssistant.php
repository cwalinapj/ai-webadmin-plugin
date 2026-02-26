<?php

namespace WebAdminEdgeAgent\Api\Endpoints;

use WebAdminEdgeAgent\Api\Client;
use WebAdminEdgeAgent\Security\Capabilities;
use WebAdminEdgeAgent\Storage\JobStore;
use WebAdminEdgeAgent\Storage\Logger;
use WebAdminEdgeAgent\Storage\Options;
use WebAdminEdgeAgent\Storage\TabState;

class AnalyticsGoalsAssistant
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
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function generate(array $input, string $source = 'manual'): array
    {
        $settings = $this->options->getSettings();
        $siteId = (string)$settings['site_id'];
        if ($siteId === '') {
            $siteId = (string)$settings['plugin_id'];
        }

        if ($siteId === '') {
            return [
                'ok' => false,
                'status' => 0,
                'error' => 'missing_site_id',
            ];
        }

        $businessType = isset($input['analytics_goal_business_type'])
            ? sanitize_text_field((string)$input['analytics_goal_business_type'])
            : (string)$settings['analytics_goal_business_type'];
        $objective = isset($input['analytics_goal_objective'])
            ? sanitize_text_field((string)$input['analytics_goal_objective'])
            : (string)$settings['analytics_goal_objective'];
        $channels = isset($input['analytics_goal_channels'])
            ? sanitize_textarea_field((string)$input['analytics_goal_channels'])
            : (string)$settings['analytics_goal_channels'];
        $formTypes = isset($input['analytics_goal_form_types'])
            ? sanitize_textarea_field((string)$input['analytics_goal_form_types'])
            : (string)$settings['analytics_goal_form_types'];
        $avgLeadValue = isset($input['analytics_goal_avg_value'])
            ? (float)$input['analytics_goal_avg_value']
            : (float)$settings['analytics_goal_avg_value'];

        $payload = [
            'site_id' => $siteId,
            'domain' => (string)$settings['domain'],
            'business_type' => $businessType,
            'objective' => $objective,
            'channels' => $this->splitLines($channels),
            'form_types' => $this->splitLines($formTypes),
            'avg_lead_value' => $avgLeadValue,
            'ga4_measurement_id' => (string)$settings['ga4_measurement_id'],
            'gtm_container_id' => (string)$settings['gtm_container_id'],
        ];

        $response = $this->client->requestJson(
            'POST',
            '/plugin/wp/analytics/goals/assistant',
            $payload,
            Capabilities::ANALYTICS_WRITE
        );

        if (!empty($response['ok'])) {
            $planJson = '';
            if (isset($response['body']) && is_array($response['body'])) {
                $encoded = wp_json_encode($response['body'], JSON_PRETTY_PRINT);
                if (is_string($encoded)) {
                    $planJson = $encoded;
                }
            }

            $this->options->saveSettings([
                'analytics_goal_business_type' => $businessType,
                'analytics_goal_objective' => $objective,
                'analytics_goal_channels' => $channels,
                'analytics_goal_form_types' => $formTypes,
                'analytics_goal_avg_value' => $avgLeadValue,
                'analytics_goal_last_plan_json' => $planJson,
                'analytics_goal_last_plan_status' => 'ok',
                'analytics_goal_last_plan_message' => 'Goal plan generated successfully.',
                'analytics_goal_last_plan_at' => time(),
            ]);
            $this->tabState->recordSync('analytics', 'ok', 'Goal assistant generated recommendations.');
            $this->tabState->addFinding('analytics', 'info', 'Goal plan generated', 'Review recommended goals and events.');
            $this->jobStore->add('analytics', 'goals_assistant', 'completed', 0.0, true, ['source' => $source]);
            $this->logger->log('info', 'Goal assistant generated', [
                'source' => $source,
                'request_id' => (string)($response['request_id'] ?? ''),
            ]);
        } else {
            $message = 'Goal assistant failed.';
            if (!empty($response['status'])) {
                $message .= ' HTTP ' . (int)$response['status'];
            }
            if (!empty($response['error'])) {
                $message .= ' ' . sanitize_text_field((string)$response['error']);
            }

            $this->options->saveSettings([
                'analytics_goal_last_plan_status' => 'error',
                'analytics_goal_last_plan_message' => $message,
                'analytics_goal_last_plan_at' => time(),
            ]);
            $this->tabState->recordSync('analytics', 'error', $message);
            $this->tabState->addFinding('analytics', 'error', 'Goal plan failed', $message);
            $this->jobStore->add('analytics', 'goals_assistant', 'failed', 0.4, true, ['source' => $source]);
            $this->logger->log('error', 'Goal assistant failed', [
                'status' => (string)($response['status'] ?? 0),
                'request_id' => (string)($response['request_id'] ?? ''),
            ]);
        }

        return $response;
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
