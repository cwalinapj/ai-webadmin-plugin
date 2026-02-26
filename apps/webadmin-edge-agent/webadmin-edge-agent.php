<?php
/**
 * Plugin Name: WebAdmin Edge Agent
 * Description: Production-grade signed edge agent for Cloudflare Workers control plane.
 * Version: 0.1.0
 * Author: Sitebuilder
 * Requires PHP: 7.4
 * License: GPL-2.0-or-later
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!defined('WEBADMIN_EDGE_AGENT_VERSION')) {
    define('WEBADMIN_EDGE_AGENT_VERSION', '0.1.0');
}

if (!defined('WEBADMIN_EDGE_AGENT_FILE')) {
    define('WEBADMIN_EDGE_AGENT_FILE', __FILE__);
}

if (!defined('WEBADMIN_EDGE_AGENT_DIR')) {
    define('WEBADMIN_EDGE_AGENT_DIR', plugin_dir_path(__FILE__));
}

spl_autoload_register(static function ($class) {
    $prefix = 'WebAdminEdgeAgent\\';
    if (strpos($class, $prefix) !== 0) {
        return;
    }

    $relative = substr($class, strlen($prefix));
    $relativePath = str_replace('\\', DIRECTORY_SEPARATOR, $relative) . '.php';
    $path = WEBADMIN_EDGE_AGENT_DIR . 'src/' . $relativePath;

    if (file_exists($path)) {
        require_once $path;
    }
});

add_action('plugins_loaded', static function () {
    \WebAdminEdgeAgent\Plugin::boot();
});

register_activation_hook(__FILE__, static function () {
    \WebAdminEdgeAgent\Plugin::activate();
});

register_deactivation_hook(__FILE__, static function () {
    \WebAdminEdgeAgent\Plugin::deactivate();
});
