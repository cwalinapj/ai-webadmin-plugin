<?php

namespace WebAdminEdgeAgent\Admin;

use WebAdminEdgeAgent\Admin\Tabs\AnalyticsTab;
use WebAdminEdgeAgent\Admin\Tabs\DnsEmailTab;
use WebAdminEdgeAgent\Admin\Tabs\LeadsTab;
use WebAdminEdgeAgent\Admin\Tabs\SecurityTab;
use WebAdminEdgeAgent\Admin\Tabs\UptimeTab;
use WebAdminEdgeAgent\Api\Endpoints\AnalyticsGoogle;
use WebAdminEdgeAgent\Api\Endpoints\AnalyticsGoalsAssistant;
use WebAdminEdgeAgent\Api\Endpoints\Heartbeat;
use WebAdminEdgeAgent\Storage\JobStore;
use WebAdminEdgeAgent\Storage\Logger;
use WebAdminEdgeAgent\Storage\Options;
use WebAdminEdgeAgent\Storage\TabState;

class Menu
{
    private Options $options;

    private Logger $logger;

    private Heartbeat $heartbeat;

    private AnalyticsGoogle $analyticsGoogle;

    private AnalyticsGoalsAssistant $analyticsGoalsAssistant;

    private TabState $tabState;

    private JobStore $jobStore;

    public function __construct(
        Options $options,
        Logger $logger,
        Heartbeat $heartbeat,
        AnalyticsGoogle $analyticsGoogle,
        AnalyticsGoalsAssistant $analyticsGoalsAssistant,
        TabState $tabState,
        JobStore $jobStore
    ) {
        $this->options = $options;
        $this->logger = $logger;
        $this->heartbeat = $heartbeat;
        $this->analyticsGoogle = $analyticsGoogle;
        $this->analyticsGoalsAssistant = $analyticsGoalsAssistant;
        $this->tabState = $tabState;
        $this->jobStore = $jobStore;
    }

    public function register(): void
    {
        add_action('admin_menu', [$this, 'registerMenu']);
        add_action('admin_post_webadmin_edge_agent_save_settings', [$this, 'handleSaveSettings']);
        add_action('admin_post_webadmin_edge_agent_save_analytics_settings', [$this, 'handleSaveAnalyticsSettings']);
        add_action('admin_post_webadmin_edge_agent_generate_analytics_api_key', [$this, 'handleGenerateAnalyticsApiKey']);
        add_action('admin_post_webadmin_edge_agent_generate_goal_plan', [$this, 'handleGenerateGoalPlan']);
        add_action('admin_post_webadmin_edge_agent_apply_goal_plan', [$this, 'handleApplyGoalPlan']);
        add_action('admin_post_webadmin_edge_agent_send_heartbeat', [$this, 'handleSendHeartbeat']);
        add_action('admin_post_webadmin_edge_agent_start_google_connect', [$this, 'handleStartGoogleConnect']);
        add_action('admin_post_webadmin_edge_agent_refresh_google_status', [$this, 'handleRefreshGoogleStatus']);
        add_action('admin_post_webadmin_edge_agent_deploy_google_analytics', [$this, 'handleDeployGoogleAnalytics']);
        add_action('admin_post_webadmin_edge_agent_run_tab_sync', [$this, 'handleRunTabSync']);
    }

    public function registerMenu(): void
    {
        add_menu_page(
            'WebAdmin Edge Agent',
            'WebAdmin Edge Agent',
            'manage_options',
            'webadmin-edge-agent',
            [$this, 'renderPage'],
            'dashicons-shield-alt',
            56
        );
    }

    public function handleSaveSettings(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Unauthorized', 'webadmin-edge-agent'));
        }

        check_admin_referer('webadmin_edge_agent_save_settings', 'webadmin_edge_agent_nonce');

        $input = [
            'worker_base_url' => isset($_POST['worker_base_url']) ? wp_unslash($_POST['worker_base_url']) : '',
            'plugin_id' => isset($_POST['plugin_id']) ? wp_unslash($_POST['plugin_id']) : '',
            'site_id' => isset($_POST['site_id']) ? wp_unslash($_POST['site_id']) : '',
            'domain' => isset($_POST['domain']) ? wp_unslash($_POST['domain']) : '',
            'plan' => isset($_POST['plan']) ? wp_unslash($_POST['plan']) : '',
            'timezone' => isset($_POST['timezone']) ? wp_unslash($_POST['timezone']) : '',
            'shared_secret' => isset($_POST['shared_secret']) ? wp_unslash($_POST['shared_secret']) : '',
            'capability_token_uptime' => isset($_POST['capability_token_uptime']) ? wp_unslash($_POST['capability_token_uptime']) : '',
        ];

        $this->options->saveSettings($input);
        $this->logger->log('info', 'Connection settings updated');
        add_settings_error('webadmin-edge-agent', 'settings-saved', 'Settings saved.', 'updated');

        $this->redirectWithTab('uptime');
    }

    public function handleSaveAnalyticsSettings(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Unauthorized', 'webadmin-edge-agent'));
        }

        check_admin_referer('webadmin_edge_agent_save_analytics_settings', 'webadmin_edge_agent_analytics_nonce');

        $input = [
            'ga4_measurement_id' => isset($_POST['ga4_measurement_id']) ? wp_unslash($_POST['ga4_measurement_id']) : '',
            'ga4_property_id' => isset($_POST['ga4_property_id']) ? wp_unslash($_POST['ga4_property_id']) : '',
            'gtm_account_id' => isset($_POST['gtm_account_id']) ? wp_unslash($_POST['gtm_account_id']) : '',
            'gtm_container_id' => isset($_POST['gtm_container_id']) ? wp_unslash($_POST['gtm_container_id']) : '',
            'gtm_workspace_name' => isset($_POST['gtm_workspace_name']) ? wp_unslash($_POST['gtm_workspace_name']) : '',
            'gsc_property_url' => isset($_POST['gsc_property_url']) ? wp_unslash($_POST['gsc_property_url']) : '',
            'capability_token_analytics' => isset($_POST['capability_token_analytics']) ? wp_unslash($_POST['capability_token_analytics']) : '',
            'enable_gtm_snippet' => isset($_POST['enable_gtm_snippet']) ? wp_unslash($_POST['enable_gtm_snippet']) : '0',
            'enable_lead_event_push' => isset($_POST['enable_lead_event_push']) ? wp_unslash($_POST['enable_lead_event_push']) : '0',
            'analytics_primary_conversion' => isset($_POST['analytics_primary_conversion']) ? wp_unslash($_POST['analytics_primary_conversion']) : '',
            'analytics_secondary_conversions' => isset($_POST['analytics_secondary_conversions']) ? wp_unslash($_POST['analytics_secondary_conversions']) : '',
            'analytics_funnel_steps' => isset($_POST['analytics_funnel_steps']) ? wp_unslash($_POST['analytics_funnel_steps']) : '',
            'analytics_key_pages' => isset($_POST['analytics_key_pages']) ? wp_unslash($_POST['analytics_key_pages']) : '',
        ];

        $this->options->saveSettings($input);
        $this->logger->log('info', 'Analytics settings updated');
        add_settings_error('webadmin-edge-agent', 'analytics-settings-saved', 'Analytics settings saved.', 'updated');

        $this->redirectWithTab('analytics');
    }

    public function handleGenerateAnalyticsApiKey(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Unauthorized', 'webadmin-edge-agent'));
        }

        check_admin_referer('webadmin_edge_agent_generate_analytics_api_key', 'webadmin_edge_agent_generate_analytics_api_key_nonce');

        $token = '';
        try {
            $token = bin2hex(random_bytes(24));
        } catch (\Throwable $exception) {
            $token = wp_generate_password(48, false, false);
        }

        $this->options->saveSettings([
            'capability_token_analytics' => $token,
        ]);

        $transientKey = 'webadmin_edge_agent_generated_analytics_api_key_' . get_current_user_id();
        set_transient($transientKey, $token, 5 * MINUTE_IN_SECONDS);

        add_settings_error('webadmin-edge-agent', 'analytics-api-key-generated', 'New Analytics API key generated and saved.', 'updated');
        $this->redirectWithTab('analytics');
    }

    public function handleGenerateGoalPlan(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Unauthorized', 'webadmin-edge-agent'));
        }

        check_admin_referer('webadmin_edge_agent_generate_goal_plan', 'webadmin_edge_agent_goal_plan_nonce');

        $input = [
            'analytics_goal_business_type' => isset($_POST['analytics_goal_business_type']) ? wp_unslash($_POST['analytics_goal_business_type']) : '',
            'analytics_goal_objective' => isset($_POST['analytics_goal_objective']) ? wp_unslash($_POST['analytics_goal_objective']) : '',
            'analytics_goal_channels' => isset($_POST['analytics_goal_channels']) ? wp_unslash($_POST['analytics_goal_channels']) : '',
            'analytics_goal_form_types' => isset($_POST['analytics_goal_form_types']) ? wp_unslash($_POST['analytics_goal_form_types']) : '',
            'analytics_goal_avg_value' => isset($_POST['analytics_goal_avg_value']) ? wp_unslash($_POST['analytics_goal_avg_value']) : '',
        ];

        $response = $this->analyticsGoalsAssistant->generate($input, 'manual');
        if (!empty($response['ok'])) {
            add_settings_error('webadmin-edge-agent', 'goal-plan-ok', 'AI goal plan generated.', 'updated');
        } else {
            $message = 'AI goal plan generation failed.';
            if (!empty($response['error'])) {
                $message .= ' ' . sanitize_text_field((string)$response['error']);
            }
            add_settings_error('webadmin-edge-agent', 'goal-plan-error', $message, 'error');
        }

        $this->redirectWithTab('analytics');
    }

    public function handleApplyGoalPlan(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Unauthorized', 'webadmin-edge-agent'));
        }

        check_admin_referer('webadmin_edge_agent_apply_goal_plan', 'webadmin_edge_agent_apply_goal_plan_nonce');

        $settings = $this->options->getSettings();
        $planJson = isset($settings['analytics_goal_last_plan_json'])
            ? (string)$settings['analytics_goal_last_plan_json']
            : '';
        if ($planJson === '') {
            add_settings_error('webadmin-edge-agent', 'goal-plan-apply-error', 'No goal plan found. Generate a plan first.', 'error');
            $this->redirectWithTab('analytics');
        }

        $decoded = json_decode($planJson, true);
        if (!is_array($decoded)) {
            add_settings_error('webadmin-edge-agent', 'goal-plan-apply-error', 'Stored goal plan is invalid JSON.', 'error');
            $this->redirectWithTab('analytics');
        }

        $updates = $this->extractGoalPlanSettings($decoded);
        if (empty($updates)) {
            add_settings_error('webadmin-edge-agent', 'goal-plan-apply-error', 'Goal plan did not include usable conversion settings.', 'error');
            $this->redirectWithTab('analytics');
        }

        $this->options->saveSettings($updates);
        $this->tabState->recordSync('analytics', 'ok', 'Applied AI goal plan to analytics settings.');
        $this->tabState->addFinding('analytics', 'info', 'AI goal plan applied', 'Conversion and funnel settings were updated from assistant output.');
        $this->jobStore->add('analytics', 'apply_goal_plan', 'completed', 0.0, false, ['source' => 'manual']);
        $this->logger->log('info', 'Applied AI goal plan settings');

        add_settings_error('webadmin-edge-agent', 'goal-plan-apply-ok', 'AI goal plan applied to Analytics settings.', 'updated');
        $this->redirectWithTab('analytics');
    }

    public function handleSendHeartbeat(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Unauthorized', 'webadmin-edge-agent'));
        }

        check_admin_referer('webadmin_edge_agent_send_heartbeat', 'webadmin_edge_agent_heartbeat_nonce');

        $result = $this->heartbeat->send('manual');
        if (!empty($result['ok'])) {
            add_settings_error('webadmin-edge-agent', 'heartbeat-ok', 'Heartbeat sent successfully.', 'updated');
        } else {
            $message = 'Heartbeat failed.';
            if (!empty($result['error'])) {
                $message .= ' ' . sanitize_text_field((string)$result['error']);
            }
            add_settings_error('webadmin-edge-agent', 'heartbeat-error', $message, 'error');
        }

        $this->redirectWithTab('uptime');
    }

    public function handleStartGoogleConnect(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Unauthorized', 'webadmin-edge-agent'));
        }

        check_admin_referer('webadmin_edge_agent_start_google_connect', 'webadmin_edge_agent_google_connect_nonce');

        $returnUrl = admin_url('admin.php?page=webadmin-edge-agent&tab=analytics');
        $response = $this->analyticsGoogle->startConnect($returnUrl);

        if (!empty($response['ok']) && isset($response['body']['auth_url'])) {
            wp_redirect(esc_url_raw((string)$response['body']['auth_url']));
            exit;
        }

        $message = 'Failed to start Google OAuth.';
        if (!empty($response['error'])) {
            $message .= ' ' . sanitize_text_field((string)$response['error']);
        }
        add_settings_error('webadmin-edge-agent', 'google-connect-error', $message, 'error');
        $this->redirectWithTab('analytics');
    }

    public function handleRefreshGoogleStatus(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Unauthorized', 'webadmin-edge-agent'));
        }

        check_admin_referer('webadmin_edge_agent_refresh_google_status', 'webadmin_edge_agent_google_status_nonce');

        $response = $this->analyticsGoogle->status('manual');
        if (!empty($response['ok']) && !empty($response['body']['connected'])) {
            add_settings_error('webadmin-edge-agent', 'google-status-ok', 'Google connection is active.', 'updated');
        } else {
            add_settings_error('webadmin-edge-agent', 'google-status-info', 'Google connection is not active yet.', 'error');
        }

        $this->redirectWithTab('analytics');
    }

    public function handleDeployGoogleAnalytics(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Unauthorized', 'webadmin-edge-agent'));
        }

        check_admin_referer('webadmin_edge_agent_deploy_google_analytics', 'webadmin_edge_agent_google_deploy_nonce');

        $response = $this->analyticsGoogle->deploy('manual');
        if (!empty($response['ok'])) {
            add_settings_error('webadmin-edge-agent', 'google-deploy-ok', 'Google GTM + GA4 deployment completed.', 'updated');
        } else {
            $message = 'Google deployment failed.';
            if (!empty($response['error'])) {
                $message .= ' ' . sanitize_text_field((string)$response['error']);
            }
            add_settings_error('webadmin-edge-agent', 'google-deploy-error', $message, 'error');
        }

        $this->redirectWithTab('analytics');
    }

    public function handleRunTabSync(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Unauthorized', 'webadmin-edge-agent'));
        }

        check_admin_referer('webadmin_edge_agent_run_tab_sync', 'webadmin_edge_agent_tab_sync_nonce');

        $tab = isset($_POST['tab']) ? sanitize_key((string)wp_unslash($_POST['tab'])) : '';
        $tabs = $this->tabs();
        if (!isset($tabs[$tab])) {
            add_settings_error('webadmin-edge-agent', 'tab-run-invalid', 'Invalid tab selected.', 'error');
            $this->redirectWithTab('uptime');
        }

        $this->runTabSync($tab);
        $this->redirectWithTab($tab);
    }

    public function renderPage(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }

        $tabs = $this->tabs();
        $currentTab = isset($_GET['tab']) ? sanitize_key((string)wp_unslash($_GET['tab'])) : 'uptime';
        if (!isset($tabs[$currentTab])) {
            $currentTab = 'uptime';
        }

        if ($currentTab === 'analytics' && (isset($_GET['awp_google_connected']) || isset($_GET['awp_google_error']))) {
            $statusResponse = $this->analyticsGoogle->status('callback');
            if (!empty($statusResponse['ok']) && !empty($statusResponse['body']['connected'])) {
                add_settings_error('webadmin-edge-agent', 'google-callback-ok', 'Google account connected successfully.', 'updated');
            } else {
                $errorMessage = isset($_GET['awp_google_error']) ? sanitize_text_field((string)wp_unslash($_GET['awp_google_error'])) : 'unknown_error';
                add_settings_error('webadmin-edge-agent', 'google-callback-error', 'Google callback error: ' . $errorMessage, 'error');
            }
        }

        $settings = $this->options->getSettings();
        settings_errors('webadmin-edge-agent');

        echo '<div class="wrap webadmin-edge-agent">';
        echo '<h1>WebAdmin Edge Agent</h1>';
        echo '<h2 class="nav-tab-wrapper">';

        foreach ($tabs as $key => $tabData) {
            $class = $key === $currentTab ? 'nav-tab nav-tab-active' : 'nav-tab';
            $url = admin_url('admin.php?page=webadmin-edge-agent&tab=' . $key);
            echo '<a href="' . esc_url($url) . '" class="' . esc_attr($class) . '">' . esc_html((string)$tabData['label']) . '</a>';
        }

        echo '</h2>';

        $tabObject = $tabs[$currentTab]['instance'];
        if ($tabObject instanceof UptimeTab) {
            $tabObject->render([
                'settings' => $settings,
                'shared_secret_configured' => $this->options->hasSecret('shared_secret'),
                'capability_token_uptime_configured' => $this->options->hasSecret('capability_token_uptime'),
            ]);
        }

        if ($tabObject instanceof SecurityTab) {
            $tabObject->render();
        }

        if ($tabObject instanceof AnalyticsTab) {
            $generatedKeyTransient = 'webadmin_edge_agent_generated_analytics_api_key_' . get_current_user_id();
            $generatedKey = get_transient($generatedKeyTransient);
            if (is_string($generatedKey) && $generatedKey !== '') {
                delete_transient($generatedKeyTransient);
            } else {
                $generatedKey = '';
            }

            $tabObject->render([
                'settings' => $settings,
                'capability_token_analytics_configured' => $this->options->hasSecret('capability_token_analytics'),
                'generated_analytics_api_key' => $generatedKey,
                'google_connected' => !empty($settings['analytics_google_connected']),
                'google_account_email' => (string)($settings['analytics_google_account_email'] ?? ''),
                'google_last_status' => (string)($settings['analytics_google_last_status'] ?? 'never'),
                'google_last_message' => (string)($settings['analytics_google_last_message'] ?? ''),
                'google_last_deploy_status' => (string)($settings['analytics_google_last_deploy_status'] ?? 'never'),
                'google_last_deploy_message' => (string)($settings['analytics_google_last_deploy_message'] ?? ''),
                'google_last_deploy_json' => (string)($settings['analytics_google_last_deploy_json'] ?? ''),
            ]);
        }

        if ($tabObject instanceof DnsEmailTab) {
            $tabObject->render();
        }

        if ($tabObject instanceof LeadsTab) {
            $tabObject->render();
        }

        $this->renderTabShell($currentTab, (string)$tabs[$currentTab]['label']);
        $this->renderLogs();

        echo '</div>';
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function tabs(): array
    {
        return [
            'uptime' => ['label' => 'Uptime & Performance', 'instance' => new UptimeTab()],
            'security' => ['label' => 'Security', 'instance' => new SecurityTab()],
            'analytics' => ['label' => 'Analytics & Reporting', 'instance' => new AnalyticsTab()],
            'dns-email' => ['label' => 'Domain, DNS & Email', 'instance' => new DnsEmailTab()],
            'leads' => ['label' => 'Forms, Leads & Integrations', 'instance' => new LeadsTab()],
        ];
    }

    private function runTabSync(string $tab): void
    {
        if ($tab === 'uptime') {
            $result = $this->heartbeat->send('manual_run');
            if (!empty($result['ok'])) {
                add_settings_error('webadmin-edge-agent', 'tab-run-ok', 'Run now completed for Uptime & Performance.', 'updated');
            } else {
                add_settings_error('webadmin-edge-agent', 'tab-run-error', 'Run now failed for Uptime & Performance.', 'error');
            }
            return;
        }

        if ($tab === 'analytics') {
            $statusResult = $this->analyticsGoogle->status('manual_run');
            if (!empty($statusResult['ok'])) {
                add_settings_error('webadmin-edge-agent', 'tab-run-ok', 'Run now completed for Analytics & Reporting.', 'updated');
            } else {
                add_settings_error('webadmin-edge-agent', 'tab-run-error', 'Run now failed for Analytics & Reporting.', 'error');
            }
            return;
        }

        $this->tabState->recordSync($tab, 'ok', 'Manual run executed.');
        $this->tabState->addFinding(
            $tab,
            'info',
            'Manual check completed',
            'Milestone 1 shell run executed; endpoint-specific automation comes in next milestones.'
        );
        $this->jobStore->add($tab, 'manual_sync', 'completed', 0.0, true, ['source' => 'manual']);
        $this->logger->log('info', 'Manual tab sync executed', ['tab' => $tab]);

        add_settings_error('webadmin-edge-agent', 'tab-run-ok', 'Run now completed.', 'updated');
    }

    private function renderTabShell(string $tab, string $tabLabel): void
    {
        $state = $this->tabState->get($tab);
        $findings = $this->tabState->recentFindings($tab, 10);
        $jobs = $this->jobStore->recentByTab($tab, 10);

        echo '<hr/>';
        echo '<h2>' . esc_html($tabLabel) . ' Sync Shell</h2>';

        $lastSyncAt = (int)($state['last_sync_at'] ?? 0);
        $lastSyncStatus = (string)($state['last_sync_status'] ?? 'never');
        $lastSyncMessage = (string)($state['last_sync_message'] ?? '');

        echo '<p><strong>Last sync:</strong> ';
        if ($lastSyncAt > 0) {
            echo esc_html(gmdate('Y-m-d H:i:s', $lastSyncAt) . ' UTC');
        } else {
            echo esc_html('never');
        }
        echo ' (' . esc_html($lastSyncStatus) . ')';
        if ($lastSyncMessage !== '') {
            echo ' - ' . esc_html($lastSyncMessage);
        }
        echo '</p>';

        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('webadmin_edge_agent_run_tab_sync', 'webadmin_edge_agent_tab_sync_nonce');
        echo '<input type="hidden" name="action" value="webadmin_edge_agent_run_tab_sync" />';
        echo '<input type="hidden" name="tab" value="' . esc_attr($tab) . '" />';
        echo '<p><button type="submit" class="button">Run Now</button></p>';
        echo '</form>';

        echo '<h3>Recent Findings</h3>';
        if (empty($findings)) {
            echo '<p>No findings recorded yet.</p>';
        } else {
            echo '<table class="widefat striped">';
            echo '<thead><tr><th>Timestamp (UTC)</th><th>Severity</th><th>Title</th><th>Detail</th></tr></thead>';
            echo '<tbody>';
            foreach ($findings as $finding) {
                if (!is_array($finding)) {
                    continue;
                }
                echo '<tr>';
                echo '<td>' . esc_html((string)($finding['ts'] ?? '')) . '</td>';
                echo '<td>' . esc_html((string)($finding['severity'] ?? 'info')) . '</td>';
                echo '<td>' . esc_html((string)($finding['title'] ?? '')) . '</td>';
                echo '<td>' . esc_html((string)($finding['detail'] ?? '')) . '</td>';
                echo '</tr>';
            }
            echo '</tbody>';
            echo '</table>';
        }

        echo '<h3>Recent Jobs (Shared Job Table)</h3>';
        if (empty($jobs)) {
            echo '<p>No jobs recorded for this tab yet.</p>';
        } else {
            echo '<table class="widefat striped">';
            echo '<thead><tr><th>Timestamp (UTC)</th><th>Job ID</th><th>Type</th><th>Status</th><th>Risk</th><th>Dry Run</th><th>Context</th></tr></thead>';
            echo '<tbody>';
            foreach ($jobs as $job) {
                if (!is_array($job)) {
                    continue;
                }
                $context = isset($job['context']) && is_array($job['context']) ? wp_json_encode($job['context']) : '';
                echo '<tr>';
                echo '<td>' . esc_html((string)($job['ts'] ?? '')) . '</td>';
                echo '<td><code>' . esc_html((string)($job['id'] ?? '')) . '</code></td>';
                echo '<td>' . esc_html((string)($job['type'] ?? '')) . '</td>';
                echo '<td>' . esc_html((string)($job['status'] ?? '')) . '</td>';
                echo '<td>' . esc_html((string)($job['risk_score'] ?? '0')) . '</td>';
                echo '<td>' . (!empty($job['dry_run']) ? 'yes' : 'no') . '</td>';
                echo '<td><code>' . esc_html((string)$context) . '</code></td>';
                echo '</tr>';
            }
            echo '</tbody>';
            echo '</table>';
        }
    }

    private function renderLogs(): void
    {
        $events = $this->logger->recent(100);

        echo '<hr/>';
        echo '<h2>Last 100 Events</h2>';

        if (empty($events)) {
            echo '<p>No events recorded yet.</p>';
            return;
        }

        echo '<table class="widefat striped">';
        echo '<thead><tr><th>Timestamp (UTC)</th><th>Level</th><th>Message</th><th>Context</th></tr></thead>';
        echo '<tbody>';

        foreach ($events as $event) {
            if (!is_array($event)) {
                continue;
            }
            $context = isset($event['context']) && is_array($event['context']) ? wp_json_encode($event['context']) : '';
            echo '<tr>';
            echo '<td>' . esc_html((string)($event['ts'] ?? '')) . '</td>';
            echo '<td>' . esc_html((string)($event['level'] ?? 'info')) . '</td>';
            echo '<td>' . esc_html((string)($event['message'] ?? '')) . '</td>';
            echo '<td><code>' . esc_html((string)$context) . '</code></td>';
            echo '</tr>';
        }

        echo '</tbody>';
        echo '</table>';
    }

    private function redirectWithTab(string $tab): void
    {
        $url = admin_url('admin.php?page=webadmin-edge-agent&tab=' . rawurlencode($tab));
        wp_safe_redirect($url);
        exit;
    }

    /**
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    private function extractGoalPlanSettings(array $payload): array
    {
        $plan = [];
        if (isset($payload['plan']) && is_array($payload['plan'])) {
            $plan = $payload['plan'];
        } elseif (isset($payload['goals']) || isset($payload['tracking_plan'])) {
            $plan = $payload;
        }

        if (empty($plan)) {
            return [];
        }

        $updates = [];
        $suggested = isset($plan['suggested_plugin_settings']) && is_array($plan['suggested_plugin_settings'])
            ? $plan['suggested_plugin_settings']
            : [];

        $primary = $this->normalizeEventName((string)($suggested['analytics_primary_conversion'] ?? ''));
        if ($primary === '' && isset($plan['goals']['primary']) && is_array($plan['goals']['primary'])) {
            $primary = $this->normalizeEventName((string)($plan['goals']['primary']['event'] ?? ''));
        }
        if ($primary !== '') {
            $updates['analytics_primary_conversion'] = $primary;
        }

        $secondary = $this->normalizeEventList($suggested['analytics_secondary_conversions'] ?? []);
        if (empty($secondary) && isset($plan['goals']['secondary']) && is_array($plan['goals']['secondary'])) {
            $fallback = [];
            foreach ($plan['goals']['secondary'] as $goal) {
                if (is_array($goal) && isset($goal['event'])) {
                    $fallback[] = (string)$goal['event'];
                }
            }
            $secondary = $this->normalizeEventList($fallback);
        }
        if (!empty($secondary)) {
            $updates['analytics_secondary_conversions'] = implode("\n", $secondary);
        }

        $funnel = $this->normalizeEventList($suggested['analytics_funnel_steps'] ?? []);
        if (empty($funnel) && isset($plan['tracking_plan']['key_funnel_events']) && is_array($plan['tracking_plan']['key_funnel_events'])) {
            $funnel = $this->normalizeEventList($plan['tracking_plan']['key_funnel_events']);
        }
        if (!empty($funnel)) {
            $updates['analytics_funnel_steps'] = implode("\n", $funnel);
        }

        $keyPages = $this->normalizePageList($suggested['analytics_key_pages'] ?? []);
        if (!empty($keyPages)) {
            $updates['analytics_key_pages'] = implode("\n", $keyPages);
        }

        return $updates;
    }

    /**
     * @param mixed $value
     * @return array<int, string>
     */
    private function normalizeEventList($value): array
    {
        if (!is_array($value)) {
            return [];
        }

        $out = [];
        foreach ($value as $item) {
            $normalized = $this->normalizeEventName((string)$item);
            if ($normalized === '') {
                continue;
            }
            $out[] = $normalized;
        }

        return array_values(array_unique($out));
    }

    private function normalizeEventName(string $value): string
    {
        $normalized = strtolower(trim($value));
        $normalized = preg_replace('/[^a-z0-9_]+/', '_', $normalized);
        if (!is_string($normalized)) {
            return '';
        }
        $normalized = trim($normalized, '_');
        if ($normalized === '') {
            return '';
        }

        return sanitize_key($normalized);
    }

    /**
     * @param mixed $value
     * @return array<int, string>
     */
    private function normalizePageList($value): array
    {
        if (!is_array($value)) {
            return [];
        }

        $out = [];
        foreach ($value as $item) {
            $page = trim((string)$item);
            if ($page === '') {
                continue;
            }
            if ($page[0] !== '/') {
                $page = '/' . ltrim($page, '/');
            }
            $page = preg_replace('/[^a-zA-Z0-9\/\-_]/', '', $page);
            if (!is_string($page) || $page === '') {
                continue;
            }
            $out[] = $page;
        }

        return array_values(array_unique($out));
    }
}
