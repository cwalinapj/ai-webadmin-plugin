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
use WebAdminEdgeAgent\Api\Endpoints\PerformanceSlo;
use WebAdminEdgeAgent\Api\Endpoints\SafeUpdates;
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

    private PerformanceSlo $performanceSlo;

    private SafeUpdates $safeUpdates;

    private TabState $tabState;

    private JobStore $jobStore;

    public function __construct(
        Options $options,
        Logger $logger,
        Heartbeat $heartbeat,
        AnalyticsGoogle $analyticsGoogle,
        AnalyticsGoalsAssistant $analyticsGoalsAssistant,
        PerformanceSlo $performanceSlo,
        SafeUpdates $safeUpdates,
        TabState $tabState,
        JobStore $jobStore
    ) {
        $this->options = $options;
        $this->logger = $logger;
        $this->heartbeat = $heartbeat;
        $this->analyticsGoogle = $analyticsGoogle;
        $this->analyticsGoalsAssistant = $analyticsGoalsAssistant;
        $this->performanceSlo = $performanceSlo;
        $this->safeUpdates = $safeUpdates;
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
        add_action('admin_post_webadmin_edge_agent_save_slo_settings', [$this, 'handleSaveSloSettings']);
        add_action('admin_post_webadmin_edge_agent_run_slo_evaluation', [$this, 'handleRunSloEvaluation']);
        add_action('admin_post_webadmin_edge_agent_send_heartbeat', [$this, 'handleSendHeartbeat']);
        add_action('admin_post_webadmin_edge_agent_run_safe_update_workflow', [$this, 'handleRunSafeUpdateWorkflow']);
        add_action('admin_post_webadmin_edge_agent_start_google_connect', [$this, 'handleStartGoogleConnect']);
        add_action('admin_post_webadmin_edge_agent_refresh_google_status', [$this, 'handleRefreshGoogleStatus']);
        add_action('admin_post_webadmin_edge_agent_deploy_google_analytics', [$this, 'handleDeployGoogleAnalytics']);
        add_action('admin_post_webadmin_edge_agent_run_tab_sync', [$this, 'handleRunTabSync']);
        add_action('admin_post_webadmin_edge_agent_export_support_bundle', [$this, 'handleExportSupportBundle']);
        add_action('admin_post_webadmin_edge_agent_export_logs_json', [$this, 'handleExportLogsJson']);
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

        add_submenu_page(
            'webadmin-edge-agent',
            'WebAdmin Logs',
            'Logs',
            'manage_options',
            'webadmin-edge-agent-logs',
            [$this, 'renderLogsPage']
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

    public function handleSaveSloSettings(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Unauthorized', 'webadmin-edge-agent'));
        }

        check_admin_referer('webadmin_edge_agent_save_slo_settings', 'webadmin_edge_agent_slo_settings_nonce');

        $input = [
            'performance_slo_goal_guest_p95_ttfb_ms' => isset($_POST['performance_slo_goal_guest_p95_ttfb_ms']) ? wp_unslash($_POST['performance_slo_goal_guest_p95_ttfb_ms']) : '',
            'performance_slo_goal_error_rate_pct' => isset($_POST['performance_slo_goal_error_rate_pct']) ? wp_unslash($_POST['performance_slo_goal_error_rate_pct']) : '',
            'performance_slo_goal_cache_hit_pct' => isset($_POST['performance_slo_goal_cache_hit_pct']) ? wp_unslash($_POST['performance_slo_goal_cache_hit_pct']) : '',
            'performance_slo_dry_run' => isset($_POST['performance_slo_dry_run']) ? wp_unslash($_POST['performance_slo_dry_run']) : '0',
        ];

        $this->options->saveSettings($input);
        $this->logger->log('info', 'Performance SLO settings updated');
        add_settings_error('webadmin-edge-agent', 'slo-settings-saved', 'Performance SLO settings saved.', 'updated');

        $this->redirectWithTab('uptime');
    }

    public function handleRunSloEvaluation(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Unauthorized', 'webadmin-edge-agent'));
        }

        check_admin_referer('webadmin_edge_agent_run_slo_evaluation', 'webadmin_edge_agent_slo_run_nonce');

        $response = $this->performanceSlo->evaluate('manual');
        if (!empty($response['ok'])) {
            add_settings_error('webadmin-edge-agent', 'slo-run-ok', 'Performance SLO evaluation completed.', 'updated');
        } else {
            $message = 'Performance SLO evaluation failed.';
            if (!empty($response['error'])) {
                $message .= ' ' . sanitize_text_field((string)$response['error']);
            }
            add_settings_error('webadmin-edge-agent', 'slo-run-error', $message, 'error');
        }

        $this->redirectWithTab('uptime');
    }

    public function handleRunSafeUpdateWorkflow(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Unauthorized', 'webadmin-edge-agent'));
        }

        check_admin_referer('webadmin_edge_agent_run_safe_update_workflow', 'webadmin_edge_agent_safe_update_nonce');

        $input = [
            'safe_updates_include_core' => isset($_POST['safe_updates_include_core']) ? wp_unslash($_POST['safe_updates_include_core']) : '0',
            'safe_updates_include_plugins' => isset($_POST['safe_updates_include_plugins']) ? wp_unslash($_POST['safe_updates_include_plugins']) : '0',
            'safe_updates_include_themes' => isset($_POST['safe_updates_include_themes']) ? wp_unslash($_POST['safe_updates_include_themes']) : '0',
            'safe_updates_plugin_allowlist' => isset($_POST['safe_updates_plugin_allowlist']) ? wp_unslash($_POST['safe_updates_plugin_allowlist']) : '',
            'safe_updates_theme_allowlist' => isset($_POST['safe_updates_theme_allowlist']) ? wp_unslash($_POST['safe_updates_theme_allowlist']) : '',
            'safe_updates_dry_run' => isset($_POST['safe_updates_dry_run']) ? wp_unslash($_POST['safe_updates_dry_run']) : '0',
        ];
        $this->options->saveSettings($input);

        $response = $this->safeUpdates->run('manual');
        if (!empty($response['ok'])) {
            add_settings_error('webadmin-edge-agent', 'safe-update-run-ok', 'Safe updates workflow planned.', 'updated');
        } else {
            $message = 'Safe updates workflow failed.';
            if (!empty($response['error'])) {
                $message .= ' ' . sanitize_text_field((string)$response['error']);
            }
            add_settings_error('webadmin-edge-agent', 'safe-update-run-error', $message, 'error');
        }

        $this->redirectWithTab('security');
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
            wp_safe_redirect(esc_url_raw((string)$response['body']['auth_url']));
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

    public function handleExportSupportBundle(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Unauthorized', 'webadmin-edge-agent'));
        }

        check_admin_referer('webadmin_edge_agent_export_support_bundle', 'webadmin_edge_agent_export_support_bundle_nonce');

        $tab = isset($_POST['tab']) ? sanitize_key((string)wp_unslash($_POST['tab'])) : 'uptime';
        $archivePath = $this->buildSupportBundleArchive();
        if (is_wp_error($archivePath)) {
            $this->logger->log('error', 'Support bundle export failed', [
                'reason' => (string)$archivePath->get_error_message(),
            ]);
            add_settings_error(
                'webadmin-edge-agent',
                'support-bundle-error',
                'Support bundle export failed: ' . $archivePath->get_error_message(),
                'error'
            );
            $this->redirectWithTab($tab);
        }

        $filename = sprintf('webadmin-edge-agent-support-bundle-%s.zip', gmdate('Ymd-His'));
        $contentLength = filesize($archivePath);
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        if ($contentLength !== false) {
            header('Content-Length: ' . (string)$contentLength);
        }
        header('X-Content-Type-Options: nosniff');
        readfile($archivePath);
        @unlink($archivePath);

        $this->logger->log('info', 'Support bundle exported', [
            'filename' => $filename,
        ]);

        exit;
    }

    public function handleExportLogsJson(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Unauthorized', 'webadmin-edge-agent'));
        }

        check_admin_referer('webadmin_edge_agent_export_logs_json', 'webadmin_edge_agent_export_logs_json_nonce');

        $level = isset($_POST['level']) ? sanitize_key((string)wp_unslash($_POST['level'])) : '';
        $search = isset($_POST['search']) ? sanitize_text_field((string)wp_unslash($_POST['search'])) : '';
        $limit = isset($_POST['limit']) ? max(1, (int)wp_unslash($_POST['limit'])) : 500;

        $json = $this->logger->exportJson($level, $search, $limit);
        $filename = sprintf('webadmin-edge-agent-logs-%s.json', gmdate('Ymd-His'));

        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('X-Content-Type-Options: nosniff');
        echo $json; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped

        $this->logger->log('info', 'Logs exported as JSON', [
            'filename' => $filename,
            'level' => $level,
            'limit' => (string)$limit,
        ]);

        exit;
    }

    public function renderLogsPage(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }

        $level = isset($_GET['level']) ? sanitize_key((string)wp_unslash($_GET['level'])) : '';
        $search = isset($_GET['s']) ? sanitize_text_field((string)wp_unslash($_GET['s'])) : '';
        $limit = isset($_GET['limit']) ? max(1, (int)wp_unslash($_GET['limit'])) : 200;
        $events = $this->logger->recent($limit, $level, $search);

        settings_errors('webadmin-edge-agent');

        echo '<div class="wrap webadmin-edge-agent">';
        echo '<h1>WebAdmin Edge Agent Logs</h1>';

        echo '<form method="get" action="' . esc_url(admin_url('admin.php')) . '" style="margin-bottom:12px;">';
        echo '<input type="hidden" name="page" value="webadmin-edge-agent-logs" />';
        echo '<label for="webadmin-edge-agent-log-level"><strong>Severity</strong></label> ';
        echo '<select id="webadmin-edge-agent-log-level" name="level">';
        echo '<option value=""' . selected($level, '', false) . '>All</option>';
        echo '<option value="info"' . selected($level, 'info', false) . '>Info</option>';
        echo '<option value="warning"' . selected($level, 'warning', false) . '>Warning</option>';
        echo '<option value="error"' . selected($level, 'error', false) . '>Error</option>';
        echo '</select> ';
        echo '<label for="webadmin-edge-agent-log-search"><strong>Search</strong></label> ';
        echo '<input id="webadmin-edge-agent-log-search" type="search" name="s" value="' . esc_attr($search) . '" placeholder="event, request_id, job_id" /> ';
        echo '<label for="webadmin-edge-agent-log-limit"><strong>Limit</strong></label> ';
        echo '<input id="webadmin-edge-agent-log-limit" type="number" min="1" max="1000" name="limit" value="' . esc_attr((string)$limit) . '" style="width:90px;" /> ';
        echo '<button type="submit" class="button">Filter</button>';
        echo '</form>';

        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="margin-bottom:16px;">';
        wp_nonce_field('webadmin_edge_agent_export_logs_json', 'webadmin_edge_agent_export_logs_json_nonce');
        echo '<input type="hidden" name="action" value="webadmin_edge_agent_export_logs_json" />';
        echo '<input type="hidden" name="level" value="' . esc_attr($level) . '" />';
        echo '<input type="hidden" name="search" value="' . esc_attr($search) . '" />';
        echo '<input type="hidden" name="limit" value="' . esc_attr((string)$limit) . '" />';
        echo '<button type="submit" class="button button-secondary">Export Filtered JSON</button> ';
        echo '<a href="' . esc_url(admin_url('admin.php?page=webadmin-edge-agent')) . '" class="button">Back to Dashboard</a>';
        echo '</form>';

        if (empty($events)) {
            echo '<p>No events match the current filter.</p>';
            echo '</div>';
            return;
        }

        echo '<table class="widefat striped">';
        echo '<thead><tr><th>Timestamp (UTC)</th><th>Level</th><th>Event</th><th>Request ID</th><th>Job ID</th><th>Context</th></tr></thead>';
        echo '<tbody>';
        foreach ($events as $event) {
            if (!is_array($event)) {
                continue;
            }
            $context = isset($event['context']) && is_array($event['context']) ? wp_json_encode($event['context']) : '';
            echo '<tr>';
            echo '<td>' . esc_html((string)($event['ts'] ?? '')) . '</td>';
            echo '<td>' . esc_html((string)($event['level'] ?? 'info')) . '</td>';
            echo '<td>' . esc_html((string)($event['event'] ?? ($event['message'] ?? ''))) . '</td>';
            echo '<td><code>' . esc_html((string)($event['request_id'] ?? '')) . '</code></td>';
            echo '<td><code>' . esc_html((string)($event['job_id'] ?? '')) . '</code></td>';
            echo '<td><code>' . esc_html((string)$context) . '</code></td>';
            echo '</tr>';
        }
        echo '</tbody>';
        echo '</table>';
        echo '</div>';
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
        $this->renderSupportActions($currentTab);
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
            $tabObject->render([
                'settings' => $settings,
            ]);
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

        if ($tab === 'security') {
            $response = $this->safeUpdates->run('manual_run');
            if (!empty($response['ok'])) {
                add_settings_error('webadmin-edge-agent', 'tab-run-ok', 'Run now completed for Security.', 'updated');
            } else {
                add_settings_error('webadmin-edge-agent', 'tab-run-error', 'Run now failed for Security.', 'error');
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
        echo '<p><a href="' . esc_url(admin_url('admin.php?page=webadmin-edge-agent-logs')) . '" class="button button-secondary">Open Full Logs</a></p>';

        if (empty($events)) {
            echo '<p>No events recorded yet.</p>';
            return;
        }

        echo '<table class="widefat striped">';
        echo '<thead><tr><th>Timestamp (UTC)</th><th>Level</th><th>Event</th><th>Request ID</th><th>Job ID</th><th>Context</th></tr></thead>';
        echo '<tbody>';

        foreach ($events as $event) {
            if (!is_array($event)) {
                continue;
            }
            $context = isset($event['context']) && is_array($event['context']) ? wp_json_encode($event['context']) : '';
            echo '<tr>';
            echo '<td>' . esc_html((string)($event['ts'] ?? '')) . '</td>';
            echo '<td>' . esc_html((string)($event['level'] ?? 'info')) . '</td>';
            echo '<td>' . esc_html((string)($event['event'] ?? ($event['message'] ?? ''))) . '</td>';
            echo '<td><code>' . esc_html((string)($event['request_id'] ?? '')) . '</code></td>';
            echo '<td><code>' . esc_html((string)($event['job_id'] ?? '')) . '</code></td>';
            echo '<td><code>' . esc_html((string)$context) . '</code></td>';
            echo '</tr>';
        }

        echo '</tbody>';
        echo '</table>';
    }

    private function renderSupportActions(string $tab): void
    {
        echo '<div style="display:flex;gap:8px;align-items:center;margin:12px 0 16px;">';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="margin:0;">';
        wp_nonce_field('webadmin_edge_agent_export_support_bundle', 'webadmin_edge_agent_export_support_bundle_nonce');
        echo '<input type="hidden" name="action" value="webadmin_edge_agent_export_support_bundle" />';
        echo '<input type="hidden" name="tab" value="' . esc_attr($tab) . '" />';
        echo '<button type="submit" class="button button-primary">Download Support Bundle</button>';
        echo '</form>';
        echo '<a href="' . esc_url(admin_url('admin.php?page=webadmin-edge-agent-logs')) . '" class="button">Open Logs</a>';
        echo '</div>';
    }

    /**
     * @return string|\WP_Error
     */
    private function buildSupportBundleArchive()
    {
        if (!class_exists('\ZipArchive')) {
            return new \WP_Error('ziparchive_missing', 'PHP ZipArchive extension is required to export support bundles.');
        }

        $settings = $this->options->getSettings();
        $redactedSettings = $this->redactedSettings($settings);
        $jobs = $this->jobStore->recent(20);
        $siteInventory = $this->siteInventory();

        $files = [
            'manifest.json' => wp_json_encode([
                'generated_at' => gmdate('c'),
                'plugin' => 'webadmin-edge-agent',
                'sections' => [
                    'settings/redacted-settings.json',
                    'environment/site-inventory.json',
                    'logs/recent-500.json',
                    'jobs/recent-20.json',
                    'state/performance-slo-last-result.json',
                    'state/safe-updates-last-result.json',
                    'state/analytics-google-last-deploy.json',
                ],
            ], JSON_PRETTY_PRINT),
            'settings/redacted-settings.json' => wp_json_encode($redactedSettings, JSON_PRETTY_PRINT),
            'environment/site-inventory.json' => wp_json_encode($siteInventory, JSON_PRETTY_PRINT),
            'logs/recent-500.json' => $this->logger->exportJson('', '', 500),
            'jobs/recent-20.json' => wp_json_encode([
                'generated_at' => gmdate('c'),
                'count' => count($jobs),
                'jobs' => $jobs,
            ], JSON_PRETTY_PRINT),
            'state/performance-slo-last-result.json' => wp_json_encode($this->decodeJsonOrRaw((string)($settings['performance_slo_last_result_json'] ?? '')), JSON_PRETTY_PRINT),
            'state/safe-updates-last-result.json' => wp_json_encode($this->decodeJsonOrRaw((string)($settings['safe_updates_last_result_json'] ?? '')), JSON_PRETTY_PRINT),
            'state/analytics-google-last-deploy.json' => wp_json_encode($this->decodeJsonOrRaw((string)($settings['analytics_google_last_deploy_json'] ?? '')), JSON_PRETTY_PRINT),
        ];

        $tmpZip = wp_tempnam('webadmin-edge-agent-support-bundle');
        if (!is_string($tmpZip) || $tmpZip === '') {
            return new \WP_Error('tmpzip_failed', 'Could not allocate a temporary file for support bundle export.');
        }

        $zip = new \ZipArchive();
        $openResult = $zip->open($tmpZip, \ZipArchive::CREATE | \ZipArchive::OVERWRITE);
        if ($openResult !== true) {
            @unlink($tmpZip);
            return new \WP_Error('zip_open_failed', 'Could not open support bundle archive for writing.');
        }

        foreach ($files as $path => $content) {
            $normalized = is_string($content) ? $content : '{"ok":false,"error":"bundle_content_encode_failed"}';
            $zip->addFromString($path, $normalized);
        }

        $zip->close();

        return $tmpZip;
    }

    /**
     * @param array<string, mixed> $settings
     * @return array<string, mixed>
     */
    private function redactedSettings(array $settings): array
    {
        $redacted = [];
        foreach ($settings as $key => $value) {
            $normalizedKey = (string)$key;
            if ($this->isSensitiveSettingKey($normalizedKey)) {
                $redacted[$normalizedKey] = $value === '' ? '' : '[redacted]';
                continue;
            }

            if (is_array($value)) {
                $redacted[$normalizedKey] = wp_json_encode($value);
                continue;
            }

            $redacted[$normalizedKey] = is_scalar($value) ? (string)$value : '';
        }

        return $redacted;
    }

    private function isSensitiveSettingKey(string $key): bool
    {
        $sensitive = [
            'shared_secret',
            'capability_token_uptime',
            'capability_token_analytics',
            'analytics_google_session_id',
        ];
        if (in_array($key, $sensitive, true)) {
            return true;
        }

        return strpos($key, 'secret') !== false
            || strpos($key, 'token') !== false
            || strpos($key, 'session') !== false;
    }

    /**
     * @return array<string, mixed>
     */
    private function siteInventory(): array
    {
        if (!function_exists('get_plugins')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }

        $allPlugins = function_exists('get_plugins') ? get_plugins() : [];
        $activePluginFiles = get_option('active_plugins', []);
        if (!is_array($activePluginFiles)) {
            $activePluginFiles = [];
        }

        $activePlugins = [];
        foreach ($activePluginFiles as $pluginFile) {
            $pluginPath = (string)$pluginFile;
            $meta = isset($allPlugins[$pluginPath]) && is_array($allPlugins[$pluginPath]) ? $allPlugins[$pluginPath] : [];
            $activePlugins[] = [
                'plugin' => $pluginPath,
                'name' => isset($meta['Name']) ? (string)$meta['Name'] : $pluginPath,
                'version' => isset($meta['Version']) ? (string)$meta['Version'] : '',
            ];
        }

        $themes = wp_get_themes();
        $themeRows = [];
        foreach ($themes as $stylesheet => $theme) {
            $themeRows[] = [
                'stylesheet' => (string)$stylesheet,
                'name' => (string)$theme->get('Name'),
                'version' => (string)$theme->get('Version'),
                'status' => $theme->is_allowed() ? 'allowed' : 'blocked',
                'active' => wp_get_theme()->get_stylesheet() === $stylesheet,
            ];
        }

        return [
            'generated_at' => gmdate('c'),
            'site_url' => home_url('/'),
            'home_url' => home_url('/'),
            'wp_version' => get_bloginfo('version'),
            'php_version' => PHP_VERSION,
            'active_theme' => [
                'stylesheet' => wp_get_theme()->get_stylesheet(),
                'name' => wp_get_theme()->get('Name'),
                'version' => wp_get_theme()->get('Version'),
            ],
            'active_plugins_count' => count($activePlugins),
            'active_plugins' => $activePlugins,
            'themes' => $themeRows,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeJsonOrRaw(string $value): array
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return [
                'present' => false,
                'value' => null,
            ];
        }

        $decoded = json_decode($trimmed, true);
        if (is_array($decoded)) {
            return [
                'present' => true,
                'value' => $decoded,
            ];
        }

        return [
            'present' => true,
            'value' => null,
            'raw' => $trimmed,
            'parse_error' => 'invalid_json',
        ];
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
