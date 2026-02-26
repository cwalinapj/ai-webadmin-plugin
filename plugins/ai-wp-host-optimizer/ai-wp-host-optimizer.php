<?php
/**
 * Plugin Name: AI WP Host Optimizer Plugin
 * Description: Captures WordPress host baselines across hardware/region profiles and exports signed benchmark samples to a control plane.
 * Version: 0.1.0
 * Author: Sitebuilder
 * License: GPLv2 or later
 */

if (!defined('ABSPATH')) {
    exit;
}

define('AI_WP_HOST_OPTIMIZER_OPTION_KEY', 'ai_wp_host_optimizer_settings');
define('AI_WP_HOST_OPTIMIZER_LAST_SAMPLE_OPTION', 'ai_wp_host_optimizer_last_sample');
define('AI_WP_HOST_OPTIMIZER_HISTORY_OPTION', 'ai_wp_host_optimizer_samples');
define('AI_WP_HOST_OPTIMIZER_CRON_HOOK', 'ai_wp_host_optimizer_collect_cron');

function ai_wp_host_optimizer_default_settings(): array
{
    return [
        'enabled' => 1,
        'worker_base_url' => '',
        'plugin_shared_secret' => '',
        'host_optimizer_capability_token' => '',
        'anchor_enabled' => 0,
        'anchor_api_base_url' => '',
        'anchor_api_token' => '',
        'anchor_retention_class' => 'balanced',
        'anchor_priority' => 'standard',
        'anchor_force_ipfs_backup' => 0,
        'plugin_instance_id' => '',
        'provider_name' => '',
        'region_label' => '',
        'virtualization_os' => 'proxmox',
        'cpu_model' => '',
        'cpu_year' => '',
        'ram_gb' => '',
        'memory_class' => 'UNKNOWN',
        'webserver_type' => 'nginx_php_fpm',
        'storage_type' => 'nvme',
        'uplink_mbps' => '1000',
        'gpu_acceleration_mode' => 'none',
        'gpu_model' => '',
        'gpu_count' => '0',
        'gpu_vram_gb' => '',
        'gpu_effect_note' => '',
        'sample_interval_minutes' => 30,
        'benchmark_iterations' => 250000,
        'probe_hosts' => "1.1.1.1:443\n8.8.8.8:443",
        'max_history' => 240,
    ];
}

function ai_wp_host_optimizer_get_settings(): array
{
    $defaults = ai_wp_host_optimizer_default_settings();
    $stored = get_option(AI_WP_HOST_OPTIMIZER_OPTION_KEY, []);
    if (!is_array($stored)) {
        $stored = [];
    }
    return array_merge($defaults, $stored);
}

function ai_wp_host_optimizer_sanitize_instance_id(string $value): string
{
    $clean = preg_replace('/[^A-Za-z0-9._:-]+/', '-', trim($value));
    $clean = trim((string) $clean, '-');
    if ($clean === '') {
        return '';
    }
    return substr($clean, 0, 80);
}

function ai_wp_host_optimizer_sanitize_settings($input): array
{
    if (!is_array($input)) {
        $input = [];
    }

    $current = ai_wp_host_optimizer_get_settings();
    $allowedVirtualization = ['proxmox', 'esxi', 'kvm', 'bare_metal', 'other'];
    $allowedStorage = ['nvme', 'ssd', 'hdd', 'other'];
    $allowedUplink = ['100', '1000', '2500', '5000', '10000', '25000', '40000', 'other'];
    $allowedMemoryClass = ['ECC_DDR3', 'ECC_DDR4', 'ECC_DDR5', 'ECC_DDR6', 'ECC_DDR7', 'NON_ECC', 'UNKNOWN'];
    $allowedWebserver = ['nginx_php_fpm', 'apache_event', 'apache_prefork', 'litespeed', 'caddy_php_fpm', 'other'];
    $allowedGpuModes = ['none', 'cuda', 'rocm', 'opencl', 'other'];
    $allowedAnchorRetention = ['hot', 'balanced', 'cold'];
    $allowedAnchorPriority = ['standard', 'high'];
    $allowedIntervals = [5, 15, 30, 60];

    $virtualization = isset($input['virtualization_os']) ? sanitize_text_field((string) $input['virtualization_os']) : (string) $current['virtualization_os'];
    if (!in_array($virtualization, $allowedVirtualization, true)) {
        $virtualization = 'other';
    }

    $storageType = isset($input['storage_type']) ? sanitize_text_field((string) $input['storage_type']) : (string) $current['storage_type'];
    if (!in_array($storageType, $allowedStorage, true)) {
        $storageType = 'other';
    }

    $uplinkMbps = isset($input['uplink_mbps']) ? sanitize_text_field((string) $input['uplink_mbps']) : (string) $current['uplink_mbps'];
    if (!in_array($uplinkMbps, $allowedUplink, true)) {
        $uplinkMbps = 'other';
    }

    $memoryClass = isset($input['memory_class']) ? strtoupper(sanitize_text_field((string) $input['memory_class'])) : (string) $current['memory_class'];
    if (!in_array($memoryClass, $allowedMemoryClass, true)) {
        $memoryClass = 'UNKNOWN';
    }

    $webserverType = isset($input['webserver_type']) ? sanitize_text_field((string) $input['webserver_type']) : (string) $current['webserver_type'];
    if (!in_array($webserverType, $allowedWebserver, true)) {
        $webserverType = 'other';
    }

    $gpuMode = isset($input['gpu_acceleration_mode']) ? sanitize_text_field((string) $input['gpu_acceleration_mode']) : (string) $current['gpu_acceleration_mode'];
    if (!in_array($gpuMode, $allowedGpuModes, true)) {
        $gpuMode = 'other';
    }

    $anchorRetention = isset($input['anchor_retention_class']) ? sanitize_text_field((string) $input['anchor_retention_class']) : (string) $current['anchor_retention_class'];
    if (!in_array($anchorRetention, $allowedAnchorRetention, true)) {
        $anchorRetention = 'balanced';
    }

    $anchorPriority = isset($input['anchor_priority']) ? sanitize_text_field((string) $input['anchor_priority']) : (string) $current['anchor_priority'];
    if (!in_array($anchorPriority, $allowedAnchorPriority, true)) {
        $anchorPriority = 'standard';
    }

    $interval = isset($input['sample_interval_minutes']) ? (int) $input['sample_interval_minutes'] : (int) $current['sample_interval_minutes'];
    if (!in_array($interval, $allowedIntervals, true)) {
        $interval = 30;
    }

    $iterations = isset($input['benchmark_iterations']) ? (int) $input['benchmark_iterations'] : (int) $current['benchmark_iterations'];
    $iterations = max(10000, min(2000000, $iterations));

    $maxHistory = isset($input['max_history']) ? (int) $input['max_history'] : (int) $current['max_history'];
    $maxHistory = max(20, min(1000, $maxHistory));

    $probeHosts = isset($input['probe_hosts']) ? sanitize_textarea_field((string) $input['probe_hosts']) : (string) $current['probe_hosts'];

    return [
        'enabled' => !empty($input['enabled']) ? 1 : 0,
        'worker_base_url' => isset($input['worker_base_url']) ? esc_url_raw(trim((string) $input['worker_base_url'])) : (string) $current['worker_base_url'],
        'plugin_shared_secret' => isset($input['plugin_shared_secret']) ? trim((string) wp_unslash($input['plugin_shared_secret'])) : (string) $current['plugin_shared_secret'],
        'host_optimizer_capability_token' => isset($input['host_optimizer_capability_token']) ? trim((string) wp_unslash($input['host_optimizer_capability_token'])) : (string) $current['host_optimizer_capability_token'],
        'anchor_enabled' => !empty($input['anchor_enabled']) ? 1 : 0,
        'anchor_api_base_url' => isset($input['anchor_api_base_url']) ? esc_url_raw(trim((string) $input['anchor_api_base_url'])) : (string) $current['anchor_api_base_url'],
        'anchor_api_token' => isset($input['anchor_api_token']) ? trim((string) wp_unslash($input['anchor_api_token'])) : (string) $current['anchor_api_token'],
        'anchor_retention_class' => $anchorRetention,
        'anchor_priority' => $anchorPriority,
        'anchor_force_ipfs_backup' => !empty($input['anchor_force_ipfs_backup']) ? 1 : 0,
        'plugin_instance_id' => isset($input['plugin_instance_id']) ? ai_wp_host_optimizer_sanitize_instance_id((string) $input['plugin_instance_id']) : (string) $current['plugin_instance_id'],
        'provider_name' => isset($input['provider_name']) ? sanitize_text_field((string) $input['provider_name']) : (string) $current['provider_name'],
        'region_label' => isset($input['region_label']) ? sanitize_text_field((string) $input['region_label']) : (string) $current['region_label'],
        'virtualization_os' => $virtualization,
        'cpu_model' => isset($input['cpu_model']) ? sanitize_text_field((string) $input['cpu_model']) : (string) $current['cpu_model'],
        'cpu_year' => isset($input['cpu_year']) ? sanitize_text_field((string) $input['cpu_year']) : (string) $current['cpu_year'],
        'ram_gb' => isset($input['ram_gb']) ? sanitize_text_field((string) $input['ram_gb']) : (string) $current['ram_gb'],
        'memory_class' => $memoryClass,
        'webserver_type' => $webserverType,
        'storage_type' => $storageType,
        'uplink_mbps' => $uplinkMbps,
        'gpu_acceleration_mode' => $gpuMode,
        'gpu_model' => isset($input['gpu_model']) ? sanitize_text_field((string) $input['gpu_model']) : (string) $current['gpu_model'],
        'gpu_count' => isset($input['gpu_count']) ? sanitize_text_field((string) $input['gpu_count']) : (string) $current['gpu_count'],
        'gpu_vram_gb' => isset($input['gpu_vram_gb']) ? sanitize_text_field((string) $input['gpu_vram_gb']) : (string) $current['gpu_vram_gb'],
        'gpu_effect_note' => isset($input['gpu_effect_note']) ? sanitize_text_field((string) $input['gpu_effect_note']) : (string) $current['gpu_effect_note'],
        'sample_interval_minutes' => $interval,
        'benchmark_iterations' => $iterations,
        'probe_hosts' => $probeHosts,
        'max_history' => $maxHistory,
    ];
}

function ai_wp_host_optimizer_register_settings(): void
{
    register_setting('ai_wp_host_optimizer', AI_WP_HOST_OPTIMIZER_OPTION_KEY, [
        'type' => 'array',
        'sanitize_callback' => 'ai_wp_host_optimizer_sanitize_settings',
        'default' => ai_wp_host_optimizer_default_settings(),
    ]);
}
add_action('admin_init', 'ai_wp_host_optimizer_register_settings');

function ai_wp_host_optimizer_cron_schedules(array $schedules): array
{
    $schedules['ai_wp_host_optimizer_5m'] = [
        'interval' => 5 * MINUTE_IN_SECONDS,
        'display' => 'Every 5 Minutes (AI Host Optimizer)',
    ];
    $schedules['ai_wp_host_optimizer_15m'] = [
        'interval' => 15 * MINUTE_IN_SECONDS,
        'display' => 'Every 15 Minutes (AI Host Optimizer)',
    ];
    $schedules['ai_wp_host_optimizer_30m'] = [
        'interval' => 30 * MINUTE_IN_SECONDS,
        'display' => 'Every 30 Minutes (AI Host Optimizer)',
    ];
    $schedules['ai_wp_host_optimizer_60m'] = [
        'interval' => HOUR_IN_SECONDS,
        'display' => 'Every 60 Minutes (AI Host Optimizer)',
    ];
    return $schedules;
}
add_filter('cron_schedules', 'ai_wp_host_optimizer_cron_schedules');

function ai_wp_host_optimizer_schedule_slug_from_interval(int $minutes): string
{
    if ($minutes <= 5) {
        return 'ai_wp_host_optimizer_5m';
    }
    if ($minutes <= 15) {
        return 'ai_wp_host_optimizer_15m';
    }
    if ($minutes <= 30) {
        return 'ai_wp_host_optimizer_30m';
    }
    return 'ai_wp_host_optimizer_60m';
}

function ai_wp_host_optimizer_unschedule_event(): void
{
    while ($timestamp = wp_next_scheduled(AI_WP_HOST_OPTIMIZER_CRON_HOOK)) {
        wp_unschedule_event($timestamp, AI_WP_HOST_OPTIMIZER_CRON_HOOK);
    }
}

function ai_wp_host_optimizer_sync_schedule(): void
{
    $settings = ai_wp_host_optimizer_get_settings();
    if (empty($settings['enabled'])) {
        ai_wp_host_optimizer_unschedule_event();
        return;
    }

    $minutes = (int) ($settings['sample_interval_minutes'] ?? 30);
    $schedule = ai_wp_host_optimizer_schedule_slug_from_interval($minutes);

    $event = function_exists('wp_get_scheduled_event') ? wp_get_scheduled_event(AI_WP_HOST_OPTIMIZER_CRON_HOOK) : null;
    if ($event && isset($event->schedule) && (string) $event->schedule !== $schedule) {
        ai_wp_host_optimizer_unschedule_event();
        $event = null;
    }

    if (!$event && !wp_next_scheduled(AI_WP_HOST_OPTIMIZER_CRON_HOOK)) {
        wp_schedule_event(time() + 90, $schedule, AI_WP_HOST_OPTIMIZER_CRON_HOOK);
    }
}
add_action('init', 'ai_wp_host_optimizer_sync_schedule');

function ai_wp_host_optimizer_on_settings_update($oldValue, $value, $option): void
{
    ai_wp_host_optimizer_sync_schedule();
}
add_action('update_option_' . AI_WP_HOST_OPTIMIZER_OPTION_KEY, 'ai_wp_host_optimizer_on_settings_update', 10, 3);

function ai_wp_host_optimizer_activate(): void
{
    $settings = ai_wp_host_optimizer_get_settings();
    update_option(AI_WP_HOST_OPTIMIZER_OPTION_KEY, $settings, false);
    ai_wp_host_optimizer_sync_schedule();
}
register_activation_hook(__FILE__, 'ai_wp_host_optimizer_activate');

function ai_wp_host_optimizer_deactivate(): void
{
    ai_wp_host_optimizer_unschedule_event();
}
register_deactivation_hook(__FILE__, 'ai_wp_host_optimizer_deactivate');

function ai_wp_host_optimizer_effective_plugin_id(array $settings): string
{
    $configured = ai_wp_host_optimizer_sanitize_instance_id((string) ($settings['plugin_instance_id'] ?? ''));
    if ($configured !== '') {
        return $configured;
    }
    $host = parse_url(home_url('/'), PHP_URL_HOST);
    if (is_string($host) && $host !== '') {
        return ai_wp_host_optimizer_sanitize_instance_id($host);
    }
    return 'wp-host-optimizer';
}

function ai_wp_host_optimizer_uuid_v4(): string
{
    if (function_exists('wp_generate_uuid4')) {
        $uuid = (string) wp_generate_uuid4();
        if ($uuid !== '') {
            return $uuid;
        }
    }
    try {
        $data = random_bytes(16);
    } catch (Exception $e) {
        $data = openssl_random_pseudo_bytes(16);
    }
    if (!is_string($data) || strlen($data) !== 16) {
        return '00000000-0000-4000-8000-000000000000';
    }
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    $hex = bin2hex($data);
    return sprintf(
        '%s-%s-%s-%s-%s',
        substr($hex, 0, 8),
        substr($hex, 8, 4),
        substr($hex, 12, 4),
        substr($hex, 16, 4),
        substr($hex, 20, 12)
    );
}

function ai_wp_host_optimizer_measure_http(string $url, int $timeout = 10): array
{
    $start = microtime(true);
    $response = wp_remote_get($url, [
        'timeout' => $timeout,
        'redirection' => 3,
        'headers' => [
            'Cache-Control' => 'no-cache',
        ],
    ]);
    $elapsed = (microtime(true) - $start) * 1000;

    if (is_wp_error($response)) {
        return [
            'ok' => false,
            'url' => $url,
            'ms' => round($elapsed, 2),
            'status' => 0,
            'error' => $response->get_error_message(),
        ];
    }

    return [
        'ok' => true,
        'url' => $url,
        'ms' => round($elapsed, 2),
        'status' => (int) wp_remote_retrieve_response_code($response),
    ];
}

function ai_wp_host_optimizer_cpu_benchmark(int $iterations): array
{
    $iterations = max(10000, min(2000000, $iterations));
    $seed = function_exists('wp_generate_uuid4') ? wp_generate_uuid4() : uniqid('seed', true);

    $start = microtime(true);
    $hash = '';
    for ($i = 0; $i < $iterations; $i++) {
        $hash = hash('sha256', $hash . $seed . $i);
    }
    $elapsed = (microtime(true) - $start) * 1000;
    $opsPerSec = $elapsed > 0 ? ($iterations / ($elapsed / 1000)) : 0;

    return [
        'iterations' => $iterations,
        'elapsed_ms' => round($elapsed, 2),
        'ops_per_sec' => (int) round($opsPerSec),
        'checksum_tail' => substr($hash, -12),
    ];
}

function ai_wp_host_optimizer_disk_benchmark(): array
{
    $uploads = wp_upload_dir();
    if (!empty($uploads['error'])) {
        return [
            'ok' => false,
            'error' => sanitize_text_field((string) $uploads['error']),
        ];
    }

    $dir = trailingslashit((string) $uploads['basedir']) . 'ai-host-optimizer';
    wp_mkdir_p($dir);
    $file = trailingslashit($dir) . 'bench-' . uniqid('', true) . '.bin';

    try {
        $blob = random_bytes(262144);
    } catch (Exception $e) {
        $blob = str_repeat('a', 262144);
    }

    $startWrite = microtime(true);
    $written = @file_put_contents($file, $blob, LOCK_EX);
    $writeMs = (microtime(true) - $startWrite) * 1000;

    if ($written === false) {
        return [
            'ok' => false,
            'error' => 'disk_write_failed',
        ];
    }

    $startRead = microtime(true);
    $readBlob = @file_get_contents($file);
    $readMs = (microtime(true) - $startRead) * 1000;
    @unlink($file);

    if ($readBlob === false) {
        return [
            'ok' => false,
            'error' => 'disk_read_failed',
        ];
    }

    $sizeMb = ((int) $written) / 1048576;
    $writeMbPerSec = $writeMs > 0 ? $sizeMb / ($writeMs / 1000) : 0;
    $readMbPerSec = $readMs > 0 ? $sizeMb / ($readMs / 1000) : 0;

    return [
        'ok' => true,
        'bytes' => (int) $written,
        'write_ms' => round($writeMs, 2),
        'read_ms' => round($readMs, 2),
        'write_mb_per_sec' => round($writeMbPerSec, 2),
        'read_mb_per_sec' => round($readMbPerSec, 2),
    ];
}

function ai_wp_host_optimizer_parse_probe_targets(string $raw): array
{
    $targets = [];
    $lines = preg_split('/\r\n|\r|\n/', $raw);
    if (!is_array($lines)) {
        return $targets;
    }

    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '') {
            continue;
        }
        $parts = explode(':', $line);
        $host = sanitize_text_field((string) $parts[0]);
        $port = isset($parts[1]) ? (int) $parts[1] : 443;
        if ($host === '' || $port <= 0 || $port > 65535) {
            continue;
        }
        $targets[] = [
            'host' => $host,
            'port' => $port,
        ];
    }

    return array_slice($targets, 0, 25);
}

function ai_wp_host_optimizer_tcp_connect_probe(string $host, int $port, float $timeout = 1.5): array
{
    $start = microtime(true);
    $errno = 0;
    $errstr = '';
    $socket = @fsockopen($host, $port, $errno, $errstr, $timeout);
    $elapsed = (microtime(true) - $start) * 1000;
    if ($socket === false) {
        return [
            'ok' => false,
            'host' => $host,
            'port' => $port,
            'ms' => round($elapsed, 2),
            'error' => trim($errstr) !== '' ? trim($errstr) : ('errno_' . $errno),
        ];
    }
    fclose($socket);
    return [
        'ok' => true,
        'host' => $host,
        'port' => $port,
        'ms' => round($elapsed, 2),
    ];
}

function ai_wp_host_optimizer_detect_cpu_model(): string
{
    $model = '';
    if (is_readable('/proc/cpuinfo')) {
        $cpuInfo = (string) @file_get_contents('/proc/cpuinfo');
        if (preg_match('/model name\s*:\s*(.+)/i', $cpuInfo, $matches)) {
            $model = trim((string) ($matches[1] ?? ''));
        }
    }
    if ($model === '') {
        $model = php_uname('m');
    }
    return sanitize_text_field($model);
}

function ai_wp_host_optimizer_detect_cpu_cores(): int
{
    if (is_readable('/proc/cpuinfo')) {
        $cpuInfo = (string) @file_get_contents('/proc/cpuinfo');
        if ($cpuInfo !== '') {
            $count = preg_match_all('/^processor\s*:/m', $cpuInfo, $matches);
            if (is_int($count) && $count > 0) {
                return $count;
            }
        }
    }
    return 1;
}

function ai_wp_host_optimizer_detect_hypervisor_hint(): string
{
    if (is_readable('/proc/cpuinfo')) {
        $cpuInfo = strtolower((string) @file_get_contents('/proc/cpuinfo'));
        if (strpos($cpuInfo, 'vmware') !== false) {
            return 'vmware';
        }
        if (strpos($cpuInfo, 'kvm') !== false) {
            return 'kvm';
        }
        if (strpos($cpuInfo, 'hypervisor') !== false) {
            return 'hypervisor_detected';
        }
    }
    return 'unknown';
}

function ai_wp_host_optimizer_detect_memory_stats(): array
{
    $stats = [
        'mem_total_mb' => 0.0,
        'mem_available_mb' => 0.0,
        'swap_total_mb' => 0.0,
        'swap_free_mb' => 0.0,
    ];
    if (!is_readable('/proc/meminfo')) {
        return $stats;
    }

    $content = (string) @file_get_contents('/proc/meminfo');
    if ($content === '') {
        return $stats;
    }

    $map = [
        'mem_total_mb' => 'MemTotal',
        'mem_available_mb' => 'MemAvailable',
        'swap_total_mb' => 'SwapTotal',
        'swap_free_mb' => 'SwapFree',
    ];
    foreach ($map as $target => $source) {
        if (preg_match('/^' . preg_quote($source, '/') . ':\s+([0-9]+)\s+kB/im', $content, $matches)) {
            $stats[$target] = round(((float) $matches[1]) / 1024, 2);
        }
    }
    return $stats;
}

function ai_wp_host_optimizer_signed_export(array $settings, array $payload): array
{
    $baseUrl = trim((string) ($settings['worker_base_url'] ?? ''));
    $secret = trim((string) ($settings['plugin_shared_secret'] ?? ''));
    $capabilityToken = trim((string) ($settings['host_optimizer_capability_token'] ?? ''));
    if ($baseUrl === '' || $secret === '' || $capabilityToken === '') {
        return [
            'ok' => false,
            'skipped' => true,
            'reason' => 'missing_worker_or_capability_config',
        ];
    }

    $path = '/plugin/wp/host-optimizer/baseline';
    $url = trailingslashit($baseUrl) . 'plugin/wp/host-optimizer/baseline';
    $timestamp = (string) time();
    $nonce = ai_wp_host_optimizer_uuid_v4();
    $body = wp_json_encode($payload);
    if (!is_string($body)) {
        return [
            'ok' => false,
            'skipped' => true,
            'reason' => 'encode_failed',
        ];
    }
    $bodyHash = hash('sha256', $body);
    $canonical = $timestamp . '.' . $nonce . '.POST.' . $path . '.' . $bodyHash;
    $signature = hash_hmac('sha256', $canonical, $secret);

    $response = wp_remote_post($url, [
        'timeout' => 20,
        'headers' => [
            'Content-Type' => 'application/json',
            'X-Plugin-Id' => ai_wp_host_optimizer_effective_plugin_id($settings),
            'X-Plugin-Timestamp' => $timestamp,
            'X-Plugin-Nonce' => $nonce,
            'X-Plugin-Signature' => $signature,
            'X-Capability-Token' => $capabilityToken,
            'Idempotency-Key' => ai_wp_host_optimizer_uuid_v4(),
        ],
        'body' => $body,
    ]);

    if (is_wp_error($response)) {
        return [
            'ok' => false,
            'status' => 0,
            'error' => $response->get_error_message(),
        ];
    }

    $status = (int) wp_remote_retrieve_response_code($response);
    $responseBody = (string) wp_remote_retrieve_body($response);
    return [
        'ok' => ($status >= 200 && $status < 300),
        'status' => $status,
        'response_preview' => substr(sanitize_text_field($responseBody), 0, 180),
    ];
}

function ai_wp_host_optimizer_anchor_store_sample(array $settings, array $sample): array
{
    if (empty($settings['anchor_enabled'])) {
        return [
            'ok' => false,
            'skipped' => true,
            'reason' => 'anchor_disabled',
        ];
    }

    $baseUrl = trim((string) ($settings['anchor_api_base_url'] ?? ''));
    $apiToken = trim((string) ($settings['anchor_api_token'] ?? ''));
    if ($baseUrl === '' || $apiToken === '') {
        return [
            'ok' => false,
            'skipped' => true,
            'reason' => 'missing_anchor_config',
        ];
    }

    $payloadJson = wp_json_encode($sample);
    if (!is_string($payloadJson)) {
        return [
            'ok' => false,
            'skipped' => true,
            'reason' => 'sample_encode_failed',
        ];
    }

    $pluginId = ai_wp_host_optimizer_effective_plugin_id($settings);
    $timestamp = gmdate('Ymd-His');
    $hashSuffix = substr(hash('sha256', $payloadJson), 0, 12);
    $objectKey = sprintf(
        'host-optimizer/%s/%s-%s-%s.json',
        gmdate('Y/m/d'),
        $pluginId,
        $timestamp,
        $hashSuffix
    );

    $priority = ((string) ($settings['anchor_priority'] ?? 'standard')) === 'high' ? 'high' : 'standard';
    $retentionClass = (string) ($settings['anchor_retention_class'] ?? 'balanced');
    if (!in_array($retentionClass, ['hot', 'balanced', 'cold'], true)) {
        $retentionClass = 'balanced';
    }

    $requestBody = wp_json_encode([
        'object_key' => $objectKey,
        'content_base64' => base64_encode($payloadJson),
        'content_type' => 'application/json',
        'priority' => $priority,
        'retention_class' => $retentionClass,
        'force_ipfs_backup' => !empty($settings['anchor_force_ipfs_backup']),
        'metadata' => [
            'source' => 'ai_wp_host_optimizer',
            'plugin_id' => $pluginId,
            'captured_at' => (string) ($sample['captured_at'] ?? ''),
            'site_url' => (string) ($sample['site_url'] ?? ''),
            'region_label' => (string) (($sample['profile']['region_label'] ?? '')),
            'provider_name' => (string) (($sample['profile']['provider_name'] ?? '')),
        ],
    ]);
    if (!is_string($requestBody)) {
        return [
            'ok' => false,
            'skipped' => true,
            'reason' => 'request_encode_failed',
        ];
    }

    $url = trailingslashit($baseUrl) . 'anchor/store';
    $response = wp_remote_post($url, [
        'timeout' => 25,
        'headers' => [
            'Content-Type' => 'application/json',
            'Authorization' => 'Bearer ' . $apiToken,
        ],
        'body' => $requestBody,
    ]);

    if (is_wp_error($response)) {
        return [
            'ok' => false,
            'status' => 0,
            'error' => $response->get_error_message(),
        ];
    }

    $status = (int) wp_remote_retrieve_response_code($response);
    $responseBody = (string) wp_remote_retrieve_body($response);
    $decoded = json_decode($responseBody, true);

    return [
        'ok' => ($status >= 200 && $status < 300),
        'status' => $status,
        'object_id' => is_array($decoded) ? (string) ($decoded['object_id'] ?? '') : '',
        'object_key' => is_array($decoded) ? (string) ($decoded['object_key'] ?? '') : '',
        'task_count' => is_array($decoded) ? (int) ($decoded['task_count'] ?? 0) : 0,
        'response_preview' => substr(sanitize_text_field($responseBody), 0, 180),
    ];
}

function ai_wp_host_optimizer_collect_baseline(string $reason = 'manual'): array
{
    $settings = ai_wp_host_optimizer_get_settings();
    $benchmarkIterations = (int) ($settings['benchmark_iterations'] ?? 250000);
    $probeTargets = ai_wp_host_optimizer_parse_probe_targets((string) ($settings['probe_hosts'] ?? ''));
    $loadAvg = function_exists('sys_getloadavg') ? (array) sys_getloadavg() : [];
    $memoryStats = ai_wp_host_optimizer_detect_memory_stats();
    $memUsedMb = max(0.0, (float) $memoryStats['mem_total_mb'] - (float) $memoryStats['mem_available_mb']);
    $memUsedPct = (float) $memoryStats['mem_total_mb'] > 0 ? ($memUsedMb / (float) $memoryStats['mem_total_mb']) * 100 : 0.0;
    $swapUsedMb = max(0.0, (float) $memoryStats['swap_total_mb'] - (float) $memoryStats['swap_free_mb']);
    $swapUsedPct = (float) $memoryStats['swap_total_mb'] > 0 ? ($swapUsedMb / (float) $memoryStats['swap_total_mb']) * 100 : 0.0;
    $memoryPressure = min(100.0, max(0.0, ($memUsedPct * 0.7) + ($swapUsedPct * 0.3)));

    $sample = [
        'ok' => true,
        'captured_at' => gmdate('c'),
        'reason' => sanitize_text_field($reason),
        'plugin' => 'ai_wp_host_optimizer',
        'plugin_id' => ai_wp_host_optimizer_effective_plugin_id($settings),
        'site_url' => home_url('/'),
        'profile' => [
            'provider_name' => (string) $settings['provider_name'],
            'region_label' => (string) $settings['region_label'],
            'virtualization_os' => (string) $settings['virtualization_os'],
            'cpu_model' => (string) ($settings['cpu_model'] !== '' ? $settings['cpu_model'] : ai_wp_host_optimizer_detect_cpu_model()),
            'cpu_year' => (string) $settings['cpu_year'],
            'ram_gb' => (string) $settings['ram_gb'],
            'memory_class' => (string) $settings['memory_class'],
            'webserver_type' => (string) $settings['webserver_type'],
            'storage_type' => (string) $settings['storage_type'],
            'uplink_mbps' => (string) $settings['uplink_mbps'],
            'gpu_acceleration_mode' => (string) $settings['gpu_acceleration_mode'],
            'gpu_model' => (string) $settings['gpu_model'],
            'gpu_count' => (string) $settings['gpu_count'],
            'gpu_vram_gb' => (string) $settings['gpu_vram_gb'],
            'gpu_effect_note' => (string) $settings['gpu_effect_note'],
            'detected_cpu_cores' => ai_wp_host_optimizer_detect_cpu_cores(),
            'detected_hypervisor_hint' => ai_wp_host_optimizer_detect_hypervisor_hint(),
            'php_version' => PHP_VERSION,
            'wp_version' => get_bloginfo('version'),
            'memory_limit' => (string) ini_get('memory_limit'),
            'server_software' => isset($_SERVER['SERVER_SOFTWARE']) ? sanitize_text_field((string) $_SERVER['SERVER_SOFTWARE']) : '',
            'machine_arch' => php_uname('m'),
            'os' => PHP_OS,
            'detected_mem_total_mb' => (float) $memoryStats['mem_total_mb'],
            'detected_mem_available_mb' => (float) $memoryStats['mem_available_mb'],
            'detected_swap_total_mb' => (float) $memoryStats['swap_total_mb'],
            'detected_swap_used_mb' => $swapUsedMb,
            'load_avg_1m' => isset($loadAvg[0]) ? (float) $loadAvg[0] : 0.0,
            'load_avg_5m' => isset($loadAvg[1]) ? (float) $loadAvg[1] : 0.0,
            'load_avg_15m' => isset($loadAvg[2]) ? (float) $loadAvg[2] : 0.0,
        ],
        'metrics' => [
            'home_ttfb' => ai_wp_host_optimizer_measure_http(home_url('/'), 12),
            'rest_ttfb' => ai_wp_host_optimizer_measure_http(home_url('/wp-json/'), 12),
            'cpu_benchmark' => ai_wp_host_optimizer_cpu_benchmark($benchmarkIterations),
            'disk_benchmark' => ai_wp_host_optimizer_disk_benchmark(),
            'tcp_connect_probes' => [],
            'memory' => [
                'php_memory_usage_mb' => round(memory_get_usage(true) / 1048576, 2),
                'php_memory_peak_mb' => round(memory_get_peak_usage(true) / 1048576, 2),
                'mem_used_percent' => round($memUsedPct, 2),
                'swap_used_percent' => round($swapUsedPct, 2),
                'pressure_score' => round($memoryPressure, 2),
            ],
        ],
        'worker_export' => [
            'ok' => false,
            'skipped' => true,
            'reason' => 'not_attempted',
        ],
        'anchor_export' => [
            'ok' => false,
            'skipped' => true,
            'reason' => 'not_attempted',
        ],
    ];

    foreach ($probeTargets as $target) {
        $sample['metrics']['tcp_connect_probes'][] = ai_wp_host_optimizer_tcp_connect_probe(
            (string) $target['host'],
            (int) $target['port']
        );
    }

    $sample['worker_export'] = ai_wp_host_optimizer_signed_export($settings, $sample);
    $sample['anchor_export'] = ai_wp_host_optimizer_anchor_store_sample($settings, $sample);

    update_option(AI_WP_HOST_OPTIMIZER_LAST_SAMPLE_OPTION, $sample, false);
    $history = get_option(AI_WP_HOST_OPTIMIZER_HISTORY_OPTION, []);
    if (!is_array($history)) {
        $history = [];
    }
    $history[] = $sample;
    $maxHistory = max(20, min(1000, (int) ($settings['max_history'] ?? 240)));
    if (count($history) > $maxHistory) {
        $history = array_slice($history, -$maxHistory);
    }
    update_option(AI_WP_HOST_OPTIMIZER_HISTORY_OPTION, $history, false);

    return $sample;
}

function ai_wp_host_optimizer_collect_cron(): void
{
    $settings = ai_wp_host_optimizer_get_settings();
    if (empty($settings['enabled'])) {
        return;
    }
    ai_wp_host_optimizer_collect_baseline('scheduled');
}
add_action(AI_WP_HOST_OPTIMIZER_CRON_HOOK, 'ai_wp_host_optimizer_collect_cron');

function ai_wp_host_optimizer_admin_menu(): void
{
    add_options_page(
        'AI WP Host Optimizer',
        'AI WP Host Optimizer',
        'manage_options',
        'ai-wp-host-optimizer',
        'ai_wp_host_optimizer_render_settings_page'
    );
}
add_action('admin_menu', 'ai_wp_host_optimizer_admin_menu');

function ai_wp_host_optimizer_render_settings_page(): void
{
    if (!current_user_can('manage_options')) {
        return;
    }

    if (isset($_POST['ai_wp_host_optimizer_run_now'])) {
        check_admin_referer('ai_wp_host_optimizer_run_now');
        $sample = ai_wp_host_optimizer_collect_baseline('manual_admin');
        add_settings_error(
            'ai_wp_host_optimizer',
            'ai_wp_host_optimizer_run_now',
            'Baseline captured at ' . esc_html((string) ($sample['captured_at'] ?? 'unknown')),
            'updated'
        );
    }

    settings_errors('ai_wp_host_optimizer');
    $settings = ai_wp_host_optimizer_get_settings();
    $last = get_option(AI_WP_HOST_OPTIMIZER_LAST_SAMPLE_OPTION, []);
    if (!is_array($last)) {
        $last = [];
    }
    ?>
    <div class="wrap">
      <h1>AI WP Host Optimizer Plugin</h1>
      <p>Capture host-level baselines (speed + hardware profile) to compare VPS plans and location performance.</p>
      <form method="post" action="options.php">
        <?php settings_fields('ai_wp_host_optimizer'); ?>
        <table class="form-table" role="presentation">
          <tr>
            <th scope="row">Enable baseline collection</th>
            <td><label><input type="checkbox" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[enabled]" value="1" <?php checked((int) $settings['enabled'], 1); ?> /> Enabled</label></td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_provider_name">Provider / Fleet Name</label></th>
            <td><input id="ai_wp_host_optimizer_provider_name" class="regular-text" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[provider_name]" type="text" value="<?php echo esc_attr((string) $settings['provider_name']); ?>" /></td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_region_label">Region Label</label></th>
            <td><input id="ai_wp_host_optimizer_region_label" class="regular-text" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[region_label]" type="text" value="<?php echo esc_attr((string) $settings['region_label']); ?>" />
              <p class="description">Example: North America / West Coast / Los Angeles.</p>
            </td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_virtualization_os">Virtualization / OS</label></th>
            <td>
              <select id="ai_wp_host_optimizer_virtualization_os" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[virtualization_os]">
                <?php
                $virtualizationOptions = ['proxmox' => 'Proxmox', 'esxi' => 'ESXi', 'kvm' => 'KVM', 'bare_metal' => 'Bare Metal', 'other' => 'Other'];
                foreach ($virtualizationOptions as $value => $label) {
                    echo '<option value="' . esc_attr($value) . '" ' . selected((string) $settings['virtualization_os'], $value, false) . '>' . esc_html($label) . '</option>';
                }
                ?>
              </select>
            </td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_cpu_model">CPU Model (manual override)</label></th>
            <td><input id="ai_wp_host_optimizer_cpu_model" class="regular-text" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[cpu_model]" type="text" value="<?php echo esc_attr((string) $settings['cpu_model']); ?>" /></td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_cpu_year">CPU Year</label></th>
            <td><input id="ai_wp_host_optimizer_cpu_year" class="small-text" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[cpu_year]" type="text" value="<?php echo esc_attr((string) $settings['cpu_year']); ?>" /></td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_ram_gb">RAM (GB)</label></th>
            <td><input id="ai_wp_host_optimizer_ram_gb" class="small-text" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[ram_gb]" type="text" value="<?php echo esc_attr((string) $settings['ram_gb']); ?>" /></td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_memory_class">Memory Class</label></th>
            <td>
              <select id="ai_wp_host_optimizer_memory_class" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[memory_class]">
                <?php
                $memoryClassOptions = ['ECC_DDR3', 'ECC_DDR4', 'ECC_DDR5', 'ECC_DDR6', 'ECC_DDR7', 'NON_ECC', 'UNKNOWN'];
                foreach ($memoryClassOptions as $memoryClass) {
                    echo '<option value="' . esc_attr($memoryClass) . '" ' . selected((string) $settings['memory_class'], $memoryClass, false) . '>' . esc_html($memoryClass) . '</option>';
                }
                ?>
              </select>
            </td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_webserver_type">Webserver Type</label></th>
            <td>
              <select id="ai_wp_host_optimizer_webserver_type" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[webserver_type]">
                <?php
                $webserverOptions = [
                    'nginx_php_fpm' => 'NGINX + PHP-FPM',
                    'apache_event' => 'Apache Event MPM',
                    'apache_prefork' => 'Apache Prefork MPM',
                    'litespeed' => 'LiteSpeed',
                    'caddy_php_fpm' => 'Caddy + PHP-FPM',
                    'other' => 'Other',
                ];
                foreach ($webserverOptions as $value => $label) {
                    echo '<option value="' . esc_attr($value) . '" ' . selected((string) $settings['webserver_type'], $value, false) . '>' . esc_html($label) . '</option>';
                }
                ?>
              </select>
            </td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_storage_type">Storage Type</label></th>
            <td>
              <select id="ai_wp_host_optimizer_storage_type" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[storage_type]">
                <?php
                $storageOptions = ['nvme' => 'NVMe', 'ssd' => 'SSD', 'hdd' => 'HDD', 'other' => 'Other'];
                foreach ($storageOptions as $value => $label) {
                    echo '<option value="' . esc_attr($value) . '" ' . selected((string) $settings['storage_type'], $value, false) . '>' . esc_html($label) . '</option>';
                }
                ?>
              </select>
            </td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_uplink_mbps">Uplink (Mbps)</label></th>
            <td>
              <select id="ai_wp_host_optimizer_uplink_mbps" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[uplink_mbps]">
                <?php
                $uplinkOptions = ['100' => '100', '1000' => '1,000', '2500' => '2,500', '5000' => '5,000', '10000' => '10,000', '25000' => '25,000', '40000' => '40,000', 'other' => 'Other'];
                foreach ($uplinkOptions as $value => $label) {
                    echo '<option value="' . esc_attr($value) . '" ' . selected((string) $settings['uplink_mbps'], $value, false) . '>' . esc_html($label) . '</option>';
                }
                ?>
              </select>
            </td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_gpu_acceleration_mode">GPU Acceleration Mode</label></th>
            <td>
              <select id="ai_wp_host_optimizer_gpu_acceleration_mode" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[gpu_acceleration_mode]">
                <?php
                $gpuModeOptions = ['none' => 'None', 'cuda' => 'CUDA', 'rocm' => 'ROCm', 'opencl' => 'OpenCL', 'other' => 'Other'];
                foreach ($gpuModeOptions as $value => $label) {
                    echo '<option value="' . esc_attr($value) . '" ' . selected((string) $settings['gpu_acceleration_mode'], $value, false) . '>' . esc_html($label) . '</option>';
                }
                ?>
              </select>
            </td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_gpu_model">GPU Model</label></th>
            <td><input id="ai_wp_host_optimizer_gpu_model" class="regular-text" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[gpu_model]" type="text" value="<?php echo esc_attr((string) $settings['gpu_model']); ?>" /></td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_gpu_count">GPU Count</label></th>
            <td><input id="ai_wp_host_optimizer_gpu_count" class="small-text" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[gpu_count]" type="text" value="<?php echo esc_attr((string) $settings['gpu_count']); ?>" /></td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_gpu_vram_gb">GPU VRAM (GB)</label></th>
            <td><input id="ai_wp_host_optimizer_gpu_vram_gb" class="small-text" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[gpu_vram_gb]" type="text" value="<?php echo esc_attr((string) $settings['gpu_vram_gb']); ?>" /></td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_gpu_effect_note">GPU Effect Note</label></th>
            <td><input id="ai_wp_host_optimizer_gpu_effect_note" class="regular-text" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[gpu_effect_note]" type="text" value="<?php echo esc_attr((string) $settings['gpu_effect_note']); ?>" /></td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_sample_interval">Sample Interval (minutes)</label></th>
            <td>
              <select id="ai_wp_host_optimizer_sample_interval" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[sample_interval_minutes]">
                <?php
                $intervalOptions = [5, 15, 30, 60];
                foreach ($intervalOptions as $interval) {
                    echo '<option value="' . esc_attr((string) $interval) . '" ' . selected((int) $settings['sample_interval_minutes'], $interval, false) . '>' . esc_html((string) $interval) . '</option>';
                }
                ?>
              </select>
            </td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_benchmark_iterations">CPU Benchmark Iterations</label></th>
            <td><input id="ai_wp_host_optimizer_benchmark_iterations" class="small-text" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[benchmark_iterations]" type="number" min="10000" max="2000000" value="<?php echo esc_attr((string) $settings['benchmark_iterations']); ?>" /></td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_probe_hosts">TCP Probe Targets</label></th>
            <td>
              <textarea id="ai_wp_host_optimizer_probe_hosts" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[probe_hosts]" rows="4" class="large-text code"><?php echo esc_textarea((string) $settings['probe_hosts']); ?></textarea>
              <p class="description">One target per line in <code>host:port</code> format. Used for quick outbound latency samples.</p>
            </td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_worker_base_url">Worker Base URL</label></th>
            <td><input id="ai_wp_host_optimizer_worker_base_url" class="regular-text" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[worker_base_url]" type="url" value="<?php echo esc_attr((string) $settings['worker_base_url']); ?>" /></td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_plugin_shared_secret">Plugin Shared Secret</label></th>
            <td><input id="ai_wp_host_optimizer_plugin_shared_secret" class="regular-text" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[plugin_shared_secret]" type="text" value="<?php echo esc_attr((string) $settings['plugin_shared_secret']); ?>" /></td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_capability_token">Host Optimizer Capability Token</label></th>
            <td><input id="ai_wp_host_optimizer_capability_token" class="regular-text" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[host_optimizer_capability_token]" type="text" value="<?php echo esc_attr((string) $settings['host_optimizer_capability_token']); ?>" /></td>
          </tr>
          <tr>
            <th scope="row">Enable Anchor Storage</th>
            <td><label><input type="checkbox" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[anchor_enabled]" value="1" <?php checked((int) $settings['anchor_enabled'], 1); ?> /> Push baseline artifacts to Anchor API (R2/B2/IPFS policy)</label></td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_anchor_api_base_url">Anchor API Base URL</label></th>
            <td><input id="ai_wp_host_optimizer_anchor_api_base_url" class="regular-text" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[anchor_api_base_url]" type="url" value="<?php echo esc_attr((string) $settings['anchor_api_base_url']); ?>" /></td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_anchor_api_token">Anchor API Token</label></th>
            <td><input id="ai_wp_host_optimizer_anchor_api_token" class="regular-text" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[anchor_api_token]" type="text" value="<?php echo esc_attr((string) $settings['anchor_api_token']); ?>" /></td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_anchor_retention">Anchor Retention Class</label></th>
            <td>
              <select id="ai_wp_host_optimizer_anchor_retention" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[anchor_retention_class]">
                <?php
                $anchorRetentionOptions = ['hot' => 'Hot', 'balanced' => 'Balanced', 'cold' => 'Cold'];
                foreach ($anchorRetentionOptions as $value => $label) {
                    echo '<option value="' . esc_attr($value) . '" ' . selected((string) $settings['anchor_retention_class'], $value, false) . '>' . esc_html($label) . '</option>';
                }
                ?>
              </select>
            </td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_anchor_priority">Anchor Priority</label></th>
            <td>
              <select id="ai_wp_host_optimizer_anchor_priority" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[anchor_priority]">
                <?php
                $anchorPriorityOptions = ['standard' => 'Standard', 'high' => 'High'];
                foreach ($anchorPriorityOptions as $value => $label) {
                    echo '<option value="' . esc_attr($value) . '" ' . selected((string) $settings['anchor_priority'], $value, false) . '>' . esc_html($label) . '</option>';
                }
                ?>
              </select>
            </td>
          </tr>
          <tr>
            <th scope="row">Force IPFS Backup</th>
            <td><label><input type="checkbox" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[anchor_force_ipfs_backup]" value="1" <?php checked((int) $settings['anchor_force_ipfs_backup'], 1); ?> /> Request IPFS backup through anchor policy when available</label></td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_plugin_instance_id">Plugin Instance ID</label></th>
            <td><input id="ai_wp_host_optimizer_plugin_instance_id" class="regular-text" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[plugin_instance_id]" type="text" value="<?php echo esc_attr((string) $settings['plugin_instance_id']); ?>" /></td>
          </tr>
          <tr>
            <th scope="row"><label for="ai_wp_host_optimizer_max_history">Max Stored Samples</label></th>
            <td><input id="ai_wp_host_optimizer_max_history" class="small-text" name="<?php echo esc_attr(AI_WP_HOST_OPTIMIZER_OPTION_KEY); ?>[max_history]" type="number" min="20" max="1000" value="<?php echo esc_attr((string) $settings['max_history']); ?>" /></td>
          </tr>
        </table>
        <?php submit_button('Save Host Optimizer Settings'); ?>
      </form>

      <form method="post" action="">
        <?php wp_nonce_field('ai_wp_host_optimizer_run_now'); ?>
        <p><?php submit_button('Run Baseline Now', 'secondary', 'ai_wp_host_optimizer_run_now', false); ?></p>
      </form>

      <h2>Latest Baseline</h2>
      <?php if (!empty($last)) : ?>
        <pre style="max-height: 380px; overflow: auto; background: #fff; border: 1px solid #ccd0d4; padding: 12px;"><?php echo esc_html((string) wp_json_encode($last, JSON_PRETTY_PRINT)); ?></pre>
      <?php else : ?>
        <p>No baseline has been captured yet.</p>
      <?php endif; ?>
    </div>
    <?php
}

function ai_wp_host_optimizer_rest_latest(WP_REST_Request $request): WP_REST_Response
{
    $last = get_option(AI_WP_HOST_OPTIMIZER_LAST_SAMPLE_OPTION, []);
    if (!is_array($last)) {
        $last = [];
    }
    return new WP_REST_Response([
        'ok' => true,
        'sample' => $last,
    ]);
}

function ai_wp_host_optimizer_register_rest_routes(): void
{
    register_rest_route('ai-host-optimizer/v1', '/latest', [
        'methods' => 'GET',
        'callback' => 'ai_wp_host_optimizer_rest_latest',
        'permission_callback' => static function () {
            return current_user_can('manage_options');
        },
    ]);
}
add_action('rest_api_init', 'ai_wp_host_optimizer_register_rest_routes');
