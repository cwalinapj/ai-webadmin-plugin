<?php
/**
 * Plugin Name: DDNS Opt-in
 * Description: Opt-in and connect a WordPress site to the DDNS compat control plane.
 * Version: 0.1.0
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/includes/admin-ui.php';

const DDNS_OPTIN_OPTION_API_URL = 'ddns_optin_api_url';
const DDNS_OPTIN_OPTION_SITE_ID = 'ddns_optin_site_id';
const DDNS_OPTIN_OPTION_SITE_TOKEN = 'ddns_optin_site_token';
const DDNS_OPTIN_OPTION_DOH_URL = 'ddns_optin_doh_url';

function ddns_optin_get_default_api_url(): string {
    return 'http://localhost:8788';
}

function ddns_optin_register_settings(): void {
    register_setting('ddns_optin_settings', DDNS_OPTIN_OPTION_API_URL);
    register_setting('ddns_optin_settings', DDNS_OPTIN_OPTION_SITE_ID);
    register_setting('ddns_optin_settings', DDNS_OPTIN_OPTION_SITE_TOKEN);
    register_setting('ddns_optin_settings', DDNS_OPTIN_OPTION_DOH_URL);
}
add_action('admin_init', 'ddns_optin_register_settings');

function ddns_optin_admin_menu(): void {
    add_menu_page(
        'DDNS Opt-in',
        'DDNS Opt-in',
        'manage_options',
        'ddns-optin',
        'ddns_optin_render_admin_page',
        'dashicons-admin-links'
    );
}
add_action('admin_menu', 'ddns_optin_admin_menu');
