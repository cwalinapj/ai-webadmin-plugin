<?php
/**
 * Plugin Name: AI AddWords + Meta Paid Traffic Plugin
 * Description: Orchestrates AI creative tools, split-testing, CPA optimization, and Web3 settlement hooks for paid traffic.
 * Version: 0.1.0
 * Author: Sitebuilder
 * License: GPLv2 or later
 */

if (!defined('ABSPATH')) {
    exit;
}

define('AI_ADDWORDS_META_OPTION_KEY', 'ai_addwords_meta_settings');
define('AI_ADDWORDS_META_LOG_OPTION_KEY', 'ai_addwords_meta_logs');
define('AI_ADDWORDS_META_LAST_REPORT_OPTION_KEY', 'ai_addwords_meta_last_report');
define('AI_ADDWORDS_META_CRON_HOOK', 'ai_addwords_meta_optimize_cron');

function ai_addwords_meta_default_settings(): array
{
    return [
        'enabled' => 1,
        'dry_run' => 1,
        'owner_name' => '',
        'target_cpa_usd' => '45.00',
        'min_conversions_for_decision' => 3,
        'scale_when_under_target_percent' => 15,
        'pause_when_over_target_percent' => 20,
        'scale_budget_percent' => 20,
        'max_daily_spend_usd' => '500.00',
        'cron_interval_minutes' => 15,
        'adwords_api_base' => '',
        'adwords_api_token' => '',
        'meta_api_base' => '',
        'meta_api_token' => '',
        'creatify_api_base' => '',
        'creatify_api_key' => '',
        'typecast_api_base' => '',
        'typecast_api_key' => '',
        'adcreative_api_base' => '',
        'adcreative_api_key' => '',
        'landbot_api_base' => '',
        'landbot_api_key' => '',
        'adamigo_api_base' => '',
        'adamigo_api_key' => '',
        'web3_enabled' => 0,
        'web3_network' => 'solana',
        'web3_settlement_webhook' => '',
        'web3_signing_secret' => '',
        'web3_treasury_wallet' => '',
        'spl_token_mint' => '',
        'spl_burn_percent' => 50,
        'log_retention' => 200,
    ];
}

function ai_addwords_meta_get_settings(): array
{
    $defaults = ai_addwords_meta_default_settings();
    $stored = get_option(AI_ADDWORDS_META_OPTION_KEY, []);
    if (!is_array($stored)) {
        $stored = [];
    }
    return array_merge($defaults, $stored);
}

function ai_addwords_meta_sanitize_interval($value): int
{
    $allowed = [5, 15, 30, 60];
    $interval = (int) $value;
    if (!in_array($interval, $allowed, true)) {
        return 15;
    }
    return $interval;
}

function ai_addwords_meta_sanitize_percent($value, int $fallback, int $min = 0, int $max = 100): int
{
    $numeric = (int) $value;
    if ($numeric < $min || $numeric > $max) {
        return $fallback;
    }
    return $numeric;
}

function ai_addwords_meta_sanitize_money($value, string $fallback): string
{
    $raw = trim((string) $value);
    if ($raw === '') {
        return $fallback;
    }
    $normalized = preg_replace('/[^0-9.]+/', '', $raw);
    if ($normalized === '' || !is_numeric($normalized)) {
        return $fallback;
    }
    return number_format((float) $normalized, 2, '.', '');
}

function ai_addwords_meta_sanitize_settings($input): array
{
    if (!is_array($input)) {
        $input = [];
    }

    $current = ai_addwords_meta_get_settings();

    $output = [
        'enabled' => !empty($input['enabled']) ? 1 : 0,
        'dry_run' => !empty($input['dry_run']) ? 1 : 0,
        'owner_name' => isset($input['owner_name']) ? sanitize_text_field((string) $input['owner_name']) : (string) $current['owner_name'],
        'target_cpa_usd' => isset($input['target_cpa_usd']) ? ai_addwords_meta_sanitize_money($input['target_cpa_usd'], (string) $current['target_cpa_usd']) : (string) $current['target_cpa_usd'],
        'min_conversions_for_decision' => isset($input['min_conversions_for_decision']) ? max(1, min(100, (int) $input['min_conversions_for_decision'])) : (int) $current['min_conversions_for_decision'],
        'scale_when_under_target_percent' => isset($input['scale_when_under_target_percent']) ? ai_addwords_meta_sanitize_percent($input['scale_when_under_target_percent'], (int) $current['scale_when_under_target_percent']) : (int) $current['scale_when_under_target_percent'],
        'pause_when_over_target_percent' => isset($input['pause_when_over_target_percent']) ? ai_addwords_meta_sanitize_percent($input['pause_when_over_target_percent'], (int) $current['pause_when_over_target_percent']) : (int) $current['pause_when_over_target_percent'],
        'scale_budget_percent' => isset($input['scale_budget_percent']) ? ai_addwords_meta_sanitize_percent($input['scale_budget_percent'], (int) $current['scale_budget_percent'], 1, 200) : (int) $current['scale_budget_percent'],
        'max_daily_spend_usd' => isset($input['max_daily_spend_usd']) ? ai_addwords_meta_sanitize_money($input['max_daily_spend_usd'], (string) $current['max_daily_spend_usd']) : (string) $current['max_daily_spend_usd'],
        'cron_interval_minutes' => isset($input['cron_interval_minutes']) ? ai_addwords_meta_sanitize_interval($input['cron_interval_minutes']) : (int) $current['cron_interval_minutes'],
        'adwords_api_base' => isset($input['adwords_api_base']) ? esc_url_raw(trim((string) $input['adwords_api_base'])) : (string) $current['adwords_api_base'],
        'adwords_api_token' => isset($input['adwords_api_token']) ? trim((string) wp_unslash($input['adwords_api_token'])) : (string) $current['adwords_api_token'],
        'meta_api_base' => isset($input['meta_api_base']) ? esc_url_raw(trim((string) $input['meta_api_base'])) : (string) $current['meta_api_base'],
        'meta_api_token' => isset($input['meta_api_token']) ? trim((string) wp_unslash($input['meta_api_token'])) : (string) $current['meta_api_token'],
        'creatify_api_base' => isset($input['creatify_api_base']) ? esc_url_raw(trim((string) $input['creatify_api_base'])) : (string) $current['creatify_api_base'],
        'creatify_api_key' => isset($input['creatify_api_key']) ? trim((string) wp_unslash($input['creatify_api_key'])) : (string) $current['creatify_api_key'],
        'typecast_api_base' => isset($input['typecast_api_base']) ? esc_url_raw(trim((string) $input['typecast_api_base'])) : (string) $current['typecast_api_base'],
        'typecast_api_key' => isset($input['typecast_api_key']) ? trim((string) wp_unslash($input['typecast_api_key'])) : (string) $current['typecast_api_key'],
        'adcreative_api_base' => isset($input['adcreative_api_base']) ? esc_url_raw(trim((string) $input['adcreative_api_base'])) : (string) $current['adcreative_api_base'],
        'adcreative_api_key' => isset($input['adcreative_api_key']) ? trim((string) wp_unslash($input['adcreative_api_key'])) : (string) $current['adcreative_api_key'],
        'landbot_api_base' => isset($input['landbot_api_base']) ? esc_url_raw(trim((string) $input['landbot_api_base'])) : (string) $current['landbot_api_base'],
        'landbot_api_key' => isset($input['landbot_api_key']) ? trim((string) wp_unslash($input['landbot_api_key'])) : (string) $current['landbot_api_key'],
        'adamigo_api_base' => isset($input['adamigo_api_base']) ? esc_url_raw(trim((string) $input['adamigo_api_base'])) : (string) $current['adamigo_api_base'],
        'adamigo_api_key' => isset($input['adamigo_api_key']) ? trim((string) wp_unslash($input['adamigo_api_key'])) : (string) $current['adamigo_api_key'],
        'web3_enabled' => !empty($input['web3_enabled']) ? 1 : 0,
        'web3_network' => isset($input['web3_network']) && in_array((string) $input['web3_network'], ['solana', 'evm'], true) ? (string) $input['web3_network'] : (string) $current['web3_network'],
        'web3_settlement_webhook' => isset($input['web3_settlement_webhook']) ? esc_url_raw(trim((string) $input['web3_settlement_webhook'])) : (string) $current['web3_settlement_webhook'],
        'web3_signing_secret' => isset($input['web3_signing_secret']) ? trim((string) wp_unslash($input['web3_signing_secret'])) : (string) $current['web3_signing_secret'],
        'web3_treasury_wallet' => isset($input['web3_treasury_wallet']) ? sanitize_text_field((string) $input['web3_treasury_wallet']) : (string) $current['web3_treasury_wallet'],
        'spl_token_mint' => isset($input['spl_token_mint']) ? sanitize_text_field((string) $input['spl_token_mint']) : (string) $current['spl_token_mint'],
        'spl_burn_percent' => isset($input['spl_burn_percent']) ? ai_addwords_meta_sanitize_percent($input['spl_burn_percent'], (int) $current['spl_burn_percent']) : (int) $current['spl_burn_percent'],
        'log_retention' => isset($input['log_retention']) ? max(20, min(1000, (int) $input['log_retention'])) : (int) $current['log_retention'],
    ];

    return $output;
}

function ai_addwords_meta_register_settings(): void
{
    register_setting('ai_addwords_meta', AI_ADDWORDS_META_OPTION_KEY, [
        'type' => 'array',
        'sanitize_callback' => 'ai_addwords_meta_sanitize_settings',
        'default' => ai_addwords_meta_default_settings(),
    ]);
}
add_action('admin_init', 'ai_addwords_meta_register_settings');

function ai_addwords_meta_cron_schedules(array $schedules): array
{
    $schedules['ai_addwords_meta_5m'] = [
        'interval' => 5 * MINUTE_IN_SECONDS,
        'display' => 'Every 5 Minutes (AI AddWords + Meta)',
    ];
    $schedules['ai_addwords_meta_15m'] = [
        'interval' => 15 * MINUTE_IN_SECONDS,
        'display' => 'Every 15 Minutes (AI AddWords + Meta)',
    ];
    $schedules['ai_addwords_meta_30m'] = [
        'interval' => 30 * MINUTE_IN_SECONDS,
        'display' => 'Every 30 Minutes (AI AddWords + Meta)',
    ];
    $schedules['ai_addwords_meta_60m'] = [
        'interval' => HOUR_IN_SECONDS,
        'display' => 'Every 60 Minutes (AI AddWords + Meta)',
    ];
    return $schedules;
}
add_filter('cron_schedules', 'ai_addwords_meta_cron_schedules');

function ai_addwords_meta_schedule_slug_from_interval(int $minutes): string
{
    if ($minutes <= 5) {
        return 'ai_addwords_meta_5m';
    }
    if ($minutes <= 15) {
        return 'ai_addwords_meta_15m';
    }
    if ($minutes <= 30) {
        return 'ai_addwords_meta_30m';
    }
    return 'ai_addwords_meta_60m';
}

function ai_addwords_meta_unschedule_event(): void
{
    while ($timestamp = wp_next_scheduled(AI_ADDWORDS_META_CRON_HOOK)) {
        wp_unschedule_event($timestamp, AI_ADDWORDS_META_CRON_HOOK);
    }
}

function ai_addwords_meta_sync_schedule(): void
{
    $settings = ai_addwords_meta_get_settings();
    if (empty($settings['enabled'])) {
        ai_addwords_meta_unschedule_event();
        return;
    }

    $schedule = ai_addwords_meta_schedule_slug_from_interval((int) $settings['cron_interval_minutes']);
    $event = function_exists('wp_get_scheduled_event') ? wp_get_scheduled_event(AI_ADDWORDS_META_CRON_HOOK) : null;
    if ($event && isset($event->schedule) && (string) $event->schedule !== $schedule) {
        ai_addwords_meta_unschedule_event();
        $event = null;
    }

    if (!$event && !wp_next_scheduled(AI_ADDWORDS_META_CRON_HOOK)) {
        wp_schedule_event(time() + 120, $schedule, AI_ADDWORDS_META_CRON_HOOK);
    }
}
add_action('init', 'ai_addwords_meta_sync_schedule');

function ai_addwords_meta_on_settings_update($oldValue, $value, $option): void
{
    ai_addwords_meta_sync_schedule();
}
add_action('update_option_' . AI_ADDWORDS_META_OPTION_KEY, 'ai_addwords_meta_on_settings_update', 10, 3);

function ai_addwords_meta_activate(): void
{
    $settings = ai_addwords_meta_get_settings();
    update_option(AI_ADDWORDS_META_OPTION_KEY, $settings, false);
    ai_addwords_meta_sync_schedule();
}
register_activation_hook(__FILE__, 'ai_addwords_meta_activate');

function ai_addwords_meta_deactivate(): void
{
    ai_addwords_meta_unschedule_event();
}
register_deactivation_hook(__FILE__, 'ai_addwords_meta_deactivate');

function ai_addwords_meta_log_event(string $level, string $message, array $context = []): void
{
    $settings = ai_addwords_meta_get_settings();
    $retention = max(20, min(1000, (int) ($settings['log_retention'] ?? 200)));
    $logs = get_option(AI_ADDWORDS_META_LOG_OPTION_KEY, []);
    if (!is_array($logs)) {
        $logs = [];
    }
    $logs[] = [
        'ts' => time(),
        'level' => $level,
        'message' => $message,
        'context' => $context,
    ];
    if (count($logs) > $retention) {
        $logs = array_slice($logs, -1 * $retention);
    }
    update_option(AI_ADDWORDS_META_LOG_OPTION_KEY, $logs, false);
}

function ai_addwords_meta_safe_post_json(string $url, array $payload, array $extraHeaders = []): array
{
    if ($url === '') {
        return ['ok' => false, 'error' => 'missing_url'];
    }

    $headers = array_merge([
        'Content-Type' => 'application/json',
    ], $extraHeaders);

    $response = wp_remote_post($url, [
        'timeout' => 20,
        'headers' => $headers,
        'body' => wp_json_encode($payload),
    ]);

    if (is_wp_error($response)) {
        return ['ok' => false, 'error' => $response->get_error_message()];
    }

    $status = (int) wp_remote_retrieve_response_code($response);
    $body = (string) wp_remote_retrieve_body($response);
    $decoded = json_decode($body, true);
    if (!is_array($decoded)) {
        $decoded = ['raw' => $body];
    }

    return [
        'ok' => $status >= 200 && $status < 300,
        'status' => $status,
        'data' => $decoded,
    ];
}

function ai_addwords_meta_call_provider(string $provider, string $base, string $key, string $path, array $payload = []): array
{
    if ($base === '' || $key === '') {
        return ['ok' => false, 'error' => 'provider_not_configured'];
    }
    $endpoint = rtrim($base, '/') . '/' . ltrim($path, '/');
    return ai_addwords_meta_safe_post_json($endpoint, $payload, [
        'Authorization' => 'Bearer ' . $key,
        'X-AI-Provider' => $provider,
    ]);
}

function ai_addwords_meta_fetch_campaign_metrics(array $settings): array
{
    $campaigns = [];
    $targetCpa = (float) $settings['target_cpa_usd'];

    if (!empty($settings['adwords_api_base']) && !empty($settings['adwords_api_token'])) {
        $adwords = ai_addwords_meta_call_provider(
            'adwords-manager',
            (string) $settings['adwords_api_base'],
            (string) $settings['adwords_api_token'],
            '/campaigns/metrics',
            ['window' => '24h']
        );
        if (!empty($adwords['ok']) && !empty($adwords['data']['campaigns']) && is_array($adwords['data']['campaigns'])) {
            foreach ($adwords['data']['campaigns'] as $item) {
                if (!is_array($item)) {
                    continue;
                }
                $campaigns[] = [
                    'id' => (string) ($item['id'] ?? ''),
                    'name' => (string) ($item['name'] ?? 'AdWords Campaign'),
                    'platform' => 'adwords',
                    'spend_usd' => (float) ($item['spend_usd'] ?? 0),
                    'conversions' => (int) ($item['conversions'] ?? 0),
                    'status' => (string) ($item['status'] ?? 'active'),
                ];
            }
        } else {
            ai_addwords_meta_log_event('warning', 'AdWords metrics fetch failed; using fallback simulation.', [
                'error' => $adwords['error'] ?? 'unknown',
            ]);
        }
    }

    if (!empty($settings['meta_api_base']) && !empty($settings['meta_api_token'])) {
        $meta = ai_addwords_meta_call_provider(
            'meta-ads',
            (string) $settings['meta_api_base'],
            (string) $settings['meta_api_token'],
            '/campaigns/metrics',
            ['window' => '24h']
        );
        if (!empty($meta['ok']) && !empty($meta['data']['campaigns']) && is_array($meta['data']['campaigns'])) {
            foreach ($meta['data']['campaigns'] as $item) {
                if (!is_array($item)) {
                    continue;
                }
                $campaigns[] = [
                    'id' => (string) ($item['id'] ?? ''),
                    'name' => (string) ($item['name'] ?? 'Meta Campaign'),
                    'platform' => 'meta',
                    'spend_usd' => (float) ($item['spend_usd'] ?? 0),
                    'conversions' => (int) ($item['conversions'] ?? 0),
                    'status' => (string) ($item['status'] ?? 'active'),
                ];
            }
        } else {
            ai_addwords_meta_log_event('warning', 'Meta metrics fetch failed; using fallback simulation.', [
                'error' => $meta['error'] ?? 'unknown',
            ]);
        }
    }

    if (empty($campaigns)) {
        $campaigns = [
            ['id' => 'sim-adwords-1', 'name' => 'Simulation Search 1', 'platform' => 'adwords', 'spend_usd' => 120.00, 'conversions' => 4, 'status' => 'active'],
            ['id' => 'sim-meta-1', 'name' => 'Simulation Meta 1', 'platform' => 'meta', 'spend_usd' => 140.00, 'conversions' => 2, 'status' => 'active'],
            ['id' => 'sim-meta-2', 'name' => 'Simulation Meta 2', 'platform' => 'meta', 'spend_usd' => 80.00, 'conversions' => 3, 'status' => 'active'],
        ];
    }

    foreach ($campaigns as &$campaign) {
        $conversions = (int) $campaign['conversions'];
        $spend = (float) $campaign['spend_usd'];
        $campaign['cpa_usd'] = $conversions > 0 ? $spend / $conversions : 999999;
        $campaign['owner_payable_usd'] = $conversions * $targetCpa;
    }
    unset($campaign);

    return $campaigns;
}

function ai_addwords_meta_decide_actions(array $settings, array $campaigns): array
{
    $target = (float) $settings['target_cpa_usd'];
    $minConversions = (int) $settings['min_conversions_for_decision'];
    $underPct = (int) $settings['scale_when_under_target_percent'];
    $overPct = (int) $settings['pause_when_over_target_percent'];
    $budgetScalePct = (int) $settings['scale_budget_percent'];

    $actions = [];
    foreach ($campaigns as $campaign) {
        $conversions = (int) ($campaign['conversions'] ?? 0);
        $cpa = (float) ($campaign['cpa_usd'] ?? 999999);
        $action = 'hold';
        $reason = 'insufficient_data';

        if ($conversions >= $minConversions) {
            $thresholdScale = $target * (1 - ($underPct / 100));
            $thresholdPause = $target * (1 + ($overPct / 100));
            if ($cpa <= $thresholdScale) {
                $action = 'scale';
                $reason = 'beating_target_cpa';
            } elseif ($cpa >= $thresholdPause) {
                $action = 'pause';
                $reason = 'exceeding_target_cpa';
            } else {
                $action = 'keep';
                $reason = 'within_target_band';
            }
        }

        $actions[] = [
            'campaign_id' => (string) ($campaign['id'] ?? ''),
            'platform' => (string) ($campaign['platform'] ?? ''),
            'action' => $action,
            'reason' => $reason,
            'budget_change_percent' => $action === 'scale' ? $budgetScalePct : 0,
            'cpa_usd' => round($cpa, 2),
            'conversions' => $conversions,
            'spend_usd' => round((float) ($campaign['spend_usd'] ?? 0), 2),
        ];
    }

    return $actions;
}

function ai_addwords_meta_apply_spend_guardrail(array $settings, array $campaigns, array $actions): array
{
    $maxDailySpend = (float) ($settings['max_daily_spend_usd'] ?? 0);
    if ($maxDailySpend <= 0) {
        return $actions;
    }

    $currentSpend = 0.0;
    $campaignById = [];
    foreach ($campaigns as $campaign) {
        $campaignId = (string) ($campaign['id'] ?? '');
        if ($campaignId !== '') {
            $campaignById[$campaignId] = $campaign;
        }
        $currentSpend += (float) ($campaign['spend_usd'] ?? 0);
    }

    if ($currentSpend >= $maxDailySpend) {
        foreach ($actions as &$action) {
            if (($action['action'] ?? '') === 'scale') {
                $action['action'] = 'keep';
                $action['reason'] = 'max_daily_spend_reached';
                $action['budget_change_percent'] = 0;
            }
        }
        unset($action);
        return $actions;
    }

    $remaining = $maxDailySpend - $currentSpend;
    $scaleCandidates = [];
    foreach ($actions as $index => $action) {
        if (($action['action'] ?? '') !== 'scale') {
            continue;
        }
        $campaignId = (string) ($action['campaign_id'] ?? '');
        $campaign = $campaignById[$campaignId] ?? null;
        if (!is_array($campaign)) {
            continue;
        }
        $spend = (float) ($campaign['spend_usd'] ?? 0);
        $delta = $spend * ((int) ($action['budget_change_percent'] ?? 0) / 100);
        $scaleCandidates[] = [
            'index' => $index,
            'delta' => $delta,
            'cpa' => (float) ($action['cpa_usd'] ?? 999999),
        ];
    }

    usort($scaleCandidates, static function ($left, $right) {
        if ($left['cpa'] === $right['cpa']) {
            return 0;
        }
        return ($left['cpa'] < $right['cpa']) ? -1 : 1;
    });

    foreach ($scaleCandidates as $candidate) {
        $delta = (float) $candidate['delta'];
        $index = (int) $candidate['index'];
        if ($delta <= $remaining) {
            $remaining -= $delta;
            continue;
        }
        $actions[$index]['action'] = 'keep';
        $actions[$index]['reason'] = 'max_daily_spend_guardrail';
        $actions[$index]['budget_change_percent'] = 0;
    }

    return $actions;
}

function ai_addwords_meta_dispatch_actions(array $settings, array $actions): array
{
    $dryRun = !empty($settings['dry_run']);
    $applied = [];

    foreach ($actions as $action) {
        $platform = (string) ($action['platform'] ?? '');
        $campaignId = (string) ($action['campaign_id'] ?? '');
        $operation = (string) ($action['action'] ?? 'hold');

        if ($operation === 'hold') {
            $applied[] = array_merge($action, ['result' => 'skipped']);
            continue;
        }

        if ($dryRun) {
            $applied[] = array_merge($action, ['result' => 'dry_run']);
            continue;
        }

        $payload = [
            'campaign_id' => $campaignId,
            'action' => $operation,
            'budget_change_percent' => (int) ($action['budget_change_percent'] ?? 0),
        ];

        if ($platform === 'adwords') {
            $result = ai_addwords_meta_call_provider(
                'adwords-manager',
                (string) $settings['adwords_api_base'],
                (string) $settings['adwords_api_token'],
                '/campaigns/update',
                $payload
            );
        } elseif ($platform === 'meta') {
            $result = ai_addwords_meta_call_provider(
                'meta-ads',
                (string) $settings['meta_api_base'],
                (string) $settings['meta_api_token'],
                '/campaigns/update',
                $payload
            );
        } else {
            $result = ['ok' => false, 'error' => 'unknown_platform'];
        }

        $applied[] = array_merge($action, [
            'result' => !empty($result['ok']) ? 'applied' : 'error',
            'error' => $result['error'] ?? '',
        ]);
    }

    return $applied;
}

function ai_addwords_meta_trigger_creative_pipeline(array $settings, array $actions): array
{
    $winners = array_values(array_filter($actions, static function ($item) {
        return is_array($item) && ($item['action'] ?? '') === 'scale';
    }));

    if (empty($winners)) {
        return ['ok' => true, 'message' => 'no_winners_no_refresh'];
    }

    $payload = [
        'winning_campaigns' => array_map(static function ($item) {
            return [
                'campaign_id' => (string) ($item['campaign_id'] ?? ''),
                'platform' => (string) ($item['platform'] ?? ''),
                'cpa_usd' => (float) ($item['cpa_usd'] ?? 0),
            ];
        }, $winners),
    ];

    $results = [];
    $results['creatify'] = ai_addwords_meta_call_provider(
        'creatify',
        (string) $settings['creatify_api_base'],
        (string) $settings['creatify_api_key'],
        '/creative/video/generate',
        $payload
    );
    $results['typecast'] = ai_addwords_meta_call_provider(
        'typecast',
        (string) $settings['typecast_api_base'],
        (string) $settings['typecast_api_key'],
        '/voiceover/generate',
        $payload
    );
    $results['adcreative'] = ai_addwords_meta_call_provider(
        'adcreative',
        (string) $settings['adcreative_api_base'],
        (string) $settings['adcreative_api_key'],
        '/copy/variants',
        $payload
    );
    $results['landbot'] = ai_addwords_meta_call_provider(
        'landbot',
        (string) $settings['landbot_api_base'],
        (string) $settings['landbot_api_key'],
        '/funnels/assistant/update',
        $payload
    );
    $results['adamigo'] = ai_addwords_meta_call_provider(
        'adamigo',
        (string) $settings['adamigo_api_base'],
        (string) $settings['adamigo_api_key'],
        '/meta/strategy/rebalance',
        $payload
    );

    return ['ok' => true, 'results' => $results];
}

function ai_addwords_meta_prepare_settlement(array $settings, array $campaigns): array
{
    $targetCpa = (float) $settings['target_cpa_usd'];
    $burnPercent = (int) $settings['spl_burn_percent'];

    $totalSpend = 0.0;
    $totalConversions = 0;
    foreach ($campaigns as $campaign) {
        $totalSpend += (float) ($campaign['spend_usd'] ?? 0);
        $totalConversions += (int) ($campaign['conversions'] ?? 0);
    }

    $ownerPayable = $targetCpa * $totalConversions;
    $profit = $ownerPayable - $totalSpend;
    if ($profit < 0) {
        $profit = 0.0;
    }
    $burnAmount = $profit * ($burnPercent / 100);

    return [
        'network' => (string) $settings['web3_network'],
        'treasury_wallet' => (string) $settings['web3_treasury_wallet'],
        'spl_token_mint' => (string) $settings['spl_token_mint'],
        'traffic_finance_usd' => round($totalSpend, 2),
        'owner_payable_usd' => round($ownerPayable, 2),
        'profit_usd' => round($profit, 2),
        'burn_percent' => $burnPercent,
        'spl_burn_notional_usd' => round($burnAmount, 2),
    ];
}

function ai_addwords_meta_dispatch_settlement(array $settings, array $settlement): array
{
    if (empty($settings['web3_enabled'])) {
        return ['ok' => true, 'result' => 'disabled'];
    }

    $webhook = (string) $settings['web3_settlement_webhook'];
    if ($webhook === '') {
        return ['ok' => false, 'result' => 'missing_webhook'];
    }

    $timestamp = (string) time();
    $body = wp_json_encode($settlement);
    if (!is_string($body)) {
        return ['ok' => false, 'result' => 'encode_error'];
    }

    $signature = '';
    if (!empty($settings['web3_signing_secret'])) {
        $signature = hash_hmac('sha256', $timestamp . '.' . $body, (string) $settings['web3_signing_secret']);
    }

    $response = wp_remote_post($webhook, [
        'timeout' => 20,
        'headers' => [
            'Content-Type' => 'application/json',
            'X-Settlement-Timestamp' => $timestamp,
            'X-Settlement-Signature' => $signature,
        ],
        'body' => $body,
    ]);

    if (is_wp_error($response)) {
        return ['ok' => false, 'result' => 'request_error', 'error' => $response->get_error_message()];
    }

    $status = (int) wp_remote_retrieve_response_code($response);
    $ok = $status >= 200 && $status < 300;
    return [
        'ok' => $ok,
        'result' => $ok ? 'sent' : 'http_error',
        'status' => $status,
    ];
}

function ai_addwords_meta_run_optimization_cycle(string $trigger = 'cron'): array
{
    $settings = ai_addwords_meta_get_settings();
    if (empty($settings['enabled'])) {
        $report = ['ok' => true, 'result' => 'disabled'];
        update_option(AI_ADDWORDS_META_LAST_REPORT_OPTION_KEY, $report, false);
        return $report;
    }

    $campaigns = ai_addwords_meta_fetch_campaign_metrics($settings);
    $actions = ai_addwords_meta_decide_actions($settings, $campaigns);
    $actions = ai_addwords_meta_apply_spend_guardrail($settings, $campaigns, $actions);
    $applied = ai_addwords_meta_dispatch_actions($settings, $actions);
    $creative = ai_addwords_meta_trigger_creative_pipeline($settings, $actions);
    $settlement = ai_addwords_meta_prepare_settlement($settings, $campaigns);
    $settlementDispatch = empty($settings['dry_run']) ? ai_addwords_meta_dispatch_settlement($settings, $settlement) : ['ok' => true, 'result' => 'dry_run'];

    $report = [
        'ok' => true,
        'timestamp' => time(),
        'trigger' => $trigger,
        'dry_run' => !empty($settings['dry_run']),
        'campaigns' => $campaigns,
        'actions' => $applied,
        'creative_pipeline' => $creative,
        'settlement' => $settlement,
        'settlement_dispatch' => $settlementDispatch,
    ];

    update_option(AI_ADDWORDS_META_LAST_REPORT_OPTION_KEY, $report, false);
    ai_addwords_meta_log_event('info', 'Optimization cycle complete.', [
        'trigger' => $trigger,
        'campaigns' => count($campaigns),
        'dry_run' => !empty($settings['dry_run']),
        'settlement_dispatch' => $settlementDispatch['result'] ?? '',
    ]);

    return $report;
}

function ai_addwords_meta_cron_runner(): void
{
    ai_addwords_meta_run_optimization_cycle('cron');
}
add_action(AI_ADDWORDS_META_CRON_HOOK, 'ai_addwords_meta_cron_runner');

function ai_addwords_meta_handle_admin_actions(): void
{
    if (!is_admin()) {
        return;
    }
    if (!current_user_can('manage_options')) {
        return;
    }
    if (empty($_POST['ai_addwords_meta_action'])) {
        return;
    }

    $action = sanitize_text_field((string) wp_unslash($_POST['ai_addwords_meta_action']));
    if ($action !== 'run_now') {
        return;
    }

    check_admin_referer('ai_addwords_meta_run_now');
    $report = ai_addwords_meta_run_optimization_cycle('manual');
    set_transient('ai_addwords_meta_notice', [
        'type' => 'success',
        'message' => 'Optimization run complete. Actions: ' . count($report['actions'] ?? []),
    ], 30);

    $redirect = add_query_arg(['page' => 'ai-addwords-meta'], admin_url('options-general.php'));
    wp_safe_redirect($redirect);
    exit;
}
add_action('admin_init', 'ai_addwords_meta_handle_admin_actions');

function ai_addwords_meta_admin_menu(): void
{
    add_options_page(
        'AI AddWords + Meta',
        'AI AddWords + Meta',
        'manage_options',
        'ai-addwords-meta',
        'ai_addwords_meta_render_settings_page'
    );
}
add_action('admin_menu', 'ai_addwords_meta_admin_menu');

function ai_addwords_meta_text_input(string $name, string $value, string $type = 'text', string $placeholder = ''): void
{
    printf(
        '<input type="%s" class="regular-text" name="%s[%s]" value="%s" placeholder="%s" />',
        esc_attr($type),
        esc_attr(AI_ADDWORDS_META_OPTION_KEY),
        esc_attr($name),
        esc_attr($value),
        esc_attr($placeholder)
    );
}

function ai_addwords_meta_number_input(string $name, $value, string $step = '1', string $min = '0', string $max = ''): void
{
    printf(
        '<input type="number" class="small-text" name="%s[%s]" value="%s" step="%s" min="%s" max="%s" />',
        esc_attr(AI_ADDWORDS_META_OPTION_KEY),
        esc_attr($name),
        esc_attr((string) $value),
        esc_attr($step),
        esc_attr($min),
        esc_attr($max)
    );
}

function ai_addwords_meta_render_last_report(array $report): void
{
    if (empty($report)) {
        echo '<p>No optimization cycle has run yet.</p>';
        return;
    }

    $timestamp = isset($report['timestamp']) ? (int) $report['timestamp'] : 0;
    echo '<p><strong>Last run:</strong> ' . esc_html($timestamp > 0 ? gmdate('Y-m-d H:i:s', $timestamp) . ' UTC' : 'Unknown') . '</p>';
    echo '<p><strong>Trigger:</strong> ' . esc_html((string) ($report['trigger'] ?? 'n/a')) . '</p>';
    echo '<p><strong>Mode:</strong> ' . (!empty($report['dry_run']) ? 'Dry Run' : 'Live') . '</p>';

    if (!empty($report['settlement']) && is_array($report['settlement'])) {
        $settlement = $report['settlement'];
        echo '<p><strong>Finance USD:</strong> ' . esc_html((string) ($settlement['traffic_finance_usd'] ?? '0')) . '</p>';
        echo '<p><strong>Owner Payable USD:</strong> ' . esc_html((string) ($settlement['owner_payable_usd'] ?? '0')) . '</p>';
        echo '<p><strong>Profit USD:</strong> ' . esc_html((string) ($settlement['profit_usd'] ?? '0')) . '</p>';
        echo '<p><strong>SPL Burn Notional USD:</strong> ' . esc_html((string) ($settlement['spl_burn_notional_usd'] ?? '0')) . '</p>';
    }
}

function ai_addwords_meta_render_logs(array $logs): void
{
    if (empty($logs)) {
        echo '<p>No logs yet.</p>';
        return;
    }

    echo '<table class="widefat striped"><thead><tr><th>Time (UTC)</th><th>Level</th><th>Message</th></tr></thead><tbody>';
    foreach (array_reverse($logs) as $log) {
        if (!is_array($log)) {
            continue;
        }
        $ts = isset($log['ts']) ? (int) $log['ts'] : 0;
        $level = isset($log['level']) ? (string) $log['level'] : '';
        $message = isset($log['message']) ? (string) $log['message'] : '';
        echo '<tr>';
        echo '<td>' . esc_html($ts > 0 ? gmdate('Y-m-d H:i:s', $ts) : '-') . '</td>';
        echo '<td>' . esc_html($level) . '</td>';
        echo '<td>' . esc_html($message) . '</td>';
        echo '</tr>';
    }
    echo '</tbody></table>';
}

function ai_addwords_meta_render_settings_page(): void
{
    if (!current_user_can('manage_options')) {
        return;
    }

    $settings = ai_addwords_meta_get_settings();
    $logs = get_option(AI_ADDWORDS_META_LOG_OPTION_KEY, []);
    if (!is_array($logs)) {
        $logs = [];
    }
    $report = get_option(AI_ADDWORDS_META_LAST_REPORT_OPTION_KEY, []);
    if (!is_array($report)) {
        $report = [];
    }
    $notice = get_transient('ai_addwords_meta_notice');
    if ($notice && is_array($notice)) {
        delete_transient('ai_addwords_meta_notice');
    }
    ?>
    <div class="wrap">
        <h1>AI AddWords + Meta Paid Traffic</h1>
        <p>Runs multi-agent ad optimization against your target CPA and sends Web3 settlement instructions.</p>
        <?php if ($notice && is_array($notice)): ?>
            <div class="notice notice-<?php echo esc_attr((string) ($notice['type'] ?? 'info')); ?> is-dismissible"><p><?php echo esc_html((string) ($notice['message'] ?? '')); ?></p></div>
        <?php endif; ?>

        <h2>Run Now</h2>
        <form method="post">
            <?php wp_nonce_field('ai_addwords_meta_run_now'); ?>
            <input type="hidden" name="ai_addwords_meta_action" value="run_now" />
            <?php submit_button('Run Optimization Cycle Now', 'secondary', 'submit', false); ?>
        </form>

        <h2>Last Report</h2>
        <?php ai_addwords_meta_render_last_report($report); ?>

        <h2>Settings</h2>
        <form method="post" action="options.php">
            <?php settings_fields('ai_addwords_meta'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row">Enable optimizer</th>
                    <td><label><input type="checkbox" name="<?php echo esc_attr(AI_ADDWORDS_META_OPTION_KEY); ?>[enabled]" value="1" <?php checked(!empty($settings['enabled'])); ?> /> Enabled</label></td>
                </tr>
                <tr>
                    <th scope="row">Dry run mode</th>
                    <td><label><input type="checkbox" name="<?php echo esc_attr(AI_ADDWORDS_META_OPTION_KEY); ?>[dry_run]" value="1" <?php checked(!empty($settings['dry_run'])); ?> /> Do not push live spend/settlement actions</label></td>
                </tr>
                <tr>
                    <th scope="row">Owner / Account Name</th>
                    <td><?php ai_addwords_meta_text_input('owner_name', (string) $settings['owner_name']); ?></td>
                </tr>
                <tr>
                    <th scope="row">Target CPA (USD)</th>
                    <td><?php ai_addwords_meta_number_input('target_cpa_usd', (string) $settings['target_cpa_usd'], '0.01', '0.01', '1000000'); ?></td>
                </tr>
                <tr>
                    <th scope="row">Min conversions for action</th>
                    <td><?php ai_addwords_meta_number_input('min_conversions_for_decision', (int) $settings['min_conversions_for_decision']); ?></td>
                </tr>
                <tr>
                    <th scope="row">Scale threshold (%)</th>
                    <td><?php ai_addwords_meta_number_input('scale_when_under_target_percent', (int) $settings['scale_when_under_target_percent']); ?> under target</td>
                </tr>
                <tr>
                    <th scope="row">Pause threshold (%)</th>
                    <td><?php ai_addwords_meta_number_input('pause_when_over_target_percent', (int) $settings['pause_when_over_target_percent']); ?> above target</td>
                </tr>
                <tr>
                    <th scope="row">Scale budget increase (%)</th>
                    <td><?php ai_addwords_meta_number_input('scale_budget_percent', (int) $settings['scale_budget_percent'], '1', '1', '200'); ?></td>
                </tr>
                <tr>
                    <th scope="row">Max daily spend (USD)</th>
                    <td><?php ai_addwords_meta_number_input('max_daily_spend_usd', (string) $settings['max_daily_spend_usd'], '0.01', '0.01', '1000000'); ?></td>
                </tr>
                <tr>
                    <th scope="row">Optimization interval (minutes)</th>
                    <td>
                        <select name="<?php echo esc_attr(AI_ADDWORDS_META_OPTION_KEY); ?>[cron_interval_minutes]">
                            <?php foreach ([5, 15, 30, 60] as $minutes): ?>
                                <option value="<?php echo esc_attr((string) $minutes); ?>" <?php selected((int) $settings['cron_interval_minutes'], $minutes); ?>><?php echo esc_html((string) $minutes); ?></option>
                            <?php endforeach; ?>
                        </select>
                    </td>
                </tr>

                <tr><th scope="row" colspan="2"><h3>Paid Traffic APIs</h3></th></tr>
                <tr>
                    <th scope="row">AdWords manager base URL</th>
                    <td><?php ai_addwords_meta_text_input('adwords_api_base', (string) $settings['adwords_api_base'], 'url', 'https://api.example.com'); ?></td>
                </tr>
                <tr>
                    <th scope="row">AdWords manager token</th>
                    <td><?php ai_addwords_meta_text_input('adwords_api_token', (string) $settings['adwords_api_token'], 'password'); ?></td>
                </tr>
                <tr>
                    <th scope="row">Meta ads base URL</th>
                    <td><?php ai_addwords_meta_text_input('meta_api_base', (string) $settings['meta_api_base'], 'url', 'https://api.example.com'); ?></td>
                </tr>
                <tr>
                    <th scope="row">Meta ads token</th>
                    <td><?php ai_addwords_meta_text_input('meta_api_token', (string) $settings['meta_api_token'], 'password'); ?></td>
                </tr>

                <tr><th scope="row" colspan="2"><h3>AI Creative Stack</h3></th></tr>
                <tr>
                    <th scope="row">Creatify API base/key</th>
                    <td>
                        <?php ai_addwords_meta_text_input('creatify_api_base', (string) $settings['creatify_api_base'], 'url'); ?>
                        <?php ai_addwords_meta_text_input('creatify_api_key', (string) $settings['creatify_api_key'], 'password'); ?>
                    </td>
                </tr>
                <tr>
                    <th scope="row">Typecast API base/key</th>
                    <td>
                        <?php ai_addwords_meta_text_input('typecast_api_base', (string) $settings['typecast_api_base'], 'url'); ?>
                        <?php ai_addwords_meta_text_input('typecast_api_key', (string) $settings['typecast_api_key'], 'password'); ?>
                    </td>
                </tr>
                <tr>
                    <th scope="row">AdCreative API base/key</th>
                    <td>
                        <?php ai_addwords_meta_text_input('adcreative_api_base', (string) $settings['adcreative_api_base'], 'url'); ?>
                        <?php ai_addwords_meta_text_input('adcreative_api_key', (string) $settings['adcreative_api_key'], 'password'); ?>
                    </td>
                </tr>
                <tr>
                    <th scope="row">Landbot API base/key</th>
                    <td>
                        <?php ai_addwords_meta_text_input('landbot_api_base', (string) $settings['landbot_api_base'], 'url'); ?>
                        <?php ai_addwords_meta_text_input('landbot_api_key', (string) $settings['landbot_api_key'], 'password'); ?>
                    </td>
                </tr>
                <tr>
                    <th scope="row">Adamigo API base/key</th>
                    <td>
                        <?php ai_addwords_meta_text_input('adamigo_api_base', (string) $settings['adamigo_api_base'], 'url'); ?>
                        <?php ai_addwords_meta_text_input('adamigo_api_key', (string) $settings['adamigo_api_key'], 'password'); ?>
                    </td>
                </tr>

                <tr><th scope="row" colspan="2"><h3>Web3 Settlement</h3></th></tr>
                <tr>
                    <th scope="row">Enable Web3 settlement</th>
                    <td><label><input type="checkbox" name="<?php echo esc_attr(AI_ADDWORDS_META_OPTION_KEY); ?>[web3_enabled]" value="1" <?php checked(!empty($settings['web3_enabled'])); ?> /> Enabled</label></td>
                </tr>
                <tr>
                    <th scope="row">Settlement network</th>
                    <td>
                        <select name="<?php echo esc_attr(AI_ADDWORDS_META_OPTION_KEY); ?>[web3_network]">
                            <option value="solana" <?php selected((string) $settings['web3_network'], 'solana'); ?>>Solana</option>
                            <option value="evm" <?php selected((string) $settings['web3_network'], 'evm'); ?>>EVM</option>
                        </select>
                    </td>
                </tr>
                <tr>
                    <th scope="row">Settlement webhook URL</th>
                    <td><?php ai_addwords_meta_text_input('web3_settlement_webhook', (string) $settings['web3_settlement_webhook'], 'url', 'https://settlement.example.com/webhook'); ?></td>
                </tr>
                <tr>
                    <th scope="row">Settlement signing secret</th>
                    <td><?php ai_addwords_meta_text_input('web3_signing_secret', (string) $settings['web3_signing_secret'], 'password'); ?></td>
                </tr>
                <tr>
                    <th scope="row">Treasury wallet</th>
                    <td><?php ai_addwords_meta_text_input('web3_treasury_wallet', (string) $settings['web3_treasury_wallet']); ?></td>
                </tr>
                <tr>
                    <th scope="row">SPL token mint</th>
                    <td><?php ai_addwords_meta_text_input('spl_token_mint', (string) $settings['spl_token_mint']); ?></td>
                </tr>
                <tr>
                    <th scope="row">SPL burn percent of profit</th>
                    <td><?php ai_addwords_meta_number_input('spl_burn_percent', (int) $settings['spl_burn_percent'], '1', '0', '100'); ?></td>
                </tr>

                <tr>
                    <th scope="row">Log retention</th>
                    <td><?php ai_addwords_meta_number_input('log_retention', (int) $settings['log_retention'], '1', '20', '1000'); ?> entries</td>
                </tr>
            </table>
            <?php submit_button('Save Settings'); ?>
        </form>

        <h2>Recent Logs</h2>
        <?php ai_addwords_meta_render_logs($logs); ?>
    </div>
    <?php
}
