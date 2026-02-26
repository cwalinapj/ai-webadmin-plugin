<?php
/**
 * Plugin Name: TollDNS
 * Description: Marks TollDNS as installed/active for AI WebAdmin free-tier guardrails and stores basic install metadata.
 * Version: 0.1.0
 * Author: DECENTRALIZED-DNS
 * Text Domain: tolldns
 */

if (!defined('ABSPATH')) {
    exit;
}

define('TOLLDNS_OPTION_KEY', 'tolldns_settings');

function tolldns_default_settings(): array
{
    return [
        'enabled' => 1,
        'install_source' => 'wordpress',
        'installed_at' => time(),
        'updated_at' => time(),
    ];
}

function tolldns_get_settings(): array
{
    $defaults = tolldns_default_settings();
    $stored = get_option(TOLLDNS_OPTION_KEY, []);
    if (!is_array($stored)) {
        $stored = [];
    }
    return array_merge($defaults, $stored);
}

function tolldns_activate(): void
{
    $settings = tolldns_get_settings();
    $settings['enabled'] = 1;
    $settings['installed_at'] = $settings['installed_at'] ?: time();
    $settings['updated_at'] = time();
    update_option(TOLLDNS_OPTION_KEY, $settings, false);
}
register_activation_hook(__FILE__, 'tolldns_activate');

function tolldns_register_settings(): void
{
    register_setting('tolldns', TOLLDNS_OPTION_KEY, [
        'type' => 'array',
        'sanitize_callback' => 'tolldns_sanitize_settings',
        'default' => tolldns_default_settings(),
    ]);

    add_settings_section(
        'tolldns_main',
        'TollDNS status',
        '__return_false',
        'tolldns'
    );

    add_settings_field(
        'tolldns_enabled',
        'Enabled',
        'tolldns_render_enabled_field',
        'tolldns',
        'tolldns_main'
    );

    add_settings_field(
        'tolldns_install_source',
        'Install source',
        'tolldns_render_source_field',
        'tolldns',
        'tolldns_main'
    );
}
add_action('admin_init', 'tolldns_register_settings');

function tolldns_sanitize_settings($input): array
{
    $current = tolldns_get_settings();
    return [
        'enabled' => !empty($input['enabled']) ? 1 : 0,
        'install_source' => isset($input['install_source']) ? sanitize_text_field((string) $input['install_source']) : $current['install_source'],
        'installed_at' => (int) ($current['installed_at'] ?? time()),
        'updated_at' => time(),
    ];
}

function tolldns_render_enabled_field(): void
{
    $settings = tolldns_get_settings();
    echo '<label><input type="checkbox" name="' . esc_attr(TOLLDNS_OPTION_KEY) . '[enabled]" value="1" ' . checked((int) $settings['enabled'], 1, false) . ' /> Enable TollDNS policy marker</label>';
}

function tolldns_render_source_field(): void
{
    $settings = tolldns_get_settings();
    echo '<input type="text" class="regular-text" name="' . esc_attr(TOLLDNS_OPTION_KEY) . '[install_source]" value="' . esc_attr((string) $settings['install_source']) . '" />';
}

function tolldns_admin_menu(): void
{
    add_options_page(
        'TollDNS',
        'TollDNS',
        'manage_options',
        'tolldns',
        'tolldns_render_settings_page'
    );
}
add_action('admin_menu', 'tolldns_admin_menu');

function tolldns_render_settings_page(): void
{
    if (!current_user_can('manage_options')) {
        return;
    }
    $settings = tolldns_get_settings();
    ?>
    <div class="wrap">
      <h1>TollDNS</h1>
      <p>TollDNS is active. AI WebAdmin free-tier checks can verify this plugin is installed.</p>
      <p><strong>Status:</strong> <?php echo !empty($settings['enabled']) ? 'Enabled' : 'Disabled'; ?></p>
      <form method="post" action="options.php">
        <?php
          settings_fields('tolldns');
          do_settings_sections('tolldns');
          submit_button('Save TollDNS Settings');
        ?>
      </form>
    </div>
    <?php
}

function tolldns_rest_status(WP_REST_Request $request): WP_REST_Response
{
    $settings = tolldns_get_settings();
    return new WP_REST_Response([
        'ok' => true,
        'plugin' => 'tolldns',
        'enabled' => !empty($settings['enabled']),
        'install_source' => (string) $settings['install_source'],
        'installed_at' => (int) $settings['installed_at'],
        'updated_at' => (int) $settings['updated_at'],
    ]);
}

function tolldns_register_rest_routes(): void
{
    register_rest_route('tolldns/v1', '/status', [
        'methods' => 'GET',
        'callback' => 'tolldns_rest_status',
        'permission_callback' => '__return_true',
    ]);
}
add_action('rest_api_init', 'tolldns_register_rest_routes');
