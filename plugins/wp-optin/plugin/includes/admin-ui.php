<?php

if (!defined('ABSPATH')) {
    exit;
}

function ddns_optin_handle_register(): array {
    if (!current_user_can('manage_options')) {
        return ['ok' => false, 'error' => 'insufficient_permissions'];
    }

    check_admin_referer('ddns_optin_register');

    $api_url = trim((string) get_option(DDNS_OPTIN_OPTION_API_URL, ddns_optin_get_default_api_url()));
    $site_id = trim((string) get_option(DDNS_OPTIN_OPTION_SITE_ID, ''));

    if ($api_url === '' || $site_id === '') {
        return ['ok' => false, 'error' => 'missing_api_url_or_site_id'];
    }

    $payload = [
        'site_id' => $site_id,
        'manifest' => [
            'site_url' => get_site_url(),
            'site_name' => get_bloginfo('name'),
            'wp_version' => get_bloginfo('version')
        ]
    ];

    $response = wp_remote_post($api_url . '/v1/sites/register', [
        'timeout' => 10,
        'headers' => ['Content-Type' => 'application/json'],
        'body' => wp_json_encode($payload)
    ]);

    if (is_wp_error($response)) {
        return ['ok' => false, 'error' => $response->get_error_message()];
    }

    $status = wp_remote_retrieve_response_code($response);
    $body = json_decode((string) wp_remote_retrieve_body($response), true);

    if ($status !== 200 || !is_array($body) || empty($body['ok'])) {
        return ['ok' => false, 'error' => $body['error'] ?? 'register_failed'];
    }

    $site_token = $body['site']['site_token'] ?? '';
    if ($site_token !== '') {
        update_option(DDNS_OPTIN_OPTION_SITE_TOKEN, $site_token);
    }

    return ['ok' => true, 'site_token' => $site_token];
}

function ddns_optin_render_admin_page(): void {
    $message = null;

    if (isset($_POST['ddns_optin_register'])) {
        $result = ddns_optin_handle_register();
        if ($result['ok']) {
            $message = 'Site registered. Token saved.';
        } else {
            $message = 'Registration failed: ' . (string) $result['error'];
        }
    }

    $api_url = esc_attr((string) get_option(DDNS_OPTIN_OPTION_API_URL, ddns_optin_get_default_api_url()));
    $site_id = esc_attr((string) get_option(DDNS_OPTIN_OPTION_SITE_ID, ''));
    $site_token = esc_attr((string) get_option(DDNS_OPTIN_OPTION_SITE_TOKEN, ''));
    $doh_url = esc_attr((string) get_option(DDNS_OPTIN_OPTION_DOH_URL, ''));

    echo '<div class="wrap">';
    echo '<h1>DDNS Opt-in</h1>';
    if ($message) {
        echo '<div class="notice notice-info"><p>' . esc_html($message) . '</p></div>';
    }
    echo '<form method="post" action="options.php">';
    settings_fields('ddns_optin_settings');
    echo '<table class="form-table" role="presentation">';
    echo '<tr><th scope="row"><label for="ddns_optin_api_url">Control Plane URL</label></th>';
    echo '<td><input name="' . DDNS_OPTIN_OPTION_API_URL . '" id="ddns_optin_api_url" type="text" class="regular-text" value="' . $api_url . '"/></td></tr>';
    echo '<tr><th scope="row"><label for="ddns_optin_site_id">Site ID</label></th>';
    echo '<td><input name="' . DDNS_OPTIN_OPTION_SITE_ID . '" id="ddns_optin_site_id" type="text" class="regular-text" value="' . $site_id . '"/></td></tr>';
    echo '<tr><th scope="row"><label for="ddns_optin_doh_url">Resolver DoH URL</label></th>';
    echo '<td><input name="' . DDNS_OPTIN_OPTION_DOH_URL . '" id="ddns_optin_doh_url" type="text" class="regular-text" value="' . $doh_url . '"/>';
    echo '<p class="description">Use this resolver to access .free domains and enhanced Web3 DNS routes.</p></td></tr>';
    echo '</table>';
    submit_button('Save Settings');
    echo '</form>';

    echo '<hr />';
    echo '<h2>Register Site</h2>';
    echo '<form method="post">';
    wp_nonce_field('ddns_optin_register');
    echo '<p>Register this site with the DDNS compat control plane.</p>';
    echo '<p><input type="submit" class="button button-primary" name="ddns_optin_register" value="Register"></p>';
    echo '</form>';

    if ($site_token !== '') {
        echo '<h3>Current Site Token</h3>';
        echo '<p><code>' . $site_token . '</code></p>';
    }

    echo '</div>';
}
