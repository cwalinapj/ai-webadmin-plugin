<?php

namespace WebAdminEdgeAgent\Storage;

class Options
{
    public const OPTION_KEY = 'webadmin_edge_agent_settings';

    public const LOG_KEY = 'webadmin_edge_agent_logs';

    /**
     * @return array<string, mixed>
     */
    public function defaults(): array
    {
        $domain = (string)parse_url(home_url(), PHP_URL_HOST);
        $timezone = wp_timezone_string();
        if ($timezone === '') {
            $timezone = 'UTC';
        }

        return [
            'worker_base_url' => '',
            'plugin_id' => '',
            'site_id' => '',
            'domain' => $domain,
            'plan' => 'free',
            'timezone' => $timezone,
            'shared_secret' => '',
            'capability_token_uptime' => '',
            'capability_token_analytics' => '',
            'last_heartbeat_at' => 0,
            'last_heartbeat_status' => 'never',
            'last_heartbeat_message' => '',
            'performance_slo_goal_guest_p95_ttfb_ms' => 300.0,
            'performance_slo_goal_error_rate_pct' => 0.1,
            'performance_slo_goal_cache_hit_pct' => 85.0,
            'performance_slo_dry_run' => 1,
            'performance_slo_last_status' => 'never',
            'performance_slo_last_message' => '',
            'performance_slo_last_at' => 0,
            'performance_slo_last_result_json' => '',
            'ga4_measurement_id' => '',
            'ga4_property_id' => '',
            'gtm_account_id' => '',
            'gtm_container_id' => '',
            'gtm_workspace_name' => 'WebAdmin Auto',
            'gsc_property_url' => '',
            'enable_gtm_snippet' => 0,
            'enable_lead_event_push' => 1,
            'analytics_primary_conversion' => 'lead_submit',
            'analytics_secondary_conversions' => "awp_form_submit",
            'analytics_funnel_steps' => '',
            'analytics_key_pages' => '',
            'analytics_goal_business_type' => '',
            'analytics_goal_objective' => '',
            'analytics_goal_channels' => '',
            'analytics_goal_form_types' => '',
            'analytics_goal_avg_value' => 0,
            'analytics_goal_last_plan_json' => '',
            'analytics_goal_last_plan_status' => 'never',
            'analytics_goal_last_plan_message' => '',
            'analytics_goal_last_plan_at' => 0,
            'analytics_google_connected' => 0,
            'analytics_google_account_email' => '',
            'analytics_google_session_id' => '',
            'analytics_google_last_status' => 'never',
            'analytics_google_last_message' => '',
            'analytics_google_last_sync_at' => 0,
            'analytics_google_last_deploy_json' => '',
            'analytics_google_last_deploy_status' => 'never',
            'analytics_google_last_deploy_message' => '',
            'analytics_google_last_deploy_at' => 0,
            'safe_updates_include_core' => 1,
            'safe_updates_include_plugins' => 1,
            'safe_updates_include_themes' => 0,
            'safe_updates_plugin_allowlist' => '',
            'safe_updates_theme_allowlist' => '',
            'safe_updates_dry_run' => 1,
            'safe_updates_last_status' => 'never',
            'safe_updates_last_message' => '',
            'safe_updates_last_at' => 0,
            'safe_updates_last_result_json' => '',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function getSettings(): array
    {
        $stored = get_option(self::OPTION_KEY, []);
        if (!is_array($stored)) {
            $stored = [];
        }

        return array_merge($this->defaults(), $stored);
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function saveSettings(array $input): array
    {
        $current = $this->getSettings();
        $enableGtmSnippet = array_key_exists('enable_gtm_snippet', $input)
            ? $this->normalizeBoolean($input['enable_gtm_snippet'])
            : (int)$current['enable_gtm_snippet'];
        $enableLeadEventPush = array_key_exists('enable_lead_event_push', $input)
            ? $this->normalizeBoolean($input['enable_lead_event_push'])
            : (int)$current['enable_lead_event_push'];

        $next = [
            'worker_base_url' => isset($input['worker_base_url']) ? esc_url_raw(trim((string)$input['worker_base_url'])) : (string)$current['worker_base_url'],
            'plugin_id' => isset($input['plugin_id']) ? sanitize_text_field(trim((string)$input['plugin_id'])) : (string)$current['plugin_id'],
            'site_id' => isset($input['site_id']) ? sanitize_text_field(trim((string)$input['site_id'])) : (string)$current['site_id'],
            'domain' => isset($input['domain']) ? sanitize_text_field(trim((string)$input['domain'])) : (string)$current['domain'],
            'plan' => isset($input['plan']) ? sanitize_text_field(trim((string)$input['plan'])) : (string)$current['plan'],
            'timezone' => isset($input['timezone']) ? sanitize_text_field(trim((string)$input['timezone'])) : (string)$current['timezone'],
            'shared_secret' => (string)$current['shared_secret'],
            'capability_token_uptime' => (string)$current['capability_token_uptime'],
            'capability_token_analytics' => (string)$current['capability_token_analytics'],
            'last_heartbeat_at' => (int)$current['last_heartbeat_at'],
            'last_heartbeat_status' => sanitize_text_field((string)$current['last_heartbeat_status']),
            'last_heartbeat_message' => sanitize_text_field((string)$current['last_heartbeat_message']),
            'performance_slo_goal_guest_p95_ttfb_ms' => isset($input['performance_slo_goal_guest_p95_ttfb_ms'])
                ? $this->normalizeFloat($input['performance_slo_goal_guest_p95_ttfb_ms'], 1, 10000, 300.0)
                : (float)$current['performance_slo_goal_guest_p95_ttfb_ms'],
            'performance_slo_goal_error_rate_pct' => isset($input['performance_slo_goal_error_rate_pct'])
                ? $this->normalizeFloat($input['performance_slo_goal_error_rate_pct'], 0.001, 100, 0.1)
                : (float)$current['performance_slo_goal_error_rate_pct'],
            'performance_slo_goal_cache_hit_pct' => isset($input['performance_slo_goal_cache_hit_pct'])
                ? $this->normalizeFloat($input['performance_slo_goal_cache_hit_pct'], 1, 100, 85.0)
                : (float)$current['performance_slo_goal_cache_hit_pct'],
            'performance_slo_dry_run' => isset($input['performance_slo_dry_run'])
                ? $this->normalizeBoolean($input['performance_slo_dry_run'])
                : (int)$current['performance_slo_dry_run'],
            'performance_slo_last_status' => isset($input['performance_slo_last_status'])
                ? sanitize_text_field((string)$input['performance_slo_last_status'])
                : (string)$current['performance_slo_last_status'],
            'performance_slo_last_message' => isset($input['performance_slo_last_message'])
                ? sanitize_text_field((string)$input['performance_slo_last_message'])
                : (string)$current['performance_slo_last_message'],
            'performance_slo_last_at' => isset($input['performance_slo_last_at'])
                ? (int)$input['performance_slo_last_at']
                : (int)$current['performance_slo_last_at'],
            'performance_slo_last_result_json' => isset($input['performance_slo_last_result_json'])
                ? sanitize_textarea_field((string)$input['performance_slo_last_result_json'])
                : (string)$current['performance_slo_last_result_json'],
            'ga4_measurement_id' => isset($input['ga4_measurement_id']) ? strtoupper(sanitize_text_field(trim((string)$input['ga4_measurement_id']))) : (string)$current['ga4_measurement_id'],
            'ga4_property_id' => isset($input['ga4_property_id']) ? sanitize_text_field(trim((string)$input['ga4_property_id'])) : (string)$current['ga4_property_id'],
            'gtm_account_id' => isset($input['gtm_account_id']) ? sanitize_text_field(trim((string)$input['gtm_account_id'])) : (string)$current['gtm_account_id'],
            'gtm_container_id' => isset($input['gtm_container_id']) ? strtoupper(sanitize_text_field(trim((string)$input['gtm_container_id']))) : (string)$current['gtm_container_id'],
            'gtm_workspace_name' => isset($input['gtm_workspace_name']) ? sanitize_text_field(trim((string)$input['gtm_workspace_name'])) : (string)$current['gtm_workspace_name'],
            'gsc_property_url' => isset($input['gsc_property_url']) ? esc_url_raw(trim((string)$input['gsc_property_url'])) : (string)$current['gsc_property_url'],
            'enable_gtm_snippet' => $enableGtmSnippet,
            'enable_lead_event_push' => $enableLeadEventPush,
            'analytics_primary_conversion' => isset($input['analytics_primary_conversion']) ? sanitize_text_field(trim((string)$input['analytics_primary_conversion'])) : (string)$current['analytics_primary_conversion'],
            'analytics_secondary_conversions' => isset($input['analytics_secondary_conversions']) ? sanitize_textarea_field((string)$input['analytics_secondary_conversions']) : (string)$current['analytics_secondary_conversions'],
            'analytics_funnel_steps' => isset($input['analytics_funnel_steps']) ? sanitize_textarea_field((string)$input['analytics_funnel_steps']) : (string)$current['analytics_funnel_steps'],
            'analytics_key_pages' => isset($input['analytics_key_pages']) ? sanitize_textarea_field((string)$input['analytics_key_pages']) : (string)$current['analytics_key_pages'],
            'analytics_goal_business_type' => isset($input['analytics_goal_business_type']) ? sanitize_text_field(trim((string)$input['analytics_goal_business_type'])) : (string)$current['analytics_goal_business_type'],
            'analytics_goal_objective' => isset($input['analytics_goal_objective']) ? sanitize_text_field(trim((string)$input['analytics_goal_objective'])) : (string)$current['analytics_goal_objective'],
            'analytics_goal_channels' => isset($input['analytics_goal_channels']) ? sanitize_textarea_field((string)$input['analytics_goal_channels']) : (string)$current['analytics_goal_channels'],
            'analytics_goal_form_types' => isset($input['analytics_goal_form_types']) ? sanitize_textarea_field((string)$input['analytics_goal_form_types']) : (string)$current['analytics_goal_form_types'],
            'analytics_goal_avg_value' => isset($input['analytics_goal_avg_value']) ? max(0, (float)$input['analytics_goal_avg_value']) : (float)$current['analytics_goal_avg_value'],
            'analytics_goal_last_plan_json' => isset($input['analytics_goal_last_plan_json']) ? sanitize_textarea_field((string)$input['analytics_goal_last_plan_json']) : (string)$current['analytics_goal_last_plan_json'],
            'analytics_goal_last_plan_status' => isset($input['analytics_goal_last_plan_status']) ? sanitize_text_field((string)$input['analytics_goal_last_plan_status']) : (string)$current['analytics_goal_last_plan_status'],
            'analytics_goal_last_plan_message' => isset($input['analytics_goal_last_plan_message']) ? sanitize_text_field((string)$input['analytics_goal_last_plan_message']) : (string)$current['analytics_goal_last_plan_message'],
            'analytics_goal_last_plan_at' => isset($input['analytics_goal_last_plan_at']) ? (int)$input['analytics_goal_last_plan_at'] : (int)$current['analytics_goal_last_plan_at'],
            'analytics_google_connected' => isset($input['analytics_google_connected']) ? $this->normalizeBoolean($input['analytics_google_connected']) : (int)$current['analytics_google_connected'],
            'analytics_google_account_email' => isset($input['analytics_google_account_email']) ? sanitize_email((string)$input['analytics_google_account_email']) : (string)$current['analytics_google_account_email'],
            'analytics_google_session_id' => isset($input['analytics_google_session_id']) ? sanitize_text_field((string)$input['analytics_google_session_id']) : (string)$current['analytics_google_session_id'],
            'analytics_google_last_status' => isset($input['analytics_google_last_status']) ? sanitize_text_field((string)$input['analytics_google_last_status']) : (string)$current['analytics_google_last_status'],
            'analytics_google_last_message' => isset($input['analytics_google_last_message']) ? sanitize_text_field((string)$input['analytics_google_last_message']) : (string)$current['analytics_google_last_message'],
            'analytics_google_last_sync_at' => isset($input['analytics_google_last_sync_at']) ? (int)$input['analytics_google_last_sync_at'] : (int)$current['analytics_google_last_sync_at'],
            'analytics_google_last_deploy_json' => isset($input['analytics_google_last_deploy_json']) ? sanitize_textarea_field((string)$input['analytics_google_last_deploy_json']) : (string)$current['analytics_google_last_deploy_json'],
            'analytics_google_last_deploy_status' => isset($input['analytics_google_last_deploy_status']) ? sanitize_text_field((string)$input['analytics_google_last_deploy_status']) : (string)$current['analytics_google_last_deploy_status'],
            'analytics_google_last_deploy_message' => isset($input['analytics_google_last_deploy_message']) ? sanitize_text_field((string)$input['analytics_google_last_deploy_message']) : (string)$current['analytics_google_last_deploy_message'],
            'analytics_google_last_deploy_at' => isset($input['analytics_google_last_deploy_at']) ? (int)$input['analytics_google_last_deploy_at'] : (int)$current['analytics_google_last_deploy_at'],
            'safe_updates_include_core' => isset($input['safe_updates_include_core'])
                ? $this->normalizeBoolean($input['safe_updates_include_core'])
                : (int)$current['safe_updates_include_core'],
            'safe_updates_include_plugins' => isset($input['safe_updates_include_plugins'])
                ? $this->normalizeBoolean($input['safe_updates_include_plugins'])
                : (int)$current['safe_updates_include_plugins'],
            'safe_updates_include_themes' => isset($input['safe_updates_include_themes'])
                ? $this->normalizeBoolean($input['safe_updates_include_themes'])
                : (int)$current['safe_updates_include_themes'],
            'safe_updates_plugin_allowlist' => isset($input['safe_updates_plugin_allowlist'])
                ? sanitize_textarea_field((string)$input['safe_updates_plugin_allowlist'])
                : (string)$current['safe_updates_plugin_allowlist'],
            'safe_updates_theme_allowlist' => isset($input['safe_updates_theme_allowlist'])
                ? sanitize_textarea_field((string)$input['safe_updates_theme_allowlist'])
                : (string)$current['safe_updates_theme_allowlist'],
            'safe_updates_dry_run' => isset($input['safe_updates_dry_run'])
                ? $this->normalizeBoolean($input['safe_updates_dry_run'])
                : (int)$current['safe_updates_dry_run'],
            'safe_updates_last_status' => isset($input['safe_updates_last_status'])
                ? sanitize_text_field((string)$input['safe_updates_last_status'])
                : (string)$current['safe_updates_last_status'],
            'safe_updates_last_message' => isset($input['safe_updates_last_message'])
                ? sanitize_text_field((string)$input['safe_updates_last_message'])
                : (string)$current['safe_updates_last_message'],
            'safe_updates_last_at' => isset($input['safe_updates_last_at'])
                ? (int)$input['safe_updates_last_at']
                : (int)$current['safe_updates_last_at'],
            'safe_updates_last_result_json' => isset($input['safe_updates_last_result_json'])
                ? sanitize_textarea_field((string)$input['safe_updates_last_result_json'])
                : (string)$current['safe_updates_last_result_json'],
        ];

        if (isset($input['shared_secret']) && trim((string)$input['shared_secret']) !== '') {
            $next['shared_secret'] = $this->encryptSecret((string)$input['shared_secret']);
        }

        if (isset($input['capability_token_uptime']) && trim((string)$input['capability_token_uptime']) !== '') {
            $next['capability_token_uptime'] = $this->encryptSecret((string)$input['capability_token_uptime']);
        }

        if (isset($input['capability_token_analytics']) && trim((string)$input['capability_token_analytics']) !== '') {
            $next['capability_token_analytics'] = $this->encryptSecret((string)$input['capability_token_analytics']);
        }

        update_option(self::OPTION_KEY, $next, false);

        return $next;
    }

    /**
     * @return array<string, mixed>
     */
    public function updateHeartbeatStatus(string $status, string $message): array
    {
        $settings = $this->getSettings();
        $settings['last_heartbeat_at'] = time();
        $settings['last_heartbeat_status'] = sanitize_text_field($status);
        $settings['last_heartbeat_message'] = sanitize_text_field($message);

        update_option(self::OPTION_KEY, $settings, false);

        return $settings;
    }

    public function getDecryptedSecret(string $key): string
    {
        $settings = $this->getSettings();
        $raw = (string)($settings[$key] ?? '');
        if ($raw === '') {
            return '';
        }

        return $this->decryptSecret($raw);
    }

    public function hasSecret(string $key): bool
    {
        $settings = $this->getSettings();

        return !empty($settings[$key]);
    }

    private function encryptSecret(string $plaintext): string
    {
        $value = trim($plaintext);
        if ($value === '') {
            return '';
        }

        $key = $this->encryptionKey();
        if ($key === null || !function_exists('openssl_encrypt')) {
            return 'plain:v1:' . base64_encode($value);
        }

        try {
            $iv = random_bytes(16);
        } catch (\Throwable $exception) {
            return 'plain:v1:' . base64_encode($value);
        }

        $ciphertext = openssl_encrypt($value, 'aes-256-cbc', $key, OPENSSL_RAW_DATA, $iv);
        if (!is_string($ciphertext) || $ciphertext === '') {
            return 'plain:v1:' . base64_encode($value);
        }

        return 'enc:v1:' . base64_encode($iv) . ':' . base64_encode($ciphertext);
    }

    private function decryptSecret(string $stored): string
    {
        if (strpos($stored, 'enc:v1:') === 0) {
            $parts = explode(':', $stored);
            if (count($parts) !== 4) {
                return '';
            }

            $key = $this->encryptionKey();
            if ($key === null || !function_exists('openssl_decrypt')) {
                return '';
            }

            $iv = base64_decode((string)$parts[2], true);
            $ciphertext = base64_decode((string)$parts[3], true);
            if (!is_string($iv) || !is_string($ciphertext) || strlen($iv) !== 16) {
                return '';
            }

            $plaintext = openssl_decrypt($ciphertext, 'aes-256-cbc', $key, OPENSSL_RAW_DATA, $iv);
            if (!is_string($plaintext)) {
                return '';
            }

            return $plaintext;
        }

        if (strpos($stored, 'plain:v1:') === 0) {
            $decoded = base64_decode(substr($stored, 9), true);
            if (is_string($decoded)) {
                return $decoded;
            }
        }

        return '';
    }

    private function encryptionKey(): ?string
    {
        $material = '';
        $constants = ['AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY'];
        foreach ($constants as $constant) {
            if (defined($constant)) {
                $material .= (string)constant($constant);
            }
        }

        if ($material === '') {
            return null;
        }

        return hash('sha256', $material, true);
    }

    /**
     * @param mixed $value
     */
    private function normalizeBoolean($value): int
    {
        if (is_bool($value)) {
            return $value ? 1 : 0;
        }

        $normalized = strtolower(trim((string)$value));

        return in_array($normalized, ['1', 'true', 'yes', 'on'], true) ? 1 : 0;
    }

    /**
     * @param mixed $value
     */
    private function normalizeFloat($value, float $min, float $max, float $fallback): float
    {
        if (!is_numeric($value)) {
            return $fallback;
        }
        $parsed = (float)$value;
        if (!is_finite($parsed)) {
            return $fallback;
        }

        return max($min, min($max, $parsed));
    }
}
