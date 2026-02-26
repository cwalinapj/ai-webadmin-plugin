<?php
/**
 * Plugin Name: DDNS Toll Comments
 * Description: Requires a refundable off-chain credit hold before comments are accepted.
 * Version: 0.2.0
 * Author: DECENTRALIZED-DNS
 * Text Domain: ddns-toll-comments
 */

if (!defined('ABSPATH')) {
    exit;
}

define('DDNS_TOLL_COMMENTS_VERSION', '0.2.0');

define('DDNS_TOLL_COMMENTS_PATH', plugin_dir_path(__FILE__));

define('DDNS_TOLL_COMMENTS_URL', plugin_dir_url(__FILE__));

define('DDNS_TOLL_COMMENTS_HOLD_TTL', 15 * MINUTE_IN_SECONDS);

define('DDNS_TOLL_COMMENTS_DEFAULT_COORDINATOR', 'http://localhost:8054');

if (!defined('DDNS_TOLL_COMMENTS_MOCK_MODE')) {
    define('DDNS_TOLL_COMMENTS_MOCK_MODE', false);
}

register_activation_hook(__FILE__, 'ddns_toll_comments_activate');
register_deactivation_hook(__FILE__, 'ddns_toll_comments_deactivate');

function ddns_toll_comments_activate(): void
{
    if (!wp_next_scheduled('ddns_toll_comments_node_cron')) {
        wp_schedule_event(time() + 60, 'ddns_five_minutes', 'ddns_toll_comments_node_cron');
    }
}

function ddns_toll_comments_deactivate(): void
{
    wp_clear_scheduled_hook('ddns_toll_comments_node_cron');
}

function ddns_toll_comments_cron_schedules(array $schedules): array
{
    if (!isset($schedules['ddns_five_minutes'])) {
        $schedules['ddns_five_minutes'] = array(
            'interval' => 5 * MINUTE_IN_SECONDS,
            'display' => 'Every 5 minutes',
        );
    }
    return $schedules;
}
add_filter('cron_schedules', 'ddns_toll_comments_cron_schedules');

function ddns_toll_comments_is_enabled(): bool
{
    return (bool) get_option('ddns_toll_comments_enabled', false);
}

function ddns_toll_comments_register_settings(): void
{
    register_setting('ddns_toll_comments', 'ddns_toll_comments_enabled', array(
        'type' => 'boolean',
        'sanitize_callback' => 'rest_sanitize_boolean',
        'default' => false,
    ));

    register_setting('ddns_toll_comments', 'ddns_toll_comments_coordinator_url', array(
        'type' => 'string',
        'sanitize_callback' => 'esc_url_raw',
        'default' => DDNS_TOLL_COMMENTS_DEFAULT_COORDINATOR,
    ));

    register_setting('ddns_toll_comments', 'ddns_toll_comments_site_id', array(
        'type' => 'string',
        'sanitize_callback' => 'sanitize_text_field',
        'default' => 'site-1',
    ));

    register_setting('ddns_toll_comments', 'ddns_toll_comments_site_token', array(
        'type' => 'string',
        'sanitize_callback' => 'sanitize_text_field',
        'default' => '',
    ));

    register_setting('ddns_toll_comments', 'ddns_toll_comments_currency_type', array(
        'type' => 'string',
        'sanitize_callback' => 'sanitize_text_field',
        'default' => 'credits',
    ));

    register_setting('ddns_toll_comments', 'ddns_toll_comments_currency_code', array(
        'type' => 'string',
        'sanitize_callback' => 'sanitize_text_field',
        'default' => 'TOLL',
    ));

    register_setting('ddns_toll_comments', 'ddns_toll_comments_toll_amount', array(
        'type' => 'integer',
        'sanitize_callback' => 'absint',
        'default' => 1,
    ));

    register_setting('ddns_toll_comments', 'ddns_toll_comments_bonus_enabled', array(
        'type' => 'boolean',
        'sanitize_callback' => 'rest_sanitize_boolean',
        'default' => false,
    ));

    register_setting('ddns_toll_comments', 'ddns_toll_comments_bonus_multiplier', array(
        'type' => 'integer',
        'sanitize_callback' => 'absint',
        'default' => 2,
    ));

    register_setting('ddns_toll_comments', 'ddns_toll_comments_exempt_roles', array(
        'type' => 'string',
        'sanitize_callback' => 'sanitize_text_field',
        'default' => '',
    ));

    register_setting('ddns_toll_comments', 'ddns_toll_comments_exempt_users', array(
        'type' => 'string',
        'sanitize_callback' => 'sanitize_text_field',
        'default' => '',
    ));

    register_setting('ddns_toll_comments', 'ddns_toll_comments_free_high_rep', array(
        'type' => 'boolean',
        'sanitize_callback' => 'rest_sanitize_boolean',
        'default' => false,
    ));

    register_setting('ddns_toll_comments', 'ddns_toll_comments_high_rep_wallets', array(
        'type' => 'string',
        'sanitize_callback' => 'sanitize_text_field',
        'default' => '',
    ));

    register_setting('ddns_toll_comments', 'ddns_toll_comments_node_mode', array(
        'type' => 'boolean',
        'sanitize_callback' => 'rest_sanitize_boolean',
        'default' => false,
    ));

    register_setting('ddns_toll_comments', 'ddns_toll_comments_node_resolver_url', array(
        'type' => 'string',
        'sanitize_callback' => 'esc_url_raw',
        'default' => DDNS_TOLL_COMMENTS_DEFAULT_COORDINATOR . '/resolve',
    ));

    register_setting('ddns_toll_comments', 'ddns_toll_comments_node_hot_names', array(
        'type' => 'string',
        'sanitize_callback' => 'sanitize_text_field',
        'default' => 'example.com',
    ));

    register_setting('ddns_toll_comments', 'ddns_toll_comments_node_name', array(
        'type' => 'string',
        'sanitize_callback' => 'sanitize_text_field',
        'default' => '',
    ));

    register_setting('ddns_toll_comments', 'ddns_toll_comments_node_max_disk_mb', array(
        'type' => 'integer',
        'sanitize_callback' => 'absint',
        'default' => 128,
    ));

    register_setting('ddns_toll_comments', 'ddns_toll_comments_node_max_bandwidth_mb_day', array(
        'type' => 'integer',
        'sanitize_callback' => 'absint',
        'default' => 50,
    ));

    register_setting('ddns_toll_comments', 'ddns_toll_comments_node_max_cpu_percent', array(
        'type' => 'integer',
        'sanitize_callback' => 'absint',
        'default' => 10,
    ));

    register_setting('ddns_toll_comments', 'ddns_toll_comments_node_active_hours', array(
        'type' => 'string',
        'sanitize_callback' => 'sanitize_text_field',
        'default' => '00:00-23:59',
    ));

    add_settings_section(
        'ddns_toll_comments_main',
        'Toll settings',
        '__return_false',
        'ddns-toll-comments'
    );

    add_settings_field(
        'ddns_toll_comments_enabled',
        'Enabled',
        'ddns_toll_comments_render_enabled_field',
        'ddns-toll-comments',
        'ddns_toll_comments_main'
    );

    add_settings_field(
        'ddns_toll_comments_coordinator_url',
        'Coordinator URL',
        'ddns_toll_comments_render_coordinator_field',
        'ddns-toll-comments',
        'ddns_toll_comments_main'
    );

    add_settings_field(
        'ddns_toll_comments_site_id',
        'Site ID',
        'ddns_toll_comments_render_site_id_field',
        'ddns-toll-comments',
        'ddns_toll_comments_main'
    );

    add_settings_field(
        'ddns_toll_comments_site_token',
        'Site token',
        'ddns_toll_comments_render_site_token_field',
        'ddns-toll-comments',
        'ddns_toll_comments_main'
    );

    add_settings_field(
        'ddns_toll_comments_currency_type',
        'Currency type',
        'ddns_toll_comments_render_currency_type_field',
        'ddns-toll-comments',
        'ddns_toll_comments_main'
    );

    add_settings_field(
        'ddns_toll_comments_currency_code',
        'Currency code',
        'ddns_toll_comments_render_currency_code_field',
        'ddns-toll-comments',
        'ddns_toll_comments_main'
    );

    add_settings_field(
        'ddns_toll_comments_toll_amount',
        'Toll amount',
        'ddns_toll_comments_render_amount_field',
        'ddns-toll-comments',
        'ddns_toll_comments_main'
    );

    add_settings_section(
        'ddns_toll_comments_bonus',
        'Bonus settings',
        '__return_false',
        'ddns-toll-comments'
    );

    add_settings_field(
        'ddns_toll_comments_bonus_enabled',
        'Enable bonus refunds',
        'ddns_toll_comments_render_bonus_toggle',
        'ddns-toll-comments',
        'ddns_toll_comments_bonus'
    );

    add_settings_field(
        'ddns_toll_comments_bonus_multiplier',
        'Bonus multiplier',
        'ddns_toll_comments_render_bonus_multiplier',
        'ddns-toll-comments',
        'ddns_toll_comments_bonus'
    );

    add_settings_section(
        'ddns_toll_comments_exemptions',
        'Exemptions',
        '__return_false',
        'ddns-toll-comments'
    );

    add_settings_field(
        'ddns_toll_comments_exempt_roles',
        'Exempt roles',
        'ddns_toll_comments_render_exempt_roles',
        'ddns-toll-comments',
        'ddns_toll_comments_exemptions'
    );

    add_settings_field(
        'ddns_toll_comments_exempt_users',
        'Exempt users',
        'ddns_toll_comments_render_exempt_users',
        'ddns-toll-comments',
        'ddns_toll_comments_exemptions'
    );

    add_settings_field(
        'ddns_toll_comments_free_high_rep',
        'Free for high-rep wallets',
        'ddns_toll_comments_render_high_rep_toggle',
        'ddns-toll-comments',
        'ddns_toll_comments_exemptions'
    );

    add_settings_field(
        'ddns_toll_comments_high_rep_wallets',
        'High-rep wallet list',
        'ddns_toll_comments_render_high_rep_wallets',
        'ddns-toll-comments',
        'ddns_toll_comments_exemptions'
    );

    add_settings_section(
        'ddns_toll_comments_node',
        'Node mode',
        '__return_false',
        'ddns-toll-comments'
    );

    add_settings_field(
        'ddns_toll_comments_node_mode',
        'Enable Node Mode',
        'ddns_toll_comments_render_node_mode',
        'ddns-toll-comments',
        'ddns_toll_comments_node'
    );

    add_settings_field(
        'ddns_toll_comments_node_resolver_url',
        'Resolver URL',
        'ddns_toll_comments_render_node_resolver_url',
        'ddns-toll-comments',
        'ddns_toll_comments_node'
    );

    add_settings_field(
        'ddns_toll_comments_node_hot_names',
        'Hot names',
        'ddns_toll_comments_render_node_hot_names',
        'ddns-toll-comments',
        'ddns_toll_comments_node'
    );

    add_settings_field(
        'ddns_toll_comments_node_name',
        'Node name',
        'ddns_toll_comments_render_node_name',
        'ddns-toll-comments',
        'ddns_toll_comments_node'
    );

    add_settings_field(
        'ddns_toll_comments_node_max_disk_mb',
        'Max disk (MB)',
        'ddns_toll_comments_render_node_max_disk',
        'ddns-toll-comments',
        'ddns_toll_comments_node'
    );

    add_settings_field(
        'ddns_toll_comments_node_max_bandwidth_mb_day',
        'Max bandwidth (MB/day)',
        'ddns_toll_comments_render_node_max_bandwidth',
        'ddns-toll-comments',
        'ddns_toll_comments_node'
    );

    add_settings_field(
        'ddns_toll_comments_node_max_cpu_percent',
        'Max CPU percent (soft)',
        'ddns_toll_comments_render_node_max_cpu',
        'ddns-toll-comments',
        'ddns_toll_comments_node'
    );

    add_settings_field(
        'ddns_toll_comments_node_active_hours',
        'Active hours',
        'ddns_toll_comments_render_node_active_hours',
        'ddns-toll-comments',
        'ddns_toll_comments_node'
    );
}
add_action('admin_init', 'ddns_toll_comments_register_settings');

function ddns_toll_comments_add_settings_page(): void
{
    add_options_page(
        'DDNS Toll Comments',
        'DDNS Toll Comments',
        'manage_options',
        'ddns-toll-comments',
        'ddns_toll_comments_render_settings_page'
    );
}
add_action('admin_menu', 'ddns_toll_comments_add_settings_page');

function ddns_toll_comments_render_enabled_field(): void
{
    $value = (bool) get_option('ddns_toll_comments_enabled', false);
    echo '<label><input type="checkbox" name="ddns_toll_comments_enabled" value="1" ' . checked($value, true, false) . '> Require refundable credit toll for comments</label>';
}

function ddns_toll_comments_render_coordinator_field(): void
{
    $value = esc_attr(get_option('ddns_toll_comments_coordinator_url', DDNS_TOLL_COMMENTS_DEFAULT_COORDINATOR));
    echo '<input class="regular-text" type="url" name="ddns_toll_comments_coordinator_url" value="' . $value . '">';
}

function ddns_toll_comments_render_site_id_field(): void
{
    $value = esc_attr(get_option('ddns_toll_comments_site_id', 'site-1'));
    echo '<input class="regular-text" type="text" name="ddns_toll_comments_site_id" value="' . $value . '">';
}

function ddns_toll_comments_render_site_token_field(): void
{
    $value = esc_attr(get_option('ddns_toll_comments_site_token', ''));
    echo '<input class="regular-text" type="password" name="ddns_toll_comments_site_token" value="' . $value . '" autocomplete="off">';
}

function ddns_toll_comments_render_currency_type_field(): void
{
    $value = esc_attr(get_option('ddns_toll_comments_currency_type', 'credits'));
    echo '<select name="ddns_toll_comments_currency_type">';
    echo '<option value="credits" ' . selected($value, 'credits', false) . '>Credits (default)</option>';
    echo '<option value="token" ' . selected($value, 'token', false) . ' disabled>Token (future)</option>';
    echo '</select>';
}

function ddns_toll_comments_render_currency_code_field(): void
{
    $value = esc_attr(get_option('ddns_toll_comments_currency_code', 'TOLL'));
    echo '<input class="regular-text" type="text" name="ddns_toll_comments_currency_code" value="' . $value . '" placeholder="TOLL">';
}

function ddns_toll_comments_render_amount_field(): void
{
    $value = esc_attr(get_option('ddns_toll_comments_toll_amount', 1));
    echo '<input class="small-text" type="number" name="ddns_toll_comments_toll_amount" value="' . $value . '" min="1">';
    echo '<p class="description">Amount of credits to hold (refunded on approval). Default 1.</p>';
}

function ddns_toll_comments_render_bonus_toggle(): void
{
    $value = (bool) get_option('ddns_toll_comments_bonus_enabled', false);
    echo '<label><input type="checkbox" name="ddns_toll_comments_bonus_enabled" value="1" ' . checked($value, true, false) . '> Enable bonus refunds</label>';
}

function ddns_toll_comments_render_bonus_multiplier(): void
{
    $value = esc_attr(get_option('ddns_toll_comments_bonus_multiplier', 2));
    echo '<input class="small-text" type="number" name="ddns_toll_comments_bonus_multiplier" value="' . $value . '" min="1" max="10">';
    echo '<p class="description">Default 2x when enabled.</p>';
}

function ddns_toll_comments_render_exempt_roles(): void
{
    $value = esc_attr(get_option('ddns_toll_comments_exempt_roles', 'administrator,editor'));
    echo '<input class="regular-text" type="text" name="ddns_toll_comments_exempt_roles" value="' . $value . '" placeholder="administrator,editor">';
}

function ddns_toll_comments_render_exempt_users(): void
{
    $value = esc_attr(get_option('ddns_toll_comments_exempt_users', ''));
    echo '<input class="regular-text" type="text" name="ddns_toll_comments_exempt_users" value="' . $value . '" placeholder="1,2,3">';
}

function ddns_toll_comments_render_high_rep_toggle(): void
{
    $value = (bool) get_option('ddns_toll_comments_free_high_rep', false);
    echo '<label><input type="checkbox" name="ddns_toll_comments_free_high_rep" value="1" ' . checked($value, true, false) . '> Allow free comments for high-rep wallets</label>';
}

function ddns_toll_comments_render_high_rep_wallets(): void
{
    $value = esc_attr(get_option('ddns_toll_comments_high_rep_wallets', ''));
    echo '<textarea class="large-text" rows="3" name="ddns_toll_comments_high_rep_wallets" placeholder="0xabc...,0xdef...">' . $value . '</textarea>';
}

function ddns_toll_comments_render_node_mode(): void
{
    $value = (bool) get_option('ddns_toll_comments_node_mode', false);
    echo '<label><input type="checkbox" name="ddns_toll_comments_node_mode" value="1" ' . checked($value, true, false) . '> Enable Node Mode (cache + verify)</label>';
}

function ddns_toll_comments_render_node_resolver_url(): void
{
    $value = esc_attr(get_option('ddns_toll_comments_node_resolver_url', DDNS_TOLL_COMMENTS_DEFAULT_COORDINATOR . '/resolve'));
    echo '<input class="regular-text" type="url" name="ddns_toll_comments_node_resolver_url" value="' . $value . '">';
}

function ddns_toll_comments_render_node_hot_names(): void
{
    $value = esc_attr(get_option('ddns_toll_comments_node_hot_names', 'example.com'));
    echo '<input class="regular-text" type="text" name="ddns_toll_comments_node_hot_names" value="' . $value . '" placeholder="example.com,alice.dns">';
}

function ddns_toll_comments_render_node_name(): void
{
    $value = esc_attr(get_option('ddns_toll_comments_node_name', ''));
    if ($value === '') {
        $site_id = (string) get_option('ddns_toll_comments_site_id', 'site-1');
        $value = 'node-' . $site_id . '.dns';
    }
    $pubkey = ddns_toll_comments_get_node_pubkey();
    echo '<input class="regular-text" type="text" name="ddns_toll_comments_node_name" value="' . $value . '" placeholder="node-<id>.dns">';
    if ($pubkey !== '') {
        echo '<p class="description">Node pubkey: <code>ed25519:' . esc_html($pubkey) . '</code></p>';
    }
}

function ddns_toll_comments_render_node_max_disk(): void
{
    $value = esc_attr(get_option('ddns_toll_comments_node_max_disk_mb', 128));
    echo '<input class="small-text" type="number" name="ddns_toll_comments_node_max_disk_mb" value="' . $value . '" min="10">';
}

function ddns_toll_comments_render_node_max_bandwidth(): void
{
    $value = esc_attr(get_option('ddns_toll_comments_node_max_bandwidth_mb_day', 50));
    echo '<input class="small-text" type="number" name="ddns_toll_comments_node_max_bandwidth_mb_day" value="' . $value . '" min="1">';
}

function ddns_toll_comments_render_node_max_cpu(): void
{
    $value = esc_attr(get_option('ddns_toll_comments_node_max_cpu_percent', 10));
    echo '<input class="small-text" type="number" name="ddns_toll_comments_node_max_cpu_percent" value="' . $value . '" min="1" max="100">';
}

function ddns_toll_comments_render_node_active_hours(): void
{
    $value = esc_attr(get_option('ddns_toll_comments_node_active_hours', '00:00-23:59'));
    echo '<input class="regular-text" type="text" name="ddns_toll_comments_node_active_hours" value="' . $value . '" placeholder="00:00-23:59">';
}

function ddns_toll_comments_render_settings_page(): void
{
    if (!current_user_can('manage_options')) {
        return;
    }
    $pool_balance = ddns_toll_comments_get_pool_balance();
    $pool_receipts = ddns_toll_comments_get_pool_receipts();
    ?>
    <div class="wrap">
        <h1>DDNS Toll Comments</h1>
        <form method="post" action="options.php">
            <?php settings_fields('ddns_toll_comments'); ?>
            <?php do_settings_sections('ddns-toll-comments'); ?>
            <?php submit_button('Save settings'); ?>
        </form>
        <?php if ($pool_balance !== null) : ?>
            <p><strong>Site Reward Pool:</strong> <?php echo esc_html($pool_balance); ?> credits</p>
        <?php endif; ?>
        <?php if (!empty($pool_receipts)) : ?>
            <h2>Recent Pool Activity</h2>
            <table class="widefat striped">
                <thead>
                    <tr>
                        <th>Time (UTC)</th>
                        <th>Type</th>
                        <th>Details</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach (array_slice($pool_receipts, 0, 10) as $entry) : ?>
                        <tr>
                            <td><?php echo esc_html(gmdate('Y-m-d H:i:s', (int) ($entry['ts'] ?? time()))); ?></td>
                            <td><?php echo esc_html($entry['type'] ?? ''); ?></td>
                            <td><code><?php echo esc_html(wp_json_encode($entry['payload'] ?? array())); ?></code></td>
                        </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        <?php endif; ?>
        <p class="description">Mock mode: define <code>DDNS_TOLL_COMMENTS_MOCK_MODE</code> in wp-config.php for local testing.</p>
    </div>
    <?php
}

function ddns_toll_comments_should_exempt_user(): bool
{
    $current_user = wp_get_current_user();
    if ($current_user && $current_user->exists()) {
        $exempt_roles = array_filter(array_map('trim', explode(',', (string) get_option('ddns_toll_comments_exempt_roles', ''))));
        if ($exempt_roles && array_intersect($exempt_roles, $current_user->roles)) {
            return true;
        }
        $exempt_users = array_filter(array_map('trim', explode(',', (string) get_option('ddns_toll_comments_exempt_users', ''))));
        if ($exempt_users && in_array((string) $current_user->ID, $exempt_users, true)) {
            return true;
        }
    }
    return false;
}

function ddns_toll_comments_wallet_is_high_rep(string $wallet): bool
{
    if (!(bool) get_option('ddns_toll_comments_free_high_rep', false)) {
        return false;
    }
    $list = array_filter(array_map('trim', explode(',', (string) get_option('ddns_toll_comments_high_rep_wallets', ''))));
    return $wallet !== '' && in_array(strtolower($wallet), array_map('strtolower', $list), true);
}

function ddns_toll_comments_enqueue_assets(): void
{
    if (!ddns_toll_comments_is_enabled()) {
        return;
    }

    if (!is_singular() || !comments_open()) {
        return;
    }

    wp_enqueue_script(
        'ddns-toll-comments-ethers',
        'https://cdn.jsdelivr.net/npm/ethers@6.13.2/dist/ethers.umd.min.js',
        array(),
        '6.13.2',
        true
    );

    wp_enqueue_script(
        'ddns-toll-comments',
        DDNS_TOLL_COMMENTS_URL . 'assets/comment-form.js',
        array('ddns-toll-comments-ethers'),
        DDNS_TOLL_COMMENTS_VERSION,
        true
    );

    $config = array(
        'restUrl' => esc_url_raw(rest_url('ddns/v1/toll')),
        'tollAmount' => (int) get_option('ddns_toll_comments_toll_amount', 1),
        'currencyType' => (string) get_option('ddns_toll_comments_currency_type', 'credits'),
        'currencyCode' => (string) get_option('ddns_toll_comments_currency_code', 'TOLL'),
        'holdTtlSeconds' => (int) (DDNS_TOLL_COMMENTS_HOLD_TTL),
        'nonce' => wp_create_nonce('wp_rest'),
        'postId' => get_the_ID(),
    );

    wp_add_inline_script(
        'ddns-toll-comments',
        'window.DDNS_TOLL_COMMENTS_CONFIG = ' . wp_json_encode($config) . ';',
        'before'
    );
}
add_action('wp_enqueue_scripts', 'ddns_toll_comments_enqueue_assets');

function ddns_toll_comments_render_form_fields(): void
{
    if (!ddns_toll_comments_is_enabled()) {
        return;
    }

    ?>
    <input type="hidden" name="ddns_toll_wallet" id="ddns-toll-wallet" value="">
    <input type="hidden" name="ddns_toll_ticket_id" id="ddns-toll-ticket" value="">
    <?php
}
add_action('comment_form_after_fields', 'ddns_toll_comments_render_form_fields');
add_action('comment_form_logged_in_after', 'ddns_toll_comments_render_form_fields');

function ddns_toll_comments_render_form_controls(): void
{
    if (!ddns_toll_comments_is_enabled()) {
        return;
    }
    ?>
    <div class="ddns-toll-comments">
        <p><strong>Refundable comment toll</strong></p>
        <button type="button" class="button" id="ddns-toll-connect">Connect wallet</button>
        <button type="button" class="button" id="ddns-toll-pay">Pay refundable toll</button>
        <span id="ddns-toll-status" class="ddns-toll-status" aria-live="polite"></span>
    </div>
    <?php
}
add_action('comment_form_after', 'ddns_toll_comments_render_form_controls');

function ddns_toll_comments_rest_namespace(): string
{
    return 'ddns/v1';
}

function ddns_toll_comments_register_rest_routes(): void
{
    register_rest_route(ddns_toll_comments_rest_namespace(), '/toll/challenge', array(
        'methods' => 'POST',
        'callback' => 'ddns_toll_comments_rest_challenge',
        'permission_callback' => '__return_true',
    ));

    register_rest_route(ddns_toll_comments_rest_namespace(), '/toll/verify', array(
        'methods' => 'POST',
        'callback' => 'ddns_toll_comments_rest_verify',
        'permission_callback' => '__return_true',
    ));

    register_rest_route(ddns_toll_comments_rest_namespace(), '/toll/hold', array(
        'methods' => 'POST',
        'callback' => 'ddns_toll_comments_rest_hold',
        'permission_callback' => '__return_true',
    ));
}
add_action('rest_api_init', 'ddns_toll_comments_register_rest_routes');

function ddns_toll_comments_read_json(WP_REST_Request $request): array
{
    $body = $request->get_body();
    if (!$body) {
        return array();
    }
    $decoded = json_decode($body, true);
    return is_array($decoded) ? $decoded : array();
}

function ddns_toll_comments_coordinator_url(): string
{
    $base = (string) get_option('ddns_toll_comments_coordinator_url', DDNS_TOLL_COMMENTS_DEFAULT_COORDINATOR);
    return rtrim($base, '/');
}

function ddns_toll_comments_get_pool_balance(): ?string
{
    $site_id = (string) get_option('ddns_toll_comments_site_id', '');
    if ($site_id === '') {
        return null;
    }
    $site_token = (string) get_option('ddns_toll_comments_site_token', '');
    if ($site_token === '') {
        return null;
    }
    $response = wp_remote_get(ddns_toll_comments_coordinator_url() . '/site-pool?site_id=' . rawurlencode($site_id), array(
        'timeout' => 10,
        'headers' => array('x-ddns-site-token' => $site_token),
    ));
    if (is_wp_error($response)) {
        return null;
    }
    $status = wp_remote_retrieve_response_code($response);
    if ($status < 200 || $status >= 300) {
        return null;
    }
    $body = json_decode(wp_remote_retrieve_body($response), true);
    if (!is_array($body)) {
        return null;
    }
    return isset($body['balance']) ? (string) $body['balance'] : null;
}

function ddns_toll_comments_get_pool_receipts(): array
{
    $site_id = (string) get_option('ddns_toll_comments_site_id', '');
    if ($site_id === '') {
        return array();
    }
    $site_token = (string) get_option('ddns_toll_comments_site_token', '');
    if ($site_token === '') {
        return array();
    }
    $response = wp_remote_get(ddns_toll_comments_coordinator_url() . '/site-pool/receipts?site_id=' . rawurlencode($site_id), array(
        'timeout' => 10,
        'headers' => array('x-ddns-site-token' => $site_token),
    ));
    if (is_wp_error($response)) {
        return array();
    }
    $status = wp_remote_retrieve_response_code($response);
    if ($status < 200 || $status >= 300) {
        return array();
    }
    $body = json_decode(wp_remote_retrieve_body($response), true);
    if (!is_array($body)) {
        return array();
    }
    return isset($body['receipts']) && is_array($body['receipts']) ? $body['receipts'] : array();
}

function ddns_toll_comments_call_coordinator(string $path, array $payload): array
{
    if (DDNS_TOLL_COMMENTS_MOCK_MODE) {
        if ($path === '/comments/hold') {
            return array('ok' => true, 'ticket_id' => 'mock_' . wp_generate_uuid4(), 'expiresAt' => time() + DDNS_TOLL_COMMENTS_HOLD_TTL);
        }
        return array('ok' => true);
    }

    $site_token = (string) get_option('ddns_toll_comments_site_token', '');
    $headers = array('Content-Type' => 'application/json');
    if ($site_token !== '') {
        $headers['x-ddns-site-token'] = $site_token;
    }

    $response = wp_remote_post(ddns_toll_comments_coordinator_url() . $path, array(
        'timeout' => 15,
        'headers' => $headers,
        'body' => wp_json_encode($payload),
    ));

    if (is_wp_error($response)) {
        return array('ok' => false, 'error' => $response->get_error_message());
    }

    $status = wp_remote_retrieve_response_code($response);
    $body = json_decode(wp_remote_retrieve_body($response), true);
    if ($status < 200 || $status >= 300) {
        return array('ok' => false, 'error' => $body['error'] ?? 'coordinator_error');
    }

    return array('ok' => true, 'data' => $body);
}

function ddns_toll_comments_rest_challenge(WP_REST_Request $request)
{
    $payload = ddns_toll_comments_read_json($request);
    $wallet = sanitize_text_field($payload['wallet'] ?? '');
    if ($wallet === '') {
        return new WP_REST_Response(array('error' => 'missing_wallet'), 400);
    }
    $response = ddns_toll_comments_call_coordinator('/comments/auth/challenge', array('wallet' => $wallet));
    if (!$response['ok']) {
        return new WP_REST_Response(array('error' => $response['error']), 400);
    }
    return new WP_REST_Response($response['data'] ?? array('ok' => true), 200);
}

function ddns_toll_comments_rest_verify(WP_REST_Request $request)
{
    $payload = ddns_toll_comments_read_json($request);
    $wallet = sanitize_text_field($payload['wallet'] ?? '');
    $signature = sanitize_text_field($payload['signature'] ?? '');
    if ($wallet === '' || $signature === '') {
        return new WP_REST_Response(array('error' => 'missing_fields'), 400);
    }
    $response = ddns_toll_comments_call_coordinator('/comments/auth/verify', array('wallet' => $wallet, 'signature' => $signature));
    if (!$response['ok']) {
        return new WP_REST_Response(array('error' => $response['error']), 403);
    }
    return new WP_REST_Response(array('ok' => true), 200);
}

function ddns_toll_comments_rest_hold(WP_REST_Request $request)
{
    $payload = ddns_toll_comments_read_json($request);
    $wallet = sanitize_text_field($payload['wallet'] ?? '');
    $post_id = absint($payload['post_id'] ?? 0);
    if ($wallet === '' || $post_id === 0) {
        return new WP_REST_Response(array('error' => 'missing_fields'), 400);
    }

    if (ddns_toll_comments_wallet_is_high_rep($wallet)) {
        return new WP_REST_Response(array('ticket_id' => 'free', 'expiresAt' => time() + DDNS_TOLL_COMMENTS_HOLD_TTL, 'free' => true), 200);
    }

    $response = ddns_toll_comments_call_coordinator('/comments/hold', array(
        'wallet' => $wallet,
        'site_id' => (string) get_option('ddns_toll_comments_site_id', 'site-1'),
        'post_id' => (string) $post_id,
        'amount' => (int) get_option('ddns_toll_comments_toll_amount', 1),
    ));
    if (!$response['ok']) {
        return new WP_REST_Response(array('error' => $response['error']), 400);
    }
    return new WP_REST_Response($response['data'] ?? array(), 200);
}

function ddns_toll_comments_comment_hash(int $post_id, string $content, string $wallet): string
{
    return hash('sha256', $post_id . '|' . $content . '|' . strtolower($wallet));
}

function ddns_toll_comments_preprocess_comment(array $commentdata): array
{
    if (!ddns_toll_comments_is_enabled()) {
        return $commentdata;
    }

    if (ddns_toll_comments_should_exempt_user()) {
        return $commentdata;
    }

    $wallet = isset($_POST['ddns_toll_wallet']) ? sanitize_text_field(wp_unslash($_POST['ddns_toll_wallet'])) : '';
    $ticket_id = isset($_POST['ddns_toll_ticket_id']) ? sanitize_text_field(wp_unslash($_POST['ddns_toll_ticket_id'])) : '';

    if ($wallet === '' || $ticket_id === '') {
        wp_die('Please connect a wallet and pay the refundable toll before posting.');
    }

    if ($ticket_id === 'free') {
        $commentdata['comment_content'] = (string) $commentdata['comment_content'];
        return $commentdata;
    }

    $comment_hash = ddns_toll_comments_comment_hash(
        (int) $commentdata['comment_post_ID'],
        (string) $commentdata['comment_content'],
        $wallet
    );

    $submit = ddns_toll_comments_call_coordinator('/comments/submit', array(
        'ticket_id' => $ticket_id,
        'comment_hash' => $comment_hash,
    ));
    if (!$submit['ok']) {
        wp_die('Unable to submit toll proof: ' . esc_html($submit['error']));
    }

    $GLOBALS['ddns_toll_comments_last_payment'] = array(
        'ticket_id' => $ticket_id,
        'wallet' => $wallet,
        'comment_hash' => $comment_hash,
    );

    return $commentdata;
}
add_filter('preprocess_comment', 'ddns_toll_comments_preprocess_comment');

function ddns_toll_comments_store_comment_meta(int $comment_id): void
{
    $payment = $GLOBALS['ddns_toll_comments_last_payment'] ?? null;
    if (!$payment || empty($payment['ticket_id'])) {
        return;
    }

    add_comment_meta($comment_id, 'ddns_toll_ticket_id', $payment['ticket_id'], true);
    add_comment_meta($comment_id, 'ddns_toll_wallet', $payment['wallet'], true);
    add_comment_meta($comment_id, 'ddns_toll_comment_hash', $payment['comment_hash'], true);
}
add_action('comment_post', 'ddns_toll_comments_store_comment_meta', 10, 1);

function ddns_toll_comments_transition_comment_status(string $new_status, string $old_status, $comment): void
{
    if (!ddns_toll_comments_is_enabled()) {
        return;
    }

    $ticket_id = get_comment_meta($comment->comment_ID, 'ddns_toll_ticket_id', true);
    $wallet = get_comment_meta($comment->comment_ID, 'ddns_toll_wallet', true);
    if ($ticket_id === '' || $wallet === '') {
        return;
    }

    if (!in_array($new_status, array('approved', 'spam', 'trash'), true)) {
        return;
    }

    $payload = array(
        'ticket_id' => (string) $ticket_id,
        'result' => (string) $new_status,
        'site_id' => (string) get_option('ddns_toll_comments_site_id', 'site-1'),
    );

    if ($new_status === 'approved' && (bool) get_option('ddns_toll_comments_bonus_enabled', false)) {
        $payload['bonus_multiplier'] = (int) get_option('ddns_toll_comments_bonus_multiplier', 2);
    }

    ddns_toll_comments_call_coordinator('/comments/finalize', $payload);
}
add_action('transition_comment_status', 'ddns_toll_comments_transition_comment_status', 10, 3);

function ddns_toll_comments_get_node_keypair(): array
{
    $stored = get_option('ddns_toll_comments_node_keypair', array());
    if (is_array($stored) && !empty($stored['public']) && !empty($stored['secret'])) {
        return $stored;
    }
    if (!function_exists('sodium_crypto_sign_keypair')) {
        return array();
    }
    $pair = sodium_crypto_sign_keypair();
    $public = sodium_crypto_sign_publickey($pair);
    $secret = sodium_crypto_sign_secretkey($pair);
    $stored = array(
        'public' => base64_encode($public),
        'secret' => base64_encode($secret),
    );
    update_option('ddns_toll_comments_node_keypair', $stored, false);
    return $stored;
}

function ddns_toll_comments_get_node_pubkey(): string
{
    $pair = ddns_toll_comments_get_node_keypair();
    return isset($pair['public']) ? (string) $pair['public'] : '';
}

function ddns_toll_comments_node_mode_enabled(): bool
{
    return (bool) get_option('ddns_toll_comments_node_mode', false);
}

function ddns_toll_comments_node_active_now(): bool
{
    $hours = (string) get_option('ddns_toll_comments_node_active_hours', '00:00-23:59');
    if (!preg_match('/^(\\d{2}):(\\d{2})-(\\d{2}):(\\d{2})$/', $hours, $matches)) {
        return true;
    }
    $start = intval($matches[1]) * 60 + intval($matches[2]);
    $end = intval($matches[3]) * 60 + intval($matches[4]);
    $now = intval(gmdate('H')) * 60 + intval(gmdate('i'));
    if ($start <= $end) {
        return $now >= $start && $now <= $end;
    }
    return $now >= $start || $now <= $end;
}

function ddns_toll_comments_node_cron_runner(): void
{
    if (!ddns_toll_comments_node_mode_enabled()) {
        return;
    }
    if (!ddns_toll_comments_node_active_now()) {
        return;
    }
    $names = array_filter(array_map('trim', explode(',', (string) get_option('ddns_toll_comments_node_hot_names', ''))));
    foreach ($names as $name) {
        ddns_toll_comments_node_fetch_and_cache($name);
    }
}
add_action('ddns_toll_comments_node_cron', 'ddns_toll_comments_node_cron_runner');

function ddns_toll_comments_node_fetch_and_cache(string $name): void
{
    $resolver = (string) get_option('ddns_toll_comments_node_resolver_url', DDNS_TOLL_COMMENTS_DEFAULT_COORDINATOR . '/resolve');
    if ($resolver === '') {
        return;
    }
    $url = add_query_arg(array('name' => $name, 'proof' => 1), $resolver);
    $response = wp_remote_get($url, array('timeout' => 10));
    if (is_wp_error($response)) {
        return;
    }
    $status = wp_remote_retrieve_response_code($response);
    if ($status < 200 || $status >= 300) {
        return;
    }
    $payload = json_decode(wp_remote_retrieve_body($response), true);
    if (!is_array($payload) || empty($payload['metadata']['proof'])) {
        return;
    }
    $verification = ddns_toll_comments_node_verify($payload);
    if (empty($verification['ok'])) {
        return;
    }
    if (!empty($verification['verification_id'])) {
        $payload['metadata']['verification_id'] = $verification['verification_id'];
    }
    ddns_toll_comments_node_store_cache($name, $payload);
    ddns_toll_comments_node_submit_receipt('VERIFY', $name, $payload, $verification['verification_id'] ?? '');
}

function ddns_toll_comments_node_verify(array $payload): array
{
    $site_id = (string) get_option('ddns_toll_comments_site_id', 'site-1');
    $response = ddns_toll_comments_call_coordinator('/node/verify', array(
        'site_id' => $site_id,
        'authority_sig' => $payload['metadata']['authoritySig'] ?? '',
        'result_hash' => $payload['metadata']['resultHash'] ?? '',
        'entry' => array(
            'name' => $payload['name'] ?? '',
            'records' => $payload['records'] ?? array(),
            'version' => $payload['metadata']['version'] ?? 1,
            'updatedAt' => $payload['metadata']['updatedAt'] ?? gmdate('c'),
            'owner' => $payload['metadata']['owner'] ?? null,
        ),
        'proof' => $payload['metadata']['proof'] ?? array(),
        'root' => $payload['metadata']['proof']['root'] ?? ($payload['metadata']['root'] ?? ''),
    ));
    if (!$response['ok']) {
        return array('ok' => false);
    }
    $data = $response['data'] ?? array();
    return array('ok' => true, 'verification_id' => $data['verification_id'] ?? '');
}

function ddns_toll_comments_node_store_cache(string $name, array $payload): void
{
    $key = 'ddns_node_cache_' . md5($name);
    $max_mb = (int) get_option('ddns_toll_comments_node_max_disk_mb', 128);
    $index = get_option('ddns_toll_comments_node_cache_index', array());
    if (!is_array($index)) {
        $index = array();
    }
    $encoded = wp_json_encode($payload);
    $bytes = strlen((string) $encoded);
    $current_bytes = isset($index['bytes']) ? (int) $index['bytes'] : 0;
    if ($max_mb > 0 && ($current_bytes + $bytes) > ($max_mb * 1024 * 1024)) {
        return;
    }
    set_transient($key, $payload, 10 * MINUTE_IN_SECONDS);
    $index['items'] = isset($index['items']) && is_array($index['items']) ? $index['items'] : array();
    $index['items'][$key] = $bytes;
    $index['bytes'] = $current_bytes + $bytes;
    update_option('ddns_toll_comments_node_cache_index', $index, false);
}

function ddns_toll_comments_node_bandwidth_allow(int $bytes): bool
{
    $max_mb = (int) get_option('ddns_toll_comments_node_max_bandwidth_mb_day', 50);
    if ($max_mb <= 0) {
        return true;
    }
    $limit = $max_mb * 1024 * 1024;
    $usage = get_option('ddns_toll_comments_node_bandwidth_usage', array());
    if (!is_array($usage)) {
        $usage = array();
    }
    $today = gmdate('Y-m-d');
    if (($usage['date'] ?? '') !== $today) {
        $usage = array('date' => $today, 'bytes' => 0);
    }
    $current = (int) ($usage['bytes'] ?? 0);
    if ($current + $bytes > $limit) {
        return false;
    }
    $usage['bytes'] = $current + $bytes;
    update_option('ddns_toll_comments_node_bandwidth_usage', $usage, false);
    return true;
}

function ddns_toll_comments_stable_json($value): string
{
    if (is_array($value)) {
        if (array_keys($value) === range(0, count($value) - 1)) {
            $items = array_map('ddns_toll_comments_stable_json', $value);
            return '[' . implode(',', $items) . ']';
        }
        ksort($value);
        $parts = array();
        foreach ($value as $key => $val) {
            $parts[] = json_encode((string) $key) . ':' . ddns_toll_comments_stable_json($val);
        }
        return '{' . implode(',', $parts) . '}';
    }
    return json_encode($value);
}

function ddns_toll_comments_node_submit_receipt(string $type, string $name, array $payload, string $verification_id = ''): void
{
    $site_id = (string) get_option('ddns_toll_comments_site_id', 'site-1');
    $site_token = (string) get_option('ddns_toll_comments_site_token', '');
    if ($site_token === '') {
        return;
    }
    $pair = ddns_toll_comments_get_node_keypair();
    if (empty($pair['public']) || empty($pair['secret'])) {
        return;
    }
    $node_name = (string) get_option('ddns_toll_comments_node_name', '');
    if ($node_name === '') {
        $node_name = 'node-' . $site_id . '.dns';
    }
    $receipt = array(
        'type' => $type,
        'site_id' => $site_id,
        'ts' => time(),
        'request' => array('name' => $name),
        'result_hash' => hash('sha256', wp_json_encode($payload)),
        'bytes' => strlen(wp_json_encode($payload)),
        'verification_id' => $verification_id,
        'node_name' => $node_name,
        'node_pubkey' => 'ed25519:' . $pair['public'],
    );
    if (!function_exists('sodium_crypto_sign_detached')) {
        return;
    }
    $message = 'node_receipt\n' . ddns_toll_comments_stable_json($receipt);
    $signature = sodium_crypto_sign_detached($message, base64_decode($pair['secret']));
    $signature_b64 = base64_encode($signature);
    ddns_toll_comments_call_coordinator('/node/receipts', array(
        'receipt' => $receipt,
        'signature' => $signature_b64,
        'site_id' => $site_id,
    ));
}

function ddns_toll_comments_node_get_cached(string $name): ?array
{
    $key = 'ddns_node_cache_' . md5($name);
    $payload = get_transient($key);
    return is_array($payload) ? $payload : null;
}

function ddns_toll_comments_node_rest_resolve(WP_REST_Request $request)
{
    if (!ddns_toll_comments_node_mode_enabled()) {
        return new WP_REST_Response(array('error' => 'node_mode_disabled'), 403);
    }
    $name = sanitize_text_field($request->get_param('name') ?? '');
    if ($name === '') {
        return new WP_REST_Response(array('error' => 'missing_name'), 400);
    }
    $payload = ddns_toll_comments_node_get_cached($name);
    if (!$payload) {
        return new WP_REST_Response(array('error' => 'not_cached'), 404);
    }
    $bytes = strlen(wp_json_encode($payload));
    if (!ddns_toll_comments_node_bandwidth_allow($bytes)) {
        return new WP_REST_Response(array('error' => 'bandwidth_cap_reached'), 429);
    }
    $verification_id = $payload['metadata']['verification_id'] ?? '';
    ddns_toll_comments_node_submit_receipt('SERVE', $name, $payload, (string) $verification_id);
    return new WP_REST_Response($payload, 200);
}

function ddns_toll_comments_node_rest_health()
{
    return new WP_REST_Response(array('status' => 'ok'), 200);
}

function ddns_toll_comments_register_node_routes(): void
{
    register_rest_route(ddns_toll_comments_rest_namespace(), '/resolve', array(
        'methods' => 'GET',
        'callback' => 'ddns_toll_comments_node_rest_resolve',
        'permission_callback' => '__return_true',
    ));

    register_rest_route(ddns_toll_comments_rest_namespace(), '/health', array(
        'methods' => 'GET',
        'callback' => 'ddns_toll_comments_node_rest_health',
        'permission_callback' => '__return_true',
    ));
}
add_action('rest_api_init', 'ddns_toll_comments_register_node_routes');
