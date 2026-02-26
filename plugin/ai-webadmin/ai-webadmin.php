<?php
/**
 * Plugin Name: AI WebAdmin (Cloudflare Worker)
 * Description: Connects WordPress to AI WebAdmin workers for comment moderation, security workflows, and guided Cloudflare onboarding.
 * Version: 0.2.0
 * Author: Sitebuilder
 * License: GPLv2 or later
 */

if (!defined("ABSPATH")) {
    exit;
}

define("AI_WEBADMIN_OPTION_KEY", "ai_webadmin_settings");
define("AI_WEBADMIN_DEFAULT_WORKER_BASE", "https://sitebuilder-agent.96psxbzqk2.workers.dev");
define("AI_WEBADMIN_TOLLDNS_PLUGIN_SLUG", "tolldns/tolldns.php");
define("AI_WEBADMIN_HTACCESS_MARKER", "AI WebAdmin Hardening");

function ai_webadmin_default_settings() {
    return [
        "worker_base_url" => AI_WEBADMIN_DEFAULT_WORKER_BASE,
        "plugin_shared_secret" => "",
        "onboarding_session_id" => "",
        "enable_comment_moderation" => 1,
        "enable_schema_injection" => 1,
        "enable_broken_link_redirects" => 1,
        "require_tolldns" => 1,
        "github_signup_url" => "https://github.com/signup",
        "enable_security_hardening" => 1,
        "disable_xmlrpc" => 1,
        "prevent_email_display_name" => 1,
        "enforce_single_admin" => 1,
        "block_file_manager_plugins" => 1,
        "enable_login_rate_limit" => 1,
        "login_rate_limit_attempts" => 5,
        "login_rate_limit_window_minutes" => 15,
        "login_rate_limit_lockout_minutes" => 15,
        "enforce_admin_sso" => 0,
        "admin_sso_header_name" => "CF-Access-Authenticated-User-Email",
        "apply_htaccess_hardening" => 1,
        "enable_plugin_rationalization" => 1,
        "remove_migration_replication_plugins" => 1,
        "enable_inactive_user_cleanup" => 1,
        "inactive_user_days" => 365,
        "inactive_user_delete_limit" => 50,
        "github_backup_enabled" => 1,
        "github_backup_repo" => "",
        "github_backup_branch" => "main",
        "github_backup_manifest_max_files" => 5000,
        "github_vault_connected" => 0,
        "github_vault_token_masked" => "",
        "github_vault_last_connected_at" => 0,
        "github_backup_last_snapshot_at" => 0,
        "github_backup_last_status" => "",
        "github_backup_last_message" => "",
        "enable_passcode_unlock" => 0,
        "unlock_passcode_hash" => "",
        "require_hardware_key_unlock" => 0,
        "require_wallet_signature_unlock" => 0,
        "wallet_unlock_message_prefix" => "AI WebAdmin Login Challenge",
        "wallet_unlock_chain_id" => 1,
        "wallet_unlock_nonce_ttl_minutes" => 10,
        "enable_email_forwarding_via_worker" => 1,
        "remove_smtp_plugins" => 1,
        "lead_forward_email" => "",
        "suppress_local_lead_mail" => 1,
    ];
}

function ai_webadmin_get_settings() {
    $defaults = ai_webadmin_default_settings();
    $stored = get_option(AI_WEBADMIN_OPTION_KEY, []);
    if (!is_array($stored)) {
        $stored = [];
    }
    return array_merge($defaults, $stored);
}

function ai_webadmin_save_settings($input) {
    $current = ai_webadmin_get_settings();
    $next = [
        "worker_base_url" => isset($input["worker_base_url"]) ? esc_url_raw(trim((string)$input["worker_base_url"])) : $current["worker_base_url"],
        "plugin_shared_secret" => isset($input["plugin_shared_secret"]) ? trim((string)$input["plugin_shared_secret"]) : $current["plugin_shared_secret"],
        "onboarding_session_id" => isset($input["onboarding_session_id"]) ? sanitize_text_field(trim((string)$input["onboarding_session_id"])) : $current["onboarding_session_id"],
        "enable_comment_moderation" => !empty($input["enable_comment_moderation"]) ? 1 : 0,
        "enable_schema_injection" => !empty($input["enable_schema_injection"]) ? 1 : 0,
        "enable_broken_link_redirects" => !empty($input["enable_broken_link_redirects"]) ? 1 : 0,
        "require_tolldns" => !empty($input["require_tolldns"]) ? 1 : 0,
        "github_signup_url" => isset($input["github_signup_url"]) ? esc_url_raw(trim((string)$input["github_signup_url"])) : $current["github_signup_url"],
        "enable_security_hardening" => !empty($input["enable_security_hardening"]) ? 1 : 0,
        "disable_xmlrpc" => !empty($input["disable_xmlrpc"]) ? 1 : 0,
        "prevent_email_display_name" => !empty($input["prevent_email_display_name"]) ? 1 : 0,
        "enforce_single_admin" => !empty($input["enforce_single_admin"]) ? 1 : 0,
        "block_file_manager_plugins" => !empty($input["block_file_manager_plugins"]) ? 1 : 0,
        "enable_login_rate_limit" => !empty($input["enable_login_rate_limit"]) ? 1 : 0,
        "login_rate_limit_attempts" => max(3, min(20, (int)($input["login_rate_limit_attempts"] ?? $current["login_rate_limit_attempts"]))),
        "login_rate_limit_window_minutes" => max(1, min(60, (int)($input["login_rate_limit_window_minutes"] ?? $current["login_rate_limit_window_minutes"]))),
        "login_rate_limit_lockout_minutes" => max(1, min(240, (int)($input["login_rate_limit_lockout_minutes"] ?? $current["login_rate_limit_lockout_minutes"]))),
        "enforce_admin_sso" => !empty($input["enforce_admin_sso"]) ? 1 : 0,
        "admin_sso_header_name" => isset($input["admin_sso_header_name"]) ? sanitize_text_field(trim((string)$input["admin_sso_header_name"])) : $current["admin_sso_header_name"],
        "apply_htaccess_hardening" => !empty($input["apply_htaccess_hardening"]) ? 1 : 0,
        "enable_plugin_rationalization" => !empty($input["enable_plugin_rationalization"]) ? 1 : 0,
        "remove_migration_replication_plugins" => !empty($input["remove_migration_replication_plugins"]) ? 1 : 0,
        "enable_inactive_user_cleanup" => !empty($input["enable_inactive_user_cleanup"]) ? 1 : 0,
        "inactive_user_days" => max(30, min(3650, (int)($input["inactive_user_days"] ?? $current["inactive_user_days"]))),
        "inactive_user_delete_limit" => max(1, min(500, (int)($input["inactive_user_delete_limit"] ?? $current["inactive_user_delete_limit"]))),
        "github_backup_enabled" => !empty($input["github_backup_enabled"]) ? 1 : 0,
        "github_backup_repo" => isset($input["github_backup_repo"]) ? sanitize_text_field(trim((string)$input["github_backup_repo"])) : $current["github_backup_repo"],
        "github_backup_branch" => isset($input["github_backup_branch"]) ? sanitize_text_field(trim((string)$input["github_backup_branch"])) : $current["github_backup_branch"],
        "github_backup_manifest_max_files" => max(500, min(12000, (int)($input["github_backup_manifest_max_files"] ?? $current["github_backup_manifest_max_files"]))),
        "github_vault_connected" => !empty($current["github_vault_connected"]) ? 1 : 0,
        "github_vault_token_masked" => (string)($current["github_vault_token_masked"] ?? ""),
        "github_vault_last_connected_at" => (int)($current["github_vault_last_connected_at"] ?? 0),
        "github_backup_last_snapshot_at" => (int)($current["github_backup_last_snapshot_at"] ?? 0),
        "github_backup_last_status" => sanitize_text_field((string)($current["github_backup_last_status"] ?? "")),
        "github_backup_last_message" => sanitize_text_field((string)($current["github_backup_last_message"] ?? "")),
        "enable_passcode_unlock" => !empty($input["enable_passcode_unlock"]) ? 1 : 0,
        "unlock_passcode_hash" => (string)($current["unlock_passcode_hash"] ?? ""),
        "require_hardware_key_unlock" => !empty($input["require_hardware_key_unlock"]) ? 1 : 0,
        "require_wallet_signature_unlock" => !empty($input["require_wallet_signature_unlock"]) ? 1 : 0,
        "wallet_unlock_message_prefix" => isset($input["wallet_unlock_message_prefix"])
            ? sanitize_text_field(trim((string)$input["wallet_unlock_message_prefix"]))
            : (string)($current["wallet_unlock_message_prefix"] ?? "AI WebAdmin Login Challenge"),
        "wallet_unlock_chain_id" => max(1, min(999999, (int)($input["wallet_unlock_chain_id"] ?? $current["wallet_unlock_chain_id"]))),
        "wallet_unlock_nonce_ttl_minutes" => max(3, min(30, (int)($input["wallet_unlock_nonce_ttl_minutes"] ?? $current["wallet_unlock_nonce_ttl_minutes"]))),
        "enable_email_forwarding_via_worker" => !empty($input["enable_email_forwarding_via_worker"]) ? 1 : 0,
        "remove_smtp_plugins" => !empty($input["remove_smtp_plugins"]) ? 1 : 0,
        "lead_forward_email" => isset($input["lead_forward_email"]) ? sanitize_email(trim((string)$input["lead_forward_email"])) : (string)($current["lead_forward_email"] ?? ""),
        "suppress_local_lead_mail" => !empty($input["suppress_local_lead_mail"]) ? 1 : 0,
    ];

    $newPasscode = isset($input["unlock_passcode"]) ? trim((string)$input["unlock_passcode"]) : "";
    $clearPasscode = !empty($input["clear_unlock_passcode"]);
    if ($clearPasscode) {
        $next["unlock_passcode_hash"] = "";
    } elseif ($newPasscode !== "") {
        $next["unlock_passcode_hash"] = wp_hash_password($newPasscode);
    }

    update_option(AI_WEBADMIN_OPTION_KEY, $next, false);
    return $next;
}

function ai_webadmin_hardening_enabled() {
    $settings = ai_webadmin_get_settings();
    return !empty($settings["enable_security_hardening"]);
}

function ai_webadmin_blocked_plugin_slugs() {
    return [
        "wp-file-manager/file_folder_manager.php",
        "file-manager/file-manager.php",
        "wp-file-manager-pro/file_folder_manager.php",
    ];
}

function ai_webadmin_migration_replication_plugin_slugs() {
    return [
        "all-in-one-wp-migration/all-in-one-wp-migration.php",
        "all-in-one-wp-migration-unlimited-extension/all-in-one-wp-migration-unlimited-extension.php",
        "wp-migrate-db/wp-migrate-db.php",
        "wp-migrate-db-pro/wp-migrate-db-pro.php",
        "wpvivid-backuprestore/wpvivid-backuprestore.php",
        "duplicator/duplicator.php",
        "updraftplus/updraftplus.php",
        "backupbuddy/backupbuddy.php",
    ];
}

function ai_webadmin_smtp_email_plugin_slugs() {
    return [
        "wp-mail-smtp/wp_mail_smtp.php",
        "easy-wp-smtp/easy-wp-smtp.php",
        "post-smtp/postman-smtp.php",
        "fluent-smtp/fluent-smtp.php",
        "smtp-mailer/main.php",
        "gmail-smtp/main.php",
        "mail-bank/wp-mail-bank.php",
    ];
}

function ai_webadmin_parse_repo_slug($raw) {
    $slug = trim((string)$raw);
    $slug = preg_replace("#^https?://github\.com/#i", "", $slug);
    $slug = trim((string)$slug, "/");
    if (!preg_match('#^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$#', $slug)) {
        return null;
    }
    return strtolower($slug);
}

function ai_webadmin_client_ip() {
    $keys = ["HTTP_CF_CONNECTING_IP", "HTTP_X_FORWARDED_FOR", "REMOTE_ADDR"];
    foreach ($keys as $key) {
        if (empty($_SERVER[$key])) {
            continue;
        }
        $raw = trim((string)$_SERVER[$key]);
        if ($raw === "") {
            continue;
        }
        $candidate = $raw;
        if ($key === "HTTP_X_FORWARDED_FOR" && strpos($raw, ",") !== false) {
            $parts = explode(",", $raw);
            $candidate = trim((string)$parts[0]);
        }
        if (filter_var($candidate, FILTER_VALIDATE_IP)) {
            return $candidate;
        }
    }
    return "0.0.0.0";
}

function ai_webadmin_login_throttle_key($ip) {
    return "ai_webadmin_login_" . md5((string)$ip);
}

function ai_webadmin_lockout_key($ip) {
    return "ai_webadmin_lockout_" . md5((string)$ip);
}

function ai_webadmin_access_header_value($settings) {
    $headerName = trim((string)($settings["admin_sso_header_name"] ?? "CF-Access-Authenticated-User-Email"));
    if ($headerName === "") {
        $headerName = "CF-Access-Authenticated-User-Email";
    }
    $serverKey = "HTTP_" . strtoupper(str_replace("-", "_", $headerName));
    if (!empty($_SERVER[$serverKey])) {
        return trim((string)$_SERVER[$serverKey]);
    }
    return "";
}

function ai_webadmin_unlock_enabled($settings = null) {
    if (!is_array($settings)) {
        $settings = ai_webadmin_get_settings();
    }
    return (
        !empty($settings["enable_passcode_unlock"]) ||
        !empty($settings["require_hardware_key_unlock"]) ||
        !empty($settings["require_wallet_signature_unlock"])
    );
}

function ai_webadmin_wallet_nonce_key($nonce) {
    return "ai_webadmin_wallet_nonce_" . md5((string)$nonce);
}

function ai_webadmin_issue_wallet_login_challenge($settings) {
    $nonce = wp_generate_password(24, false, false);
    $issuedAt = gmdate("c");
    $chainId = max(1, (int)($settings["wallet_unlock_chain_id"] ?? 1));
    $prefix = trim((string)($settings["wallet_unlock_message_prefix"] ?? "AI WebAdmin Login Challenge"));
    if ($prefix === "") {
        $prefix = "AI WebAdmin Login Challenge";
    }
    $siteHost = wp_parse_url(home_url("/"), PHP_URL_HOST);
    if (!is_string($siteHost) || $siteHost === "") {
        $siteHost = "unknown-site";
    }
    $message = $prefix .
        "\nSite: " . $siteHost .
        "\nChain ID: " . $chainId .
        "\nNonce: " . $nonce .
        "\nIssued At: " . $issuedAt;
    $ttlSeconds = max(180, min(1800, ((int)($settings["wallet_unlock_nonce_ttl_minutes"] ?? 10)) * 60));
    set_transient(ai_webadmin_wallet_nonce_key($nonce), [
        "nonce" => $nonce,
        "message" => $message,
        "issued_at" => $issuedAt,
        "ip" => ai_webadmin_client_ip(),
    ], $ttlSeconds);

    return [
        "nonce" => $nonce,
        "issued_at" => $issuedAt,
        "message" => $message,
        "chain_id" => $chainId,
    ];
}

function ai_webadmin_wallet_verify_with_worker($settings, $user, $address, $signature, $message, $nonce) {
    if (!ai_webadmin_features_enabled()) {
        return new WP_Error("ai_webadmin_wallet_worker_unavailable", "Wallet unlock requires Worker API configuration.");
    }
    $sessionId = trim((string)($settings["onboarding_session_id"] ?? ""));
    if ($sessionId === "") {
        return new WP_Error("ai_webadmin_wallet_missing_session", "Wallet unlock requires Onboarding Session ID in plugin settings.");
    }
    $nonce = trim((string)$nonce);
    $nonceRecord = get_transient(ai_webadmin_wallet_nonce_key($nonce));
    if (!is_array($nonceRecord) || empty($nonceRecord["nonce"])) {
        return new WP_Error("ai_webadmin_wallet_nonce_invalid", "Wallet challenge expired. Reload login page and try again.");
    }
    delete_transient(ai_webadmin_wallet_nonce_key($nonce));

    $response = ai_webadmin_signed_post($settings, "plugin/wp/auth/wallet/verify", [
        "session_id" => $sessionId,
        "site_url" => home_url("/"),
        "user_id" => (int)$user->ID,
        "user_login" => (string)$user->user_login,
        "user_email" => (string)$user->user_email,
        "wallet_address" => (string)$address,
        "wallet_signature" => (string)$signature,
        "wallet_message" => (string)$message,
        "wallet_nonce" => $nonce,
        "wallet_chain_id" => (int)($settings["wallet_unlock_chain_id"] ?? 1),
        "wallet_challenge_issued_at" => (string)($nonceRecord["issued_at"] ?? ""),
    ], 20);

    if (is_wp_error($response)) {
        return new WP_Error("ai_webadmin_wallet_verify_failed", "Wallet verification request failed.");
    }
    $code = (int)wp_remote_retrieve_response_code($response);
    $body = wp_remote_retrieve_body($response);
    $decoded = json_decode($body, true);
    if ($code < 200 || $code >= 300 || !is_array($decoded) || empty($decoded["ok"]) || empty($decoded["verified"])) {
        $messageText = "Wallet signature verification failed.";
        if (is_array($decoded) && !empty($decoded["error"])) {
            $messageText = sanitize_text_field((string)$decoded["error"]);
        }
        return new WP_Error("ai_webadmin_wallet_verify_denied", $messageText);
    }
    update_user_meta((int)$user->ID, "ai_webadmin_last_wallet_unlock", time());
    update_user_meta((int)$user->ID, "ai_webadmin_wallet_address", sanitize_text_field((string)($decoded["wallet_address"] ?? $address)));
    return true;
}

function ai_webadmin_detect_hardware_key_provider() {
    $activePlugins = (array)get_option("active_plugins", []);
    $candidates = [
        "wp-webauthn/wp-webauthn.php",
        "passwordless-login/passwordless-login.php",
        "miniorange-2-factor-authentication/miniorange_2_factor_settings.php",
        "two-factor/two-factor.php",
    ];
    foreach ($candidates as $slug) {
        if (in_array($slug, $activePlugins, true)) {
            return $slug;
        }
    }
    return null;
}

function ai_webadmin_is_tolldns_active() {
    $activePlugins = (array)get_option("active_plugins", []);
    if (in_array(AI_WEBADMIN_TOLLDNS_PLUGIN_SLUG, $activePlugins, true)) {
        return true;
    }
    if (is_multisite()) {
        $networkPlugins = (array)get_site_option("active_sitewide_plugins", []);
        return isset($networkPlugins[AI_WEBADMIN_TOLLDNS_PLUGIN_SLUG]);
    }
    return false;
}

function ai_webadmin_features_enabled() {
    $settings = ai_webadmin_get_settings();
    $requiresTollDns = !empty($settings["require_tolldns"]);
    if ($requiresTollDns && !ai_webadmin_is_tolldns_active()) {
        return false;
    }
    if (empty($settings["plugin_shared_secret"])) {
        return false;
    }
    if (empty($settings["worker_base_url"])) {
        return false;
    }
    return true;
}

function ai_webadmin_user_display_name_is_email($displayName, $email) {
    $display = trim((string)$displayName);
    if ($display === "") {
        return false;
    }
    if (function_exists("is_email") && is_email($display)) {
        return true;
    }
    if ($email !== "" && strtolower($display) === strtolower((string)$email)) {
        return true;
    }
    return false;
}

function ai_webadmin_set_safe_display_name($userId) {
    $settings = ai_webadmin_get_settings();
    if (!ai_webadmin_hardening_enabled() || empty($settings["prevent_email_display_name"])) {
        return;
    }
    $userId = (int)$userId;
    if ($userId <= 0) {
        return;
    }
    $user = get_userdata($userId);
    if (!$user) {
        return;
    }
    $displayName = (string)$user->display_name;
    $email = (string)$user->user_email;
    if (!ai_webadmin_user_display_name_is_email($displayName, $email)) {
        return;
    }

    $fallback = trim((string)$user->nickname);
    if ($fallback === "") {
        $fallback = trim((string)$user->user_login);
    }
    if ($fallback === "") {
        $fallback = "User-" . $userId;
    }
    if ($fallback === $displayName) {
        return;
    }
    wp_update_user([
        "ID" => $userId,
        "display_name" => $fallback,
    ]);
}

function ai_webadmin_find_primary_admin_id() {
    $admins = get_users([
        "role" => "Administrator",
        "fields" => ["ID", "user_login"],
        "orderby" => "ID",
        "order" => "ASC",
    ]);
    if (empty($admins)) {
        return 0;
    }
    $preferredId = (int)get_option("ai_webadmin_primary_admin_id", 0);
    if ($preferredId > 0) {
        foreach ($admins as $admin) {
            if ((int)$admin->ID === $preferredId) {
                return $preferredId;
            }
        }
    }
    $primary = (int)$admins[0]->ID;
    update_option("ai_webadmin_primary_admin_id", $primary, false);
    return $primary;
}

function ai_webadmin_enforce_single_admin_role() {
    if (is_multisite()) {
        return;
    }
    $settings = ai_webadmin_get_settings();
    if (!ai_webadmin_hardening_enabled() || empty($settings["enforce_single_admin"])) {
        return;
    }

    $admins = get_users([
        "role" => "Administrator",
        "fields" => ["ID"],
        "orderby" => "ID",
        "order" => "ASC",
    ]);
    if (count($admins) <= 1) {
        return;
    }

    $primaryId = ai_webadmin_find_primary_admin_id();
    if ($primaryId <= 0) {
        return;
    }

    foreach ($admins as $admin) {
        $userId = (int)$admin->ID;
        if ($userId <= 0 || $userId === $primaryId) {
            continue;
        }
        $user = new WP_User($userId);
        if (!$user || !$user->exists()) {
            continue;
        }
        if (in_array("administrator", (array)$user->roles, true)) {
            $user->set_role("editor");
        }
    }
}

function ai_webadmin_filter_blocked_active_plugins($newValue, $oldValue) {
    $settings = ai_webadmin_get_settings();
    if (!ai_webadmin_hardening_enabled() || empty($settings["block_file_manager_plugins"])) {
        return $newValue;
    }
    if (!is_array($newValue)) {
        return $newValue;
    }
    $blocked = ai_webadmin_blocked_plugin_slugs();
    return array_values(array_diff($newValue, $blocked));
}

function ai_webadmin_filter_blocked_network_plugins($newValue, $oldValue) {
    $settings = ai_webadmin_get_settings();
    if (!ai_webadmin_hardening_enabled() || empty($settings["block_file_manager_plugins"])) {
        return $newValue;
    }
    if (!is_array($newValue)) {
        return $newValue;
    }
    $blocked = ai_webadmin_blocked_plugin_slugs();
    foreach ($blocked as $slug) {
        if (isset($newValue[$slug])) {
            unset($newValue[$slug]);
        }
    }
    return $newValue;
}

function ai_webadmin_disable_blocked_plugins_runtime() {
    $settings = ai_webadmin_get_settings();
    if (!ai_webadmin_hardening_enabled() || empty($settings["block_file_manager_plugins"])) {
        return;
    }
    if (!function_exists("deactivate_plugins")) {
        require_once ABSPATH . "wp-admin/includes/plugin.php";
    }
    $activePlugins = (array)get_option("active_plugins", []);
    $blocked = ai_webadmin_blocked_plugin_slugs();
    $toDeactivate = array_values(array_intersect($blocked, $activePlugins));
    if (!empty($toDeactivate)) {
        deactivate_plugins($toDeactivate, true, false);
        update_option("ai_webadmin_blocked_plugins_last", $toDeactivate, false);
    }

    if (is_multisite()) {
        $networkActive = (array)get_site_option("active_sitewide_plugins", []);
        foreach ($blocked as $slug) {
            if (isset($networkActive[$slug])) {
                deactivate_plugins($slug, true, true);
            }
        }
    }
}

function ai_webadmin_remove_migration_plugins_runtime() {
    $settings = ai_webadmin_get_settings();
    if (!ai_webadmin_hardening_enabled()) {
        return;
    }
    if (empty($settings["enable_plugin_rationalization"]) || empty($settings["remove_migration_replication_plugins"])) {
        return;
    }

    $targets = ai_webadmin_migration_replication_plugin_slugs();
    if (!function_exists("deactivate_plugins")) {
        require_once ABSPATH . "wp-admin/includes/plugin.php";
    }
    $active = (array)get_option("active_plugins", []);
    $toDeactivate = array_values(array_intersect($targets, $active));
    if (!empty($toDeactivate)) {
        deactivate_plugins($toDeactivate, true, false);
    }

    if (!function_exists("delete_plugins")) {
        require_once ABSPATH . "wp-admin/includes/plugin.php";
        require_once ABSPATH . "wp-admin/includes/file.php";
    }
    $all = function_exists("get_plugins") ? get_plugins() : [];
    $toDelete = [];
    foreach ($targets as $slug) {
        if (isset($all[$slug])) {
            $toDelete[] = $slug;
        }
    }
    if (!empty($toDelete)) {
        $result = delete_plugins($toDelete);
        if (!is_wp_error($result)) {
            update_option("ai_webadmin_removed_migration_plugins_last", $toDelete, false);
        }
    }
}

function ai_webadmin_remove_smtp_plugins_runtime() {
    $settings = ai_webadmin_get_settings();
    if (empty($settings["enable_email_forwarding_via_worker"]) || empty($settings["remove_smtp_plugins"])) {
        return;
    }
    $targets = ai_webadmin_smtp_email_plugin_slugs();
    if (!function_exists("deactivate_plugins")) {
        require_once ABSPATH . "wp-admin/includes/plugin.php";
    }
    $active = (array)get_option("active_plugins", []);
    $toDeactivate = array_values(array_intersect($targets, $active));
    if (!empty($toDeactivate)) {
        deactivate_plugins($toDeactivate, true, false);
    }
    if (is_multisite()) {
        $networkActive = (array)get_site_option("active_sitewide_plugins", []);
        foreach ($targets as $slug) {
            if (isset($networkActive[$slug])) {
                deactivate_plugins($slug, true, true);
            }
        }
    }

    if (!function_exists("delete_plugins")) {
        require_once ABSPATH . "wp-admin/includes/plugin.php";
        require_once ABSPATH . "wp-admin/includes/file.php";
    }
    $all = function_exists("get_plugins") ? get_plugins() : [];
    $toDelete = [];
    foreach ($targets as $slug) {
        if (isset($all[$slug])) {
            $toDelete[] = $slug;
        }
    }
    if (!empty($toDelete)) {
        $result = delete_plugins($toDelete);
        if (!is_wp_error($result)) {
            update_option("ai_webadmin_removed_smtp_plugins_last", $toDelete, false);
        }
    }
}

function ai_webadmin_count_active_smtp_plugins($activePluginSlugs) {
    $targets = ai_webadmin_smtp_email_plugin_slugs();
    return count(array_intersect(array_values((array)$activePluginSlugs), $targets));
}

function ai_webadmin_effective_forward_email($settings = null) {
    if (!is_array($settings)) {
        $settings = ai_webadmin_get_settings();
    }
    $candidate = sanitize_email((string)($settings["lead_forward_email"] ?? ""));
    if (is_email($candidate)) {
        return $candidate;
    }
    $primaryAdminId = ai_webadmin_find_primary_admin_id();
    if ($primaryAdminId > 0) {
        $adminUser = get_userdata($primaryAdminId);
        if ($adminUser && is_email((string)$adminUser->user_email)) {
            return (string)$adminUser->user_email;
        }
    }
    $adminEmail = sanitize_email((string)get_option("admin_email", ""));
    if (is_email($adminEmail)) {
        return $adminEmail;
    }
    return "";
}

function ai_webadmin_collect_mx_profile() {
    $host = wp_parse_url(home_url("/"), PHP_URL_HOST);
    if (!is_string($host) || trim($host) === "") {
        return [
            "host" => null,
            "has_mx_records" => null,
            "mx_records" => [],
            "email_provider_hint" => null,
        ];
    }
    $host = trim($host);
    $records = [];
    if (function_exists("dns_get_record")) {
        $dns = @dns_get_record($host, DNS_MX);
        if (is_array($dns)) {
            foreach ($dns as $row) {
                if (!is_array($row)) {
                    continue;
                }
                $target = strtolower(trim((string)($row["target"] ?? "")));
                if ($target === "") {
                    continue;
                }
                $records[] = [
                    "target" => $target,
                    "pri" => isset($row["pri"]) ? (int)$row["pri"] : null,
                ];
            }
        }
    }
    usort($records, function ($a, $b) {
        return (int)($a["pri"] ?? 9999) <=> (int)($b["pri"] ?? 9999);
    });
    $targets = array_map(function ($x) {
        return (string)($x["target"] ?? "");
    }, $records);
    $targetsText = implode(" ", $targets);
    $provider = null;
    if (strpos($targetsText, "google.com") !== false || strpos($targetsText, "googlemail.com") !== false) $provider = "Google Workspace";
    if (strpos($targetsText, "outlook.com") !== false || strpos($targetsText, "protection.outlook.com") !== false) $provider = "Microsoft 365";
    if (strpos($targetsText, "zoho.com") !== false) $provider = "Zoho Mail";
    if (strpos($targetsText, "icloud.com") !== false || strpos($targetsText, "me.com") !== false) $provider = "iCloud Mail";
    if (strpos($targetsText, "cloudflare.net") !== false) $provider = "Cloudflare Email Routing";

    return [
        "host" => $host,
        "has_mx_records" => !empty($records),
        "mx_records" => array_slice($records, 0, 20),
        "email_provider_hint" => $provider,
    ];
}

function ai_webadmin_sync_email_forwarding_profile() {
    $settings = ai_webadmin_get_settings();
    if (empty($settings["enable_email_forwarding_via_worker"])) {
        return;
    }
    if (!ai_webadmin_features_enabled()) {
        return;
    }
    $sessionId = trim((string)($settings["onboarding_session_id"] ?? ""));
    if ($sessionId === "") {
        return;
    }

    $forwardEmail = ai_webadmin_effective_forward_email($settings);
    $mx = ai_webadmin_collect_mx_profile();
    $response = ai_webadmin_signed_post($settings, "plugin/wp/email/forward/config", [
        "session_id" => $sessionId,
        "site_url" => home_url("/"),
        "forward_to_email" => $forwardEmail,
        "has_mx_records" => $mx["has_mx_records"],
        "mx_records" => $mx["mx_records"],
        "email_provider_hint" => $mx["email_provider_hint"],
        "source" => "plugin_sync",
    ], 20);
    if (is_wp_error($response)) {
        return;
    }
}

function ai_webadmin_is_lead_mail_payload($atts) {
    if (!is_array($atts)) {
        return false;
    }
    $subject = strtolower((string)($atts["subject"] ?? ""));
    $message = strtolower((string)($atts["message"] ?? ""));
    $text = $subject . "\n" . $message;
    if ($text === "") {
        return false;
    }
    if (preg_match('/\b(password reset|reset your password|new user|verification code|2fa|otp|login)\b/i', $text)) {
        return false;
    }
    if (preg_match('/\b(contact|lead|inquiry|enquiry|new message|form submission|new submission|quote request|book(ing|ed)?|appointment)\b/i', $text)) {
        return true;
    }
    return false;
}

function ai_webadmin_forward_lead_mail_to_worker($atts) {
    $settings = ai_webadmin_get_settings();
    if (empty($settings["enable_email_forwarding_via_worker"])) {
        return false;
    }
    if (!ai_webadmin_features_enabled()) {
        return false;
    }
    if (!ai_webadmin_is_lead_mail_payload($atts)) {
        return false;
    }
    $sessionId = trim((string)($settings["onboarding_session_id"] ?? ""));
    if ($sessionId === "") {
        return false;
    }
    $forwardEmail = ai_webadmin_effective_forward_email($settings);
    if (!is_email($forwardEmail)) {
        return false;
    }
    $mx = ai_webadmin_collect_mx_profile();

    $payload = [
        "session_id" => $sessionId,
        "site_url" => home_url("/"),
        "forward_to_email" => $forwardEmail,
        "subject" => (string)($atts["subject"] ?? ""),
        "message" => (string)($atts["message"] ?? ""),
        "to" => $atts["to"] ?? null,
        "headers" => $atts["headers"] ?? null,
        "attachments" => $atts["attachments"] ?? null,
        "source" => "wp_mail_hook",
        "has_mx_records" => $mx["has_mx_records"],
        "mx_records" => $mx["mx_records"],
        "email_provider_hint" => $mx["email_provider_hint"],
    ];
    $response = ai_webadmin_signed_post($settings, "plugin/wp/lead/forward", $payload, 20);
    if (is_wp_error($response)) {
        return false;
    }
    $status = (int)wp_remote_retrieve_response_code($response);
    return ($status >= 200 && $status < 300);
}

function ai_webadmin_pre_wp_mail_filter($preempt, $atts) {
    if ($preempt !== null) {
        return $preempt;
    }
    $forwarded = ai_webadmin_forward_lead_mail_to_worker($atts);
    if (!$forwarded) {
        return null;
    }
    $settings = ai_webadmin_get_settings();
    if (!empty($settings["suppress_local_lead_mail"])) {
        return true;
    }
    return null;
}

function ai_webadmin_user_last_login_ts($userId, $userRegistered = "") {
    $meta = (int)get_user_meta((int)$userId, "ai_webadmin_last_login_at", true);
    if ($meta > 0) {
        return $meta;
    }
    $registeredTs = strtotime((string)$userRegistered);
    if (is_numeric($registeredTs) && $registeredTs > 0) {
        return (int)$registeredTs;
    }
    return 0;
}

function ai_webadmin_purge_inactive_users() {
    $settings = ai_webadmin_get_settings();
    if (empty($settings["enable_inactive_user_cleanup"])) {
        return ["candidate_count" => 0, "deleted_count" => 0, "deleted_user_ids" => []];
    }

    $cutoffDays = max(30, (int)$settings["inactive_user_days"]);
    $cutoffTs = time() - ($cutoffDays * DAY_IN_SECONDS);
    $deleteLimit = max(1, (int)$settings["inactive_user_delete_limit"]);
    $primaryAdminId = ai_webadmin_find_primary_admin_id();

    $users = get_users([
        "fields" => ["ID", "user_registered", "roles"],
        "orderby" => "ID",
        "order" => "ASC",
    ]);

    $candidates = [];
    foreach ($users as $user) {
        $userId = (int)$user->ID;
        if ($userId <= 0) {
            continue;
        }
        if ($userId === $primaryAdminId) {
            continue;
        }
        $roles = is_array($user->roles) ? $user->roles : [];
        if (in_array("administrator", $roles, true)) {
            continue;
        }

        $lastLoginTs = ai_webadmin_user_last_login_ts($userId, (string)$user->user_registered);
        if ($lastLoginTs > 0 && $lastLoginTs < $cutoffTs) {
            $candidates[] = $userId;
        }
    }

    $deleted = [];
    if (!empty($candidates)) {
        if (!function_exists("wp_delete_user")) {
            require_once ABSPATH . "wp-admin/includes/user.php";
        }
        foreach (array_slice($candidates, 0, $deleteLimit) as $userId) {
            $ok = wp_delete_user((int)$userId, $primaryAdminId > 0 ? $primaryAdminId : null);
            if ($ok) {
                $deleted[] = (int)$userId;
            }
        }
    }

    $summary = [
        "candidate_count" => count($candidates),
        "deleted_count" => count($deleted),
        "deleted_user_ids" => $deleted,
        "ran_at" => time(),
        "cutoff_days" => $cutoffDays,
    ];
    update_option("ai_webadmin_inactive_user_cleanup_last", $summary, false);
    return $summary;
}

function ai_webadmin_should_skip_backup_path($relativePath) {
    $rel = ltrim(str_replace("\\", "/", (string)$relativePath), "/");
    if ($rel === "") {
        return true;
    }
    $skipPrefixes = [
        ".git/",
        "node_modules/",
        "wp-content/cache/",
        "wp-content/uploads/cache/",
        "wp-content/upgrade/",
    ];
    foreach ($skipPrefixes as $prefix) {
        if (strpos($rel, $prefix) === 0) {
            return true;
        }
    }
    return false;
}

function ai_webadmin_collect_site_manifest($maxFiles = 10000) {
    $root = rtrim((string)ABSPATH, "/\\");
    $maxFiles = max(500, min(30000, (int)$maxFiles));
    $entries = [];
    $scanned = 0;
    $truncated = false;
    $maxHashBytes = 5 * 1024 * 1024;

    try {
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS | FilesystemIterator::CURRENT_AS_FILEINFO),
            RecursiveIteratorIterator::LEAVES_ONLY
        );
    } catch (Exception $e) {
        return [
            "generated_at" => gmdate("c"),
            "root" => $root,
            "scanned_files" => 0,
            "manifest_count" => 0,
            "truncated" => false,
            "error" => "manifest_iterator_error",
            "files" => [],
        ];
    }

    foreach ($iterator as $fileInfo) {
        if (!($fileInfo instanceof SplFileInfo) || !$fileInfo->isFile()) {
            continue;
        }
        $fullPath = (string)$fileInfo->getPathname();
        $relative = ltrim(str_replace("\\", "/", substr($fullPath, strlen($root))), "/");
        if (ai_webadmin_should_skip_backup_path($relative)) {
            continue;
        }
        $scanned += 1;
        if (count($entries) >= $maxFiles) {
            $truncated = true;
            break;
        }
        $size = (int)$fileInfo->getSize();
        $mtime = (int)$fileInfo->getMTime();
        $hash = null;
        if ($size >= 0 && $size <= $maxHashBytes && is_readable($fullPath)) {
            $hash = @hash_file("sha256", $fullPath) ?: null;
        }
        $entries[] = [
            "path" => $relative,
            "size" => $size,
            "mtime" => $mtime,
            "sha256" => $hash,
        ];
    }

    return [
        "generated_at" => gmdate("c"),
        "root" => $root,
        "scanned_files" => $scanned,
        "manifest_count" => count($entries),
        "truncated" => $truncated,
        "files" => $entries,
    ];
}

function ai_webadmin_htaccess_rules() {
    return [
        "<IfModule mod_authz_core.c>",
        "  <Files \"xmlrpc.php\">",
        "    Require all denied",
        "  </Files>",
        "  <FilesMatch \"^(wp-config\\.php|readme\\.html|license\\.txt)$\">",
        "    Require all denied",
        "  </FilesMatch>",
        "</IfModule>",
        "<IfModule !mod_authz_core.c>",
        "  <Files \"xmlrpc.php\">",
        "    Order Deny,Allow",
        "    Deny from all",
        "  </Files>",
        "  <FilesMatch \"^(wp-config\\.php|readme\\.html|license\\.txt)$\">",
        "    Order Deny,Allow",
        "    Deny from all",
        "  </FilesMatch>",
        "</IfModule>",
    ];
}

function ai_webadmin_sync_htaccess_rules() {
    $settings = ai_webadmin_get_settings();
    if (!ai_webadmin_hardening_enabled()) {
        return;
    }
    if (!empty($settings["apply_htaccess_hardening"])) {
        if (!function_exists("insert_with_markers")) {
            require_once ABSPATH . "wp-admin/includes/misc.php";
        }
        $path = trailingslashit(ABSPATH) . ".htaccess";
        if (file_exists($path) && is_writable($path)) {
            insert_with_markers($path, AI_WEBADMIN_HTACCESS_MARKER, ai_webadmin_htaccess_rules());
        }
        return;
    }
    if (!function_exists("insert_with_markers")) {
        require_once ABSPATH . "wp-admin/includes/misc.php";
    }
    $path = trailingslashit(ABSPATH) . ".htaccess";
    if (file_exists($path) && is_writable($path)) {
        insert_with_markers($path, AI_WEBADMIN_HTACCESS_MARKER, []);
    }
}

function ai_webadmin_block_xmlrpc_request() {
    $settings = ai_webadmin_get_settings();
    if (!ai_webadmin_hardening_enabled() || empty($settings["disable_xmlrpc"])) {
        return;
    }
    $requestUri = isset($_SERVER["REQUEST_URI"]) ? (string)$_SERVER["REQUEST_URI"] : "";
    if ($requestUri === "") {
        return;
    }
    $path = wp_parse_url($requestUri, PHP_URL_PATH);
    if (!is_string($path)) {
        return;
    }
    if (preg_match("#/xmlrpc\.php$#i", $path)) {
        status_header(403);
        nocache_headers();
        exit("XML-RPC disabled.");
    }
}

function ai_webadmin_login_rate_limit_pre_auth($user, $username, $password) {
    $settings = ai_webadmin_get_settings();
    if (!ai_webadmin_hardening_enabled() || empty($settings["enable_login_rate_limit"])) {
        return $user;
    }
    if ((string)$username === "" && (string)$password === "") {
        return $user;
    }
    $ip = ai_webadmin_client_ip();
    $lockoutUntil = (int)get_transient(ai_webadmin_lockout_key($ip));
    if ($lockoutUntil > time()) {
        $waitSeconds = max(1, $lockoutUntil - time());
        $waitMinutes = max(1, (int)ceil($waitSeconds / 60));
        return new WP_Error("ai_webadmin_login_locked", sprintf("Too many login attempts. Try again in %d minute(s).", $waitMinutes));
    }
    if ($lockoutUntil > 0) {
        delete_transient(ai_webadmin_lockout_key($ip));
    }
    return $user;
}

function ai_webadmin_login_failed($username, $error = null) {
    $settings = ai_webadmin_get_settings();
    if (!ai_webadmin_hardening_enabled() || empty($settings["enable_login_rate_limit"])) {
        return;
    }
    $ip = ai_webadmin_client_ip();
    $attempts = max(0, (int)get_transient(ai_webadmin_login_throttle_key($ip)));
    $attempts += 1;
    $windowSeconds = max(60, ((int)$settings["login_rate_limit_window_minutes"]) * 60);
    set_transient(ai_webadmin_login_throttle_key($ip), $attempts, $windowSeconds);

    $maxAttempts = max(3, (int)$settings["login_rate_limit_attempts"]);
    if ($attempts >= $maxAttempts) {
        $lockoutSeconds = max(60, ((int)$settings["login_rate_limit_lockout_minutes"]) * 60);
        set_transient(ai_webadmin_lockout_key($ip), time() + $lockoutSeconds, $lockoutSeconds);
    }
}

function ai_webadmin_login_success($userLogin, $user) {
    $settings = ai_webadmin_get_settings();
    $ip = ai_webadmin_client_ip();
    if (ai_webadmin_hardening_enabled() && !empty($settings["enable_login_rate_limit"])) {
        delete_transient(ai_webadmin_login_throttle_key($ip));
        delete_transient(ai_webadmin_lockout_key($ip));
    }
    if ($user instanceof WP_User) {
        update_user_meta((int)$user->ID, "ai_webadmin_last_login_at", time());
    }
}

function ai_webadmin_enforce_admin_sso_login($user, $username, $password) {
    if (is_wp_error($user) || !($user instanceof WP_User)) {
        return $user;
    }
    $settings = ai_webadmin_get_settings();
    if (!ai_webadmin_hardening_enabled() || empty($settings["enforce_admin_sso"])) {
        return $user;
    }
    if (!in_array("administrator", (array)$user->roles, true)) {
        return $user;
    }
    $identityEmail = ai_webadmin_access_header_value($settings);
    if ($identityEmail === "") {
        return new WP_Error("ai_webadmin_admin_sso_required", "Administrator login requires SSO.");
    }
    if (strcasecmp(trim((string)$user->user_email), $identityEmail) !== 0) {
        return new WP_Error("ai_webadmin_admin_sso_mismatch", "Administrator SSO identity does not match this account.");
    }
    return $user;
}

function ai_webadmin_run_hardening_pass($force = false) {
    if (!ai_webadmin_hardening_enabled()) {
        return;
    }
    if (!$force) {
        $lastRun = (int)get_transient("ai_webadmin_hardening_pass_last");
        if ($lastRun > 0 && (time() - $lastRun) < 300) {
            return;
        }
    }
    set_transient("ai_webadmin_hardening_pass_last", time(), 300);
    $currentUserId = get_current_user_id();
    if ($currentUserId > 0) {
        ai_webadmin_set_safe_display_name($currentUserId);
    }
    ai_webadmin_disable_blocked_plugins_runtime();
    ai_webadmin_remove_smtp_plugins_runtime();
    ai_webadmin_remove_migration_plugins_runtime();
    ai_webadmin_enforce_single_admin_role();
    ai_webadmin_sync_htaccess_rules();
}

function ai_webadmin_sweep_email_display_names($maxUsers = 300) {
    $settings = ai_webadmin_get_settings();
    if (!ai_webadmin_hardening_enabled() || empty($settings["prevent_email_display_name"])) {
        return;
    }
    $maxUsers = max(10, min(2000, (int)$maxUsers));
    $users = get_users([
        "number" => $maxUsers,
        "fields" => ["ID"],
        "orderby" => "ID",
        "order" => "ASC",
    ]);
    foreach ($users as $user) {
        ai_webadmin_set_safe_display_name((int)$user->ID);
    }
}

function ai_webadmin_boot_hardening_hooks() {
    $settings = ai_webadmin_get_settings();
    if (!ai_webadmin_hardening_enabled()) {
        return;
    }
    if (!defined("DISALLOW_FILE_EDIT")) {
        define("DISALLOW_FILE_EDIT", true);
    }
    if (!empty($settings["disable_xmlrpc"])) {
        add_filter("xmlrpc_enabled", "__return_false");
        add_filter("xmlrpc_methods", "__return_empty_array");
        add_filter("wp_headers", function ($headers) {
            if (is_array($headers) && isset($headers["X-Pingback"])) {
                unset($headers["X-Pingback"]);
            }
            return $headers;
        });
    }
}
add_action("plugins_loaded", "ai_webadmin_boot_hardening_hooks", 5);

function ai_webadmin_render_unlock_login_fields() {
    $settings = ai_webadmin_get_settings();
    if (!ai_webadmin_unlock_enabled($settings)) {
        return;
    }
    $challenge = null;
    if (!empty($settings["require_wallet_signature_unlock"])) {
        $challenge = ai_webadmin_issue_wallet_login_challenge($settings);
    }
    ?>
    <p>
      <strong>AI WebAdmin Unlock</strong><br/>
      <span class="description">Complete enabled unlock checks before login.</span>
    </p>
    <?php if (!empty($settings["enable_passcode_unlock"])): ?>
      <p>
        <label for="ai_webadmin_passcode">Passcode</label><br/>
        <input type="password" name="ai_webadmin_passcode" id="ai_webadmin_passcode" class="input" autocomplete="one-time-code" />
      </p>
    <?php endif; ?>
    <?php if (!empty($settings["require_hardware_key_unlock"])): ?>
      <p>
        <label>
          <input type="checkbox" name="ai_webadmin_hardware_key_confirmed" value="1" />
          I completed hardware key/passkey verification
        </label><br/>
        <span class="description">This requires an installed WebAuthn/passkey plugin integration.</span>
      </p>
    <?php endif; ?>
    <?php if (!empty($settings["require_wallet_signature_unlock"]) && is_array($challenge)): ?>
      <p>
        <label for="ai_webadmin_wallet_address">Wallet Address</label><br/>
        <input type="text" name="ai_webadmin_wallet_address" id="ai_webadmin_wallet_address" class="input" value="" autocomplete="off" />
      </p>
      <input type="hidden" name="ai_webadmin_wallet_signature" id="ai_webadmin_wallet_signature" value="" />
      <input type="hidden" name="ai_webadmin_wallet_message" id="ai_webadmin_wallet_message" value="<?php echo esc_attr($challenge["message"]); ?>" />
      <input type="hidden" name="ai_webadmin_wallet_nonce" id="ai_webadmin_wallet_nonce" value="<?php echo esc_attr($challenge["nonce"]); ?>" />
      <p>
        <button type="button" id="ai-webadmin-wallet-sign" class="button button-secondary">Sign Wallet Challenge</button><br/>
        <span id="ai-webadmin-wallet-status" class="description">Not signed yet.</span>
      </p>
      <script>
      (function() {
        var btn = document.getElementById("ai-webadmin-wallet-sign");
        if (!btn) return;
        var status = document.getElementById("ai-webadmin-wallet-status");
        var addrField = document.getElementById("ai_webadmin_wallet_address");
        var sigField = document.getElementById("ai_webadmin_wallet_signature");
        var msgField = document.getElementById("ai_webadmin_wallet_message");
        var setStatus = function(text) { if (status) status.textContent = text; };
        btn.addEventListener("click", async function() {
          try {
            if (!window.ethereum || !window.ethereum.request) {
              setStatus("No wallet detected in browser.");
              return;
            }
            const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
            const account = Array.isArray(accounts) && accounts.length ? accounts[0] : "";
            if (!account) {
              setStatus("No wallet account selected.");
              return;
            }
            var message = msgField ? msgField.value : "";
            let signature;
            try {
              signature = await window.ethereum.request({ method: "personal_sign", params: [message, account] });
            } catch (err) {
              signature = await window.ethereum.request({ method: "personal_sign", params: [account, message] });
            }
            if (addrField) addrField.value = account;
            if (sigField) sigField.value = signature || "";
            setStatus(signature ? "Wallet challenge signed." : "Wallet signature failed.");
          } catch (err) {
            setStatus("Wallet signature failed.");
          }
        });
      })();
      </script>
    <?php endif; ?>
    <?php
}
add_action("login_form", "ai_webadmin_render_unlock_login_fields", 15);

function ai_webadmin_validate_unlock_factors($user, $username, $password) {
    if (is_wp_error($user) || !($user instanceof WP_User)) {
        return $user;
    }
    $settings = ai_webadmin_get_settings();
    if (!ai_webadmin_unlock_enabled($settings)) {
        return $user;
    }

    if (!empty($settings["enable_passcode_unlock"])) {
        $passcodeHash = (string)($settings["unlock_passcode_hash"] ?? "");
        if ($passcodeHash === "") {
            return new WP_Error("ai_webadmin_passcode_missing", "Passcode unlock is enabled but no passcode is configured.");
        }
        $submittedPasscode = isset($_POST["ai_webadmin_passcode"]) ? (string)wp_unslash($_POST["ai_webadmin_passcode"]) : "";
        if ($submittedPasscode === "" || !wp_check_password($submittedPasscode, $passcodeHash)) {
            return new WP_Error("ai_webadmin_passcode_invalid", "Invalid unlock passcode.");
        }
    }

    if (!empty($settings["require_hardware_key_unlock"])) {
        $provider = ai_webadmin_detect_hardware_key_provider();
        if ($provider === null) {
            return new WP_Error("ai_webadmin_hardware_key_provider_missing", "Hardware key unlock requires a WebAuthn/passkey plugin.");
        }
        $verified = apply_filters("ai_webadmin_hardware_key_verified", null, $user, $provider);
        if ($verified !== true) {
            return new WP_Error("ai_webadmin_hardware_key_not_verified", "Hardware key verification was not confirmed.");
        }
    }

    if (!empty($settings["require_wallet_signature_unlock"])) {
        $address = isset($_POST["ai_webadmin_wallet_address"]) ? trim((string)wp_unslash($_POST["ai_webadmin_wallet_address"])) : "";
        $signature = isset($_POST["ai_webadmin_wallet_signature"]) ? trim((string)wp_unslash($_POST["ai_webadmin_wallet_signature"])) : "";
        $message = isset($_POST["ai_webadmin_wallet_message"]) ? (string)wp_unslash($_POST["ai_webadmin_wallet_message"]) : "";
        $nonce = isset($_POST["ai_webadmin_wallet_nonce"]) ? (string)wp_unslash($_POST["ai_webadmin_wallet_nonce"]) : "";
        if ($address === "" || $signature === "" || $message === "" || $nonce === "") {
            return new WP_Error("ai_webadmin_wallet_missing_fields", "Wallet unlock requires address + signature.");
        }
        $walletResult = ai_webadmin_wallet_verify_with_worker($settings, $user, $address, $signature, $message, $nonce);
        if (is_wp_error($walletResult)) {
            return $walletResult;
        }
    }

    return $user;
}
add_filter("authenticate", "ai_webadmin_validate_unlock_factors", 55, 3);

add_action("init", "ai_webadmin_block_xmlrpc_request", 0);
add_action("admin_init", "ai_webadmin_run_hardening_pass", 5);
add_action("user_register", "ai_webadmin_set_safe_display_name", 20, 1);
add_action("profile_update", "ai_webadmin_set_safe_display_name", 20, 1);
add_filter("pre_update_option_active_plugins", "ai_webadmin_filter_blocked_active_plugins", 10, 2);
add_filter("pre_update_site_option_active_sitewide_plugins", "ai_webadmin_filter_blocked_network_plugins", 10, 2);
add_filter("authenticate", "ai_webadmin_login_rate_limit_pre_auth", 15, 3);
add_filter("authenticate", "ai_webadmin_enforce_admin_sso_login", 40, 3);
add_filter("pre_wp_mail", "ai_webadmin_pre_wp_mail_filter", 10, 2);
add_action("wp_login_failed", "ai_webadmin_login_failed", 10, 2);
add_action("wp_login", "ai_webadmin_login_success", 10, 2);

function ai_webadmin_admin_notice() {
    if (!current_user_can("manage_options")) {
        return;
    }
    $settings = ai_webadmin_get_settings();
    if (!empty($settings["require_tolldns"]) && !ai_webadmin_is_tolldns_active()) {
        echo '<div class="notice notice-warning"><p><strong>AI WebAdmin:</strong> TollDNS is required for free-tier features. Install and activate TollDNS to enable worker moderation.</p></div>';
    }
    if (empty($settings["plugin_shared_secret"])) {
        echo '<div class="notice notice-warning"><p><strong>AI WebAdmin:</strong> Configure your Plugin Shared Secret in Settings > AI WebAdmin.</p></div>';
    }
    if (!empty($settings["enable_security_hardening"]) && !empty($settings["enforce_admin_sso"])) {
        echo '<div class="notice notice-info"><p><strong>AI WebAdmin:</strong> Administrator SSO enforcement is active. Non-admin users can still sign in with username/password.</p></div>';
    }
    if (!empty($settings["require_hardware_key_unlock"]) && ai_webadmin_detect_hardware_key_provider() === null) {
        echo '<div class="notice notice-warning"><p><strong>AI WebAdmin:</strong> Hardware key unlock is enabled but no WebAuthn/passkey plugin was detected.</p></div>';
    }
    if (!empty($settings["require_wallet_signature_unlock"]) && empty($settings["onboarding_session_id"])) {
        echo '<div class="notice notice-warning"><p><strong>AI WebAdmin:</strong> Wallet unlock requires an Onboarding Session ID so Worker verification can run.</p></div>';
    }
    $recentBlocked = get_option("ai_webadmin_blocked_plugins_last", []);
    if (is_array($recentBlocked) && !empty($recentBlocked)) {
        $list = implode(", ", array_map("esc_html", $recentBlocked));
        echo '<div class="notice notice-warning"><p><strong>AI WebAdmin:</strong> Blocked risky plugin(s) were disabled: ' . $list . '.</p></div>';
        delete_option("ai_webadmin_blocked_plugins_last");
    }
    if (!empty($settings["enable_security_hardening"]) && !empty($settings["apply_htaccess_hardening"])) {
        $path = trailingslashit(ABSPATH) . ".htaccess";
        if (!file_exists($path) || !is_writable($path)) {
            echo '<div class="notice notice-warning"><p><strong>AI WebAdmin:</strong> `.htaccess` hardening is enabled but the file is missing or not writable.</p></div>';
        }
    }
    $removedMigration = get_option("ai_webadmin_removed_migration_plugins_last", []);
    if (is_array($removedMigration) && !empty($removedMigration)) {
        $list = implode(", ", array_map("esc_html", $removedMigration));
        echo '<div class="notice notice-warning"><p><strong>AI WebAdmin:</strong> Removed migration/replication plugin(s): ' . $list . '.</p></div>';
        delete_option("ai_webadmin_removed_migration_plugins_last");
    }
    $removedSmtp = get_option("ai_webadmin_removed_smtp_plugins_last", []);
    if (is_array($removedSmtp) && !empty($removedSmtp)) {
        $list = implode(", ", array_map("esc_html", $removedSmtp));
        echo '<div class="notice notice-warning"><p><strong>AI WebAdmin:</strong> Removed SMTP/email plugin(s): ' . $list . '.</p></div>';
        delete_option("ai_webadmin_removed_smtp_plugins_last");
    }
    $cleanup = get_option("ai_webadmin_inactive_user_cleanup_last", []);
    if (is_array($cleanup) && !empty($cleanup["deleted_count"])) {
        $count = (int)$cleanup["deleted_count"];
        echo '<div class="notice notice-info"><p><strong>AI WebAdmin:</strong> Inactive user cleanup removed ' . esc_html((string)$count) . ' account(s) on the last run.</p></div>';
    }
    if (!empty($settings["github_backup_last_snapshot_at"])) {
        $status = (string)($settings["github_backup_last_status"] ?? "unknown");
        $msg = (string)($settings["github_backup_last_message"] ?? "");
        $when = gmdate("Y-m-d H:i:s", (int)$settings["github_backup_last_snapshot_at"]) . " UTC";
        $klass = ($status === "ok") ? "notice-success" : "notice-warning";
        echo '<div class="notice ' . esc_attr($klass) . '"><p><strong>AI WebAdmin:</strong> Last Worker backup snapshot at ' . esc_html($when) . ' (' . esc_html($status) . '). ' . esc_html($msg) . '</p></div>';
    }
}
add_action("admin_notices", "ai_webadmin_admin_notice");

function ai_webadmin_admin_menu() {
    add_options_page(
        "AI WebAdmin",
        "AI WebAdmin",
        "manage_options",
        "ai-webadmin",
        "ai_webadmin_render_settings_page"
    );
}
add_action("admin_menu", "ai_webadmin_admin_menu");

function ai_webadmin_handle_settings_submit() {
    if (!isset($_POST["ai_webadmin_settings_submit"])) {
        return;
    }
    if (!current_user_can("manage_options")) {
        return;
    }
    check_admin_referer("ai_webadmin_settings_save", "ai_webadmin_nonce");
    $input = [
        "worker_base_url" => isset($_POST["worker_base_url"]) ? wp_unslash($_POST["worker_base_url"]) : "",
        "plugin_shared_secret" => isset($_POST["plugin_shared_secret"]) ? wp_unslash($_POST["plugin_shared_secret"]) : "",
        "onboarding_session_id" => isset($_POST["onboarding_session_id"]) ? wp_unslash($_POST["onboarding_session_id"]) : "",
        "enable_comment_moderation" => isset($_POST["enable_comment_moderation"]) ? 1 : 0,
        "enable_schema_injection" => isset($_POST["enable_schema_injection"]) ? 1 : 0,
        "enable_broken_link_redirects" => isset($_POST["enable_broken_link_redirects"]) ? 1 : 0,
        "require_tolldns" => isset($_POST["require_tolldns"]) ? 1 : 0,
        "github_signup_url" => isset($_POST["github_signup_url"]) ? wp_unslash($_POST["github_signup_url"]) : "",
        "enable_security_hardening" => isset($_POST["enable_security_hardening"]) ? 1 : 0,
        "disable_xmlrpc" => isset($_POST["disable_xmlrpc"]) ? 1 : 0,
        "prevent_email_display_name" => isset($_POST["prevent_email_display_name"]) ? 1 : 0,
        "enforce_single_admin" => isset($_POST["enforce_single_admin"]) ? 1 : 0,
        "block_file_manager_plugins" => isset($_POST["block_file_manager_plugins"]) ? 1 : 0,
        "enable_login_rate_limit" => isset($_POST["enable_login_rate_limit"]) ? 1 : 0,
        "login_rate_limit_attempts" => isset($_POST["login_rate_limit_attempts"]) ? wp_unslash($_POST["login_rate_limit_attempts"]) : "",
        "login_rate_limit_window_minutes" => isset($_POST["login_rate_limit_window_minutes"]) ? wp_unslash($_POST["login_rate_limit_window_minutes"]) : "",
        "login_rate_limit_lockout_minutes" => isset($_POST["login_rate_limit_lockout_minutes"]) ? wp_unslash($_POST["login_rate_limit_lockout_minutes"]) : "",
        "enforce_admin_sso" => isset($_POST["enforce_admin_sso"]) ? 1 : 0,
        "admin_sso_header_name" => isset($_POST["admin_sso_header_name"]) ? wp_unslash($_POST["admin_sso_header_name"]) : "",
        "apply_htaccess_hardening" => isset($_POST["apply_htaccess_hardening"]) ? 1 : 0,
        "enable_plugin_rationalization" => isset($_POST["enable_plugin_rationalization"]) ? 1 : 0,
        "remove_migration_replication_plugins" => isset($_POST["remove_migration_replication_plugins"]) ? 1 : 0,
        "enable_inactive_user_cleanup" => isset($_POST["enable_inactive_user_cleanup"]) ? 1 : 0,
        "inactive_user_days" => isset($_POST["inactive_user_days"]) ? wp_unslash($_POST["inactive_user_days"]) : "",
        "inactive_user_delete_limit" => isset($_POST["inactive_user_delete_limit"]) ? wp_unslash($_POST["inactive_user_delete_limit"]) : "",
        "github_backup_enabled" => isset($_POST["github_backup_enabled"]) ? 1 : 0,
        "github_backup_repo" => isset($_POST["github_backup_repo"]) ? wp_unslash($_POST["github_backup_repo"]) : "",
        "github_backup_branch" => isset($_POST["github_backup_branch"]) ? wp_unslash($_POST["github_backup_branch"]) : "",
        "github_backup_manifest_max_files" => isset($_POST["github_backup_manifest_max_files"]) ? wp_unslash($_POST["github_backup_manifest_max_files"]) : "",
        "enable_passcode_unlock" => isset($_POST["enable_passcode_unlock"]) ? 1 : 0,
        "unlock_passcode" => isset($_POST["unlock_passcode"]) ? wp_unslash($_POST["unlock_passcode"]) : "",
        "clear_unlock_passcode" => isset($_POST["clear_unlock_passcode"]) ? 1 : 0,
        "require_hardware_key_unlock" => isset($_POST["require_hardware_key_unlock"]) ? 1 : 0,
        "require_wallet_signature_unlock" => isset($_POST["require_wallet_signature_unlock"]) ? 1 : 0,
        "wallet_unlock_message_prefix" => isset($_POST["wallet_unlock_message_prefix"]) ? wp_unslash($_POST["wallet_unlock_message_prefix"]) : "",
        "wallet_unlock_chain_id" => isset($_POST["wallet_unlock_chain_id"]) ? wp_unslash($_POST["wallet_unlock_chain_id"]) : "",
        "wallet_unlock_nonce_ttl_minutes" => isset($_POST["wallet_unlock_nonce_ttl_minutes"]) ? wp_unslash($_POST["wallet_unlock_nonce_ttl_minutes"]) : "",
        "enable_email_forwarding_via_worker" => isset($_POST["enable_email_forwarding_via_worker"]) ? 1 : 0,
        "remove_smtp_plugins" => isset($_POST["remove_smtp_plugins"]) ? 1 : 0,
        "lead_forward_email" => isset($_POST["lead_forward_email"]) ? wp_unslash($_POST["lead_forward_email"]) : "",
        "suppress_local_lead_mail" => isset($_POST["suppress_local_lead_mail"]) ? 1 : 0,
    ];
    $githubToken = isset($_POST["github_classic_token"]) ? trim((string)wp_unslash($_POST["github_classic_token"])) : "";
    ai_webadmin_save_settings($input);
    ai_webadmin_run_hardening_pass(true);
    ai_webadmin_sync_email_forwarding_profile();
    ai_webadmin_sweep_email_display_names(500);
    ai_webadmin_purge_inactive_users();

    if ($githubToken !== "") {
        $connect = ai_webadmin_connect_github_vault($githubToken);
        if (!empty($connect["ok"])) {
            add_settings_error("ai_webadmin_messages", "ai_webadmin_github_connected", "GitHub token stored in Cloudflare vault successfully.", "updated");
        } else {
            $msg = "GitHub token sync failed: " . sanitize_text_field((string)($connect["error"] ?? "unknown_error"));
            add_settings_error("ai_webadmin_messages", "ai_webadmin_github_failed", $msg, "error");
        }
    }
    add_settings_error("ai_webadmin_messages", "ai_webadmin_saved", "Settings saved.", "updated");
}
add_action("admin_init", "ai_webadmin_handle_settings_submit");

function ai_webadmin_render_settings_page() {
    if (!current_user_can("manage_options")) {
        return;
    }
    $settings = ai_webadmin_get_settings();
    settings_errors("ai_webadmin_messages");
    ?>
    <div class="wrap">
      <h1>AI WebAdmin</h1>
      <p>Connect WordPress to Cloudflare Workers for AI moderation and maintenance workflows.</p>
      <form method="post">
        <?php wp_nonce_field("ai_webadmin_settings_save", "ai_webadmin_nonce"); ?>
        <table class="form-table" role="presentation">
          <tr>
            <th scope="row"><label for="worker_base_url">Worker Base URL</label></th>
            <td><input name="worker_base_url" id="worker_base_url" type="url" class="regular-text" value="<?php echo esc_attr($settings["worker_base_url"]); ?>" /></td>
          </tr>
          <tr>
            <th scope="row"><label for="plugin_shared_secret">Plugin Shared Secret</label></th>
            <td><input name="plugin_shared_secret" id="plugin_shared_secret" type="text" class="regular-text" value="<?php echo esc_attr($settings["plugin_shared_secret"]); ?>" /></td>
          </tr>
          <tr>
            <th scope="row"><label for="onboarding_session_id">Onboarding Session ID</label></th>
            <td>
              <input name="onboarding_session_id" id="onboarding_session_id" type="text" class="regular-text" value="<?php echo esc_attr($settings["onboarding_session_id"]); ?>" />
              <p class="description">Optional: link plugin telemetry to the same chat audit session.</p>
            </td>
          </tr>
          <tr>
            <th scope="row">Features</th>
            <td>
              <label><input name="enable_comment_moderation" type="checkbox" value="1" <?php checked((int)$settings["enable_comment_moderation"], 1); ?> /> Enable comment moderation via Worker</label><br/>
              <label><input name="enable_schema_injection" type="checkbox" value="1" <?php checked((int)$settings["enable_schema_injection"], 1); ?> /> Enable schema JSON-LD injection from chat profile</label><br/>
              <label><input name="enable_broken_link_redirects" type="checkbox" value="1" <?php checked((int)$settings["enable_broken_link_redirects"], 1); ?> /> Enable 301 fallback for audited broken internal links</label><br/>
              <label><input name="require_tolldns" type="checkbox" value="1" <?php checked((int)$settings["require_tolldns"], 1); ?> /> Require TollDNS (free tier requirement)</label>
            </td>
          </tr>
          <tr>
            <th scope="row">Security Hardening</th>
            <td>
              <label><input name="enable_security_hardening" type="checkbox" value="1" <?php checked((int)$settings["enable_security_hardening"], 1); ?> /> Enable hardening controls</label><br/>
              <label><input name="disable_xmlrpc" type="checkbox" value="1" <?php checked((int)$settings["disable_xmlrpc"], 1); ?> /> Disable XML-RPC</label><br/>
              <label><input name="prevent_email_display_name" type="checkbox" value="1" <?php checked((int)$settings["prevent_email_display_name"], 1); ?> /> Prevent email addresses as display names</label><br/>
              <label><input name="enforce_single_admin" type="checkbox" value="1" <?php checked((int)$settings["enforce_single_admin"], 1); ?> /> Keep only one Administrator role (demote others to Editor)</label><br/>
              <label><input name="block_file_manager_plugins" type="checkbox" value="1" <?php checked((int)$settings["block_file_manager_plugins"], 1); ?> /> Block risky file-manager plugins</label><br/>
              <label><input name="enable_login_rate_limit" type="checkbox" value="1" <?php checked((int)$settings["enable_login_rate_limit"], 1); ?> /> Limit brute-force login attempts</label><br/>
              <label><input name="enforce_admin_sso" type="checkbox" value="1" <?php checked((int)$settings["enforce_admin_sso"], 1); ?> /> Require SSO header for Administrator logins (non-admin password login remains enabled)</label><br/>
              <label><input name="apply_htaccess_hardening" type="checkbox" value="1" <?php checked((int)$settings["apply_htaccess_hardening"], 1); ?> /> Apply Apache/LiteSpeed `.htaccess` hardening rules</label>
            </td>
          </tr>
          <tr>
            <th scope="row">Login Throttle</th>
            <td>
              <label for="login_rate_limit_attempts">Max attempts</label>
              <input name="login_rate_limit_attempts" id="login_rate_limit_attempts" type="number" min="3" max="20" value="<?php echo esc_attr((string)$settings["login_rate_limit_attempts"]); ?>" />
              <label for="login_rate_limit_window_minutes">Window (minutes)</label>
              <input name="login_rate_limit_window_minutes" id="login_rate_limit_window_minutes" type="number" min="1" max="60" value="<?php echo esc_attr((string)$settings["login_rate_limit_window_minutes"]); ?>" />
              <label for="login_rate_limit_lockout_minutes">Lockout (minutes)</label>
              <input name="login_rate_limit_lockout_minutes" id="login_rate_limit_lockout_minutes" type="number" min="1" max="240" value="<?php echo esc_attr((string)$settings["login_rate_limit_lockout_minutes"]); ?>" />
            </td>
          </tr>
          <tr>
            <th scope="row"><label for="admin_sso_header_name">Admin SSO Header</label></th>
            <td>
              <input name="admin_sso_header_name" id="admin_sso_header_name" type="text" class="regular-text" value="<?php echo esc_attr($settings["admin_sso_header_name"]); ?>" />
              <p class="description">Default for Cloudflare Access: <code>CF-Access-Authenticated-User-Email</code>.</p>
            </td>
          </tr>
          <tr>
            <th scope="row">Unlock Options</th>
            <td>
              <label><input name="enable_passcode_unlock" type="checkbox" value="1" <?php checked((int)$settings["enable_passcode_unlock"], 1); ?> /> Require passcode unlock on login</label><br/>
              <label><input name="require_hardware_key_unlock" type="checkbox" value="1" <?php checked((int)$settings["require_hardware_key_unlock"], 1); ?> /> Require hardware key/passkey verification (WebAuthn integration)</label><br/>
              <label><input name="require_wallet_signature_unlock" type="checkbox" value="1" <?php checked((int)$settings["require_wallet_signature_unlock"], 1); ?> /> Require Web3 wallet signature unlock</label>
            </td>
          </tr>
          <tr>
            <th scope="row">Passcode Unlock</th>
            <td>
              <label for="unlock_passcode">New passcode (leave blank to keep current)</label><br/>
              <input name="unlock_passcode" id="unlock_passcode" type="password" class="regular-text" value="" autocomplete="new-password" /><br/>
              <label><input name="clear_unlock_passcode" type="checkbox" value="1" /> Clear saved passcode</label>
            </td>
          </tr>
          <tr>
            <th scope="row">Wallet Unlock</th>
            <td>
              <label for="wallet_unlock_message_prefix">Challenge message prefix</label><br/>
              <input name="wallet_unlock_message_prefix" id="wallet_unlock_message_prefix" type="text" class="regular-text" value="<?php echo esc_attr($settings["wallet_unlock_message_prefix"]); ?>" /><br/>
              <label for="wallet_unlock_chain_id">Chain ID</label>
              <input name="wallet_unlock_chain_id" id="wallet_unlock_chain_id" type="number" min="1" max="999999" value="<?php echo esc_attr((string)$settings["wallet_unlock_chain_id"]); ?>" />
              <label for="wallet_unlock_nonce_ttl_minutes">Nonce TTL (minutes)</label>
              <input name="wallet_unlock_nonce_ttl_minutes" id="wallet_unlock_nonce_ttl_minutes" type="number" min="3" max="30" value="<?php echo esc_attr((string)$settings["wallet_unlock_nonce_ttl_minutes"]); ?>" />
              <p class="description">Wallet verification is validated by Worker endpoint <code>/plugin/wp/auth/wallet/verify</code>.</p>
            </td>
          </tr>
          <tr>
            <th scope="row">Email Forwarding</th>
            <td>
              <label><input name="enable_email_forwarding_via_worker" type="checkbox" value="1" <?php checked((int)$settings["enable_email_forwarding_via_worker"], 1); ?> /> Forward lead-form emails through Cloudflare Worker</label><br/>
              <label><input name="remove_smtp_plugins" type="checkbox" value="1" <?php checked((int)$settings["remove_smtp_plugins"], 1); ?> /> Remove SMTP/email plugins automatically</label><br/>
              <label><input name="suppress_local_lead_mail" type="checkbox" value="1" <?php checked((int)$settings["suppress_local_lead_mail"], 1); ?> /> Suppress local lead-email delivery after Worker accepts the event</label><br/>
              <label for="lead_forward_email">Lead forward destination email (defaults to primary admin)</label><br/>
              <input name="lead_forward_email" id="lead_forward_email" type="email" class="regular-text" value="<?php echo esc_attr((string)$settings["lead_forward_email"]); ?>" />
              <p class="description">If your domain already has MX records, we still sync MX/provider hints so Worker routing can hand off to webhook-based forwarding.</p>
            </td>
          </tr>
          <tr>
            <th scope="row">Plugin/User Cleanup</th>
            <td>
              <label><input name="enable_plugin_rationalization" type="checkbox" value="1" <?php checked((int)$settings["enable_plugin_rationalization"], 1); ?> /> Audit plugin inventory and flag unneeded/lazy installs</label><br/>
              <label><input name="remove_migration_replication_plugins" type="checkbox" value="1" <?php checked((int)$settings["remove_migration_replication_plugins"], 1); ?> /> Remove migration/DB replication plugins automatically</label><br/>
              <label><input name="enable_inactive_user_cleanup" type="checkbox" value="1" <?php checked((int)$settings["enable_inactive_user_cleanup"], 1); ?> /> Delete users with no login for over N days</label>
            </td>
          </tr>
          <tr>
            <th scope="row">Inactive User Cleanup</th>
            <td>
              <label for="inactive_user_days">Inactive for (days)</label>
              <input name="inactive_user_days" id="inactive_user_days" type="number" min="30" max="3650" value="<?php echo esc_attr((string)$settings["inactive_user_days"]); ?>" />
              <label for="inactive_user_delete_limit">Delete limit per run</label>
              <input name="inactive_user_delete_limit" id="inactive_user_delete_limit" type="number" min="1" max="500" value="<?php echo esc_attr((string)$settings["inactive_user_delete_limit"]); ?>" />
              <p class="description">Primary admin is protected. Other admin users are handled by single-admin enforcement.</p>
            </td>
          </tr>
          <tr>
            <th scope="row">GitHub Backup Gateway</th>
            <td>
              <label><input name="github_backup_enabled" type="checkbox" value="1" <?php checked((int)$settings["github_backup_enabled"], 1); ?> /> Enable daily worker snapshot backups</label><br/>
              <label for="github_backup_repo">Repo (owner/repo)</label><br/>
              <input name="github_backup_repo" id="github_backup_repo" type="text" class="regular-text" placeholder="owner/repo" value="<?php echo esc_attr($settings["github_backup_repo"]); ?>" /><br/>
              <label for="github_backup_branch">Branch</label>
              <input name="github_backup_branch" id="github_backup_branch" type="text" value="<?php echo esc_attr($settings["github_backup_branch"]); ?>" />
              <label for="github_backup_manifest_max_files">Max files in snapshot manifest</label>
              <input name="github_backup_manifest_max_files" id="github_backup_manifest_max_files" type="number" min="500" max="12000" value="<?php echo esc_attr((string)$settings["github_backup_manifest_max_files"]); ?>" /><br/>
              <label for="github_classic_token">GitHub classic token (submitted to Worker vault, not stored in WP)</label><br/>
              <input name="github_classic_token" id="github_classic_token" type="password" class="regular-text" value="" autocomplete="new-password" />
              <p class="description">Use a classic token with repo write access. We send it to Cloudflare Worker vault and store only masked status in WordPress.</p>
              <p>
                Vault status:
                <?php if (!empty($settings["github_vault_connected"])): ?>
                  <strong>Connected</strong>
                  <?php if (!empty($settings["github_vault_token_masked"])): ?>
                    (<?php echo esc_html($settings["github_vault_token_masked"]); ?>)
                  <?php endif; ?>
                <?php else: ?>
                  <strong>Not connected</strong>
                <?php endif; ?>
              </p>
            </td>
          </tr>
          <tr>
            <th scope="row"><label for="github_signup_url">GitHub Signup URL</label></th>
            <td>
              <input name="github_signup_url" id="github_signup_url" type="url" class="regular-text" value="<?php echo esc_attr($settings["github_signup_url"]); ?>" />
              <p class="description">Shown as a recommended step for sandbox backups before plugin/theme updates.</p>
              <?php if (!empty($settings["github_signup_url"])): ?>
                <p><a class="button" href="<?php echo esc_url($settings["github_signup_url"]); ?>" target="_blank" rel="noopener noreferrer">Sign up for GitHub</a></p>
              <?php endif; ?>
            </td>
          </tr>
        </table>
        <p class="submit">
          <button type="submit" name="ai_webadmin_settings_submit" class="button button-primary">Save Changes</button>
        </p>
      </form>
    </div>
    <?php
}

function ai_webadmin_queue_comment($comment_ID, $comment_approved) {
    $settings = ai_webadmin_get_settings();
    if (empty($settings["enable_comment_moderation"])) {
        return;
    }
    if (!in_array((string)$comment_approved, ["0", "1"], true)) {
        return;
    }
    if (!wp_next_scheduled("ai_webadmin_moderate_comment_event", [$comment_ID])) {
        wp_schedule_single_event(time() + 5, "ai_webadmin_moderate_comment_event", [$comment_ID]);
    }
}
add_action("comment_post", "ai_webadmin_queue_comment", 10, 2);

function ai_webadmin_build_signature($timestamp, $body, $secret) {
    return hash_hmac("sha256", $timestamp . "." . $body, $secret);
}

function ai_webadmin_detect_redundant_plugins($activePluginData) {
    $groups = [
        "seo" => ["seo", "rank math", "yoast", "aioseo"],
        "cache" => ["cache", "litespeed", "wp rocket", "autoptimize", "w3 total cache"],
        "security" => ["security", "wordfence", "sucuri", "ithemes", "solid security"],
        "forms" => ["form", "gravity", "wpforms", "contact form", "ninja forms"],
        "backup" => ["backup", "updraft", "vaultpress", "duplicator"],
        "analytics" => ["analytics", "ga4", "google site kit", "pixel"],
        "booking" => ["booking", "appointments", "calendar"],
    ];
    $bucketCounts = [];
    foreach ($groups as $g => $_) {
        $bucketCounts[$g] = 0;
    }

    foreach ($activePluginData as $pluginData) {
        $name = strtolower((string)($pluginData["Name"] ?? ""));
        if ($name === "") {
            continue;
        }
        foreach ($groups as $group => $needles) {
            foreach ($needles as $needle) {
                if (strpos($name, $needle) !== false) {
                    $bucketCounts[$group] += 1;
                    break;
                }
            }
        }
    }

    $redundant = 0;
    foreach ($bucketCounts as $count) {
        if ($count > 1) {
            $redundant += ($count - 1);
        }
    }
    return max(0, (int)$redundant);
}

function ai_webadmin_detect_sso_plugins($activePluginData) {
    $count = 0;
    foreach ($activePluginData as $pluginData) {
        $name = strtolower((string)($pluginData["Name"] ?? ""));
        if ($name === "") {
            continue;
        }
        if (
            strpos($name, "sso") !== false ||
            strpos($name, "oauth") !== false ||
            strpos($name, "social login") !== false ||
            strpos($name, "nextend") !== false ||
            strpos($name, "miniorange") !== false ||
            strpos($name, "cloudflare access") !== false
        ) {
            $count += 1;
        }
    }
    return max(0, (int)$count);
}

function ai_webadmin_plugin_audit_summary($allPlugins, $activePluginSlugs) {
    $activeLookup = [];
    foreach ((array)$activePluginSlugs as $slug) {
        $activeLookup[(string)$slug] = true;
    }

    $migrationSlugs = ai_webadmin_migration_replication_plugin_slugs();
    $migrationLookup = array_fill_keys($migrationSlugs, true);
    $unneeded = [];
    $inactive = [];
    $migration = [];

    foreach ((array)$allPlugins as $slug => $pluginData) {
        $slug = (string)$slug;
        $name = strtolower((string)($pluginData["Name"] ?? ""));
        $isActive = isset($activeLookup[$slug]);
        if (!$isActive) {
            $inactive[] = $slug;
            $unneeded[] = $slug;
        }
        if (isset($migrationLookup[$slug])) {
            $migration[] = $slug;
            if (!in_array($slug, $unneeded, true)) {
                $unneeded[] = $slug;
            }
        }
        if (strpos($name, "hello dolly") !== false || strpos($name, "sample") !== false || strpos($name, "demo") !== false) {
            if (!in_array($slug, $unneeded, true)) {
                $unneeded[] = $slug;
            }
        }
    }

    return [
        "plugin_total_count" => count((array)$allPlugins),
        "active_plugin_count" => count((array)$activePluginSlugs),
        "inactive_plugin_count" => count($inactive),
        "migration_plugin_count" => count($migration),
        "unneeded_plugin_count" => count($unneeded),
        "inactive_plugin_slugs" => array_slice(array_values(array_unique($inactive)), 0, 200),
        "migration_plugin_slugs" => array_slice(array_values(array_unique($migration)), 0, 200),
        "unneeded_plugin_slugs" => array_slice(array_values(array_unique($unneeded)), 0, 200),
    ];
}

function ai_webadmin_collect_audit_metrics() {
    if (!function_exists("get_plugin_updates") || !function_exists("get_plugins")) {
        require_once ABSPATH . "wp-admin/includes/plugin.php";
        require_once ABSPATH . "wp-admin/includes/update.php";
    }
    $updates = function_exists("get_plugin_updates") ? get_plugin_updates() : [];
    $allPlugins = function_exists("get_plugins") ? get_plugins() : [];
    $activePluginSlugs = (array)get_option("active_plugins", []);
    $activeData = [];
    foreach ($activePluginSlugs as $slug) {
        if (isset($allPlugins[$slug]) && is_array($allPlugins[$slug])) {
            $activeData[] = $allPlugins[$slug];
        }
    }
    $pluginAudit = ai_webadmin_plugin_audit_summary($allPlugins, $activePluginSlugs);
    $inactiveCount = (int)$pluginAudit["inactive_plugin_count"];
    $redundantCount = ai_webadmin_detect_redundant_plugins($activeData);
    $ssoPluginCount = ai_webadmin_detect_sso_plugins($activeData);
    $smtpPluginCount = ai_webadmin_count_active_smtp_plugins($activePluginSlugs);

    $pendingComments = (int)get_comments([
        "status" => "hold",
        "count" => true,
        "type" => "comment",
    ]);
    $emailQueue = apply_filters("ai_webadmin_email_queue_count", null);
    $emailQueueCount = is_numeric($emailQueue) ? max(0, (int)$emailQueue) : null;
    $lastCleanup = get_option("ai_webadmin_inactive_user_cleanup_last", []);
    $inactiveDeleted = is_array($lastCleanup) ? max(0, (int)($lastCleanup["deleted_count"] ?? 0)) : 0;
    $inactiveCandidates = is_array($lastCleanup) ? max(0, (int)($lastCleanup["candidate_count"] ?? 0)) : 0;

    return [
        "email_queue_count" => $emailQueueCount,
        "outdated_plugin_count" => is_array($updates) ? count($updates) : 0,
        "inactive_plugin_count" => $inactiveCount,
        "redundant_plugin_count" => $redundantCount,
        "sso_plugin_count" => $ssoPluginCount,
        "pending_comment_moderation_count" => max(0, $pendingComments),
        "plugin_total_count" => (int)$pluginAudit["plugin_total_count"],
        "active_plugin_count" => (int)$pluginAudit["active_plugin_count"],
        "migration_plugin_count" => (int)$pluginAudit["migration_plugin_count"],
        "unneeded_plugin_count" => (int)$pluginAudit["unneeded_plugin_count"],
        "inactive_user_deleted_count" => $inactiveDeleted,
        "inactive_user_candidate_count" => $inactiveCandidates,
        "smtp_plugin_count" => $smtpPluginCount,
        "plugin_inventory" => [
            "inactive_plugin_slugs" => $pluginAudit["inactive_plugin_slugs"],
            "migration_plugin_slugs" => $pluginAudit["migration_plugin_slugs"],
            "unneeded_plugin_slugs" => $pluginAudit["unneeded_plugin_slugs"],
        ],
    ];
}

function ai_webadmin_signed_post($settings, $path, $payload, $timeout = 8) {
    $body = wp_json_encode($payload);
    if (!$body) {
        return null;
    }

    $timestamp = (string)time();
    $sig = ai_webadmin_build_signature($timestamp, $body, $settings["plugin_shared_secret"]);
    $endpoint = trailingslashit($settings["worker_base_url"]) . ltrim((string)$path, "/");
    return wp_remote_post($endpoint, [
        "method" => "POST",
        "timeout" => max(3, (int)$timeout),
        "headers" => [
            "Content-Type" => "application/json",
            "X-Plugin-Timestamp" => $timestamp,
            "X-Plugin-Signature" => $sig,
        ],
        "body" => $body,
    ]);
}

function ai_webadmin_send_audit_metrics() {
    $settings = ai_webadmin_get_settings();
    if (!ai_webadmin_features_enabled()) {
        return;
    }
    $sessionId = trim((string)($settings["onboarding_session_id"] ?? ""));
    if ($sessionId === "") {
        return;
    }

    $metrics = ai_webadmin_collect_audit_metrics();
    ai_webadmin_signed_post($settings, "plugin/wp/audit/sync", [
        "session_id" => $sessionId,
        "site_url" => home_url("/"),
        "email_queue_count" => $metrics["email_queue_count"],
        "outdated_plugin_count" => $metrics["outdated_plugin_count"],
        "inactive_plugin_count" => $metrics["inactive_plugin_count"],
        "redundant_plugin_count" => $metrics["redundant_plugin_count"],
        "sso_plugin_count" => $metrics["sso_plugin_count"],
        "pending_comment_moderation_count" => $metrics["pending_comment_moderation_count"],
        "plugin_total_count" => $metrics["plugin_total_count"],
        "active_plugin_count" => $metrics["active_plugin_count"],
        "migration_plugin_count" => $metrics["migration_plugin_count"],
        "unneeded_plugin_count" => $metrics["unneeded_plugin_count"],
        "inactive_user_deleted_count" => $metrics["inactive_user_deleted_count"],
        "inactive_user_candidate_count" => $metrics["inactive_user_candidate_count"],
        "smtp_plugin_count" => $metrics["smtp_plugin_count"],
        "plugin_inventory" => $metrics["plugin_inventory"],
    ]);
}

function ai_webadmin_save_runtime_settings_patch($patch) {
    if (!is_array($patch) || empty($patch)) {
        return;
    }
    $current = ai_webadmin_get_settings();
    $next = array_merge($current, $patch);
    update_option(AI_WEBADMIN_OPTION_KEY, $next, false);
}

function ai_webadmin_connect_github_vault($githubToken) {
    $token = trim((string)$githubToken);
    if ($token === "") {
        return ["ok" => false, "error" => "missing_token"];
    }
    $settings = ai_webadmin_get_settings();
    if (!ai_webadmin_features_enabled()) {
        return ["ok" => false, "error" => "worker_not_configured"];
    }
    $sessionId = trim((string)($settings["onboarding_session_id"] ?? ""));
    $repoSlug = ai_webadmin_parse_repo_slug($settings["github_backup_repo"] ?? "");
    $branch = sanitize_text_field(trim((string)($settings["github_backup_branch"] ?? "main")));
    if ($sessionId === "") {
        return ["ok" => false, "error" => "missing_session_id"];
    }
    if ($repoSlug === null) {
        return ["ok" => false, "error" => "missing_or_invalid_repo"];
    }
    if ($branch === "") {
        $branch = "main";
    }

    $response = ai_webadmin_signed_post($settings, "plugin/wp/github/vault", [
        "session_id" => $sessionId,
        "site_url" => home_url("/"),
        "github_repo" => $repoSlug,
        "github_branch" => $branch,
        "github_token" => $token,
    ], 20);
    if (is_wp_error($response)) {
        return ["ok" => false, "error" => $response->get_error_message()];
    }
    $code = (int)wp_remote_retrieve_response_code($response);
    $body = wp_remote_retrieve_body($response);
    $decoded = json_decode($body, true);
    if ($code < 200 || $code >= 300 || !is_array($decoded) || empty($decoded["ok"])) {
        return [
            "ok" => false,
            "error" => is_array($decoded) && !empty($decoded["error"]) ? (string)$decoded["error"] : "vault_connect_failed",
        ];
    }

    ai_webadmin_save_runtime_settings_patch([
        "github_vault_connected" => 1,
        "github_vault_token_masked" => sanitize_text_field((string)($decoded["token_masked"] ?? "")),
        "github_vault_last_connected_at" => time(),
    ]);

    return [
        "ok" => true,
        "token_masked" => (string)($decoded["token_masked"] ?? ""),
        "repo" => (string)($decoded["github_repo"] ?? $repoSlug),
        "branch" => (string)($decoded["github_branch"] ?? $branch),
    ];
}

function ai_webadmin_send_backup_snapshot() {
    $settings = ai_webadmin_get_settings();
    if (empty($settings["github_backup_enabled"])) {
        return;
    }
    if (!ai_webadmin_features_enabled()) {
        return;
    }
    $sessionId = trim((string)($settings["onboarding_session_id"] ?? ""));
    $repoSlug = ai_webadmin_parse_repo_slug($settings["github_backup_repo"] ?? "");
    if ($sessionId === "" || $repoSlug === null) {
        return;
    }

    $manifest = ai_webadmin_collect_site_manifest((int)$settings["github_backup_manifest_max_files"]);
    $payload = [
        "session_id" => $sessionId,
        "site_url" => home_url("/"),
        "github_repo" => $repoSlug,
        "github_branch" => sanitize_text_field((string)($settings["github_backup_branch"] ?? "main")),
        "snapshot" => $manifest,
    ];
    $response = ai_webadmin_signed_post($settings, "plugin/wp/backup/snapshot", $payload, 45);
    if (is_wp_error($response)) {
        ai_webadmin_save_runtime_settings_patch([
            "github_backup_last_snapshot_at" => time(),
            "github_backup_last_status" => "error",
            "github_backup_last_message" => sanitize_text_field($response->get_error_message()),
        ]);
        return;
    }

    $code = (int)wp_remote_retrieve_response_code($response);
    $body = wp_remote_retrieve_body($response);
    $decoded = json_decode($body, true);
    $ok = ($code >= 200 && $code < 300 && is_array($decoded) && !empty($decoded["ok"]));
    ai_webadmin_save_runtime_settings_patch([
        "github_backup_last_snapshot_at" => time(),
        "github_backup_last_status" => $ok ? "ok" : "error",
        "github_backup_last_message" => $ok
            ? sanitize_text_field((string)($decoded["message"] ?? "snapshot_sent"))
            : sanitize_text_field(is_array($decoded) && !empty($decoded["error"]) ? (string)$decoded["error"] : ("worker_http_" . $code)),
    ]);
}

function ai_webadmin_fetch_schema_profile() {
    $settings = ai_webadmin_get_settings();
    if (!ai_webadmin_features_enabled()) {
        return;
    }
    if (empty($settings["enable_schema_injection"])) {
        return;
    }
    $sessionId = trim((string)($settings["onboarding_session_id"] ?? ""));
    if ($sessionId === "") {
        return;
    }

    $response = ai_webadmin_signed_post($settings, "plugin/wp/schema/profile", [
        "session_id" => $sessionId,
        "site_url" => home_url("/"),
    ]);
    if (is_wp_error($response)) {
        return;
    }

    $code = (int)wp_remote_retrieve_response_code($response);
    if ($code < 200 || $code >= 300) {
        return;
    }
    $body = wp_remote_retrieve_body($response);
    $decoded = json_decode($body, true);
    if (!is_array($decoded) || empty($decoded["ok"])) {
        return;
    }
    $jsonld = isset($decoded["schema_jsonld"]) ? (string)$decoded["schema_jsonld"] : "";
    if ($jsonld === "") {
        return;
    }
    update_option("ai_webadmin_schema_jsonld", $jsonld, false);
    update_option("ai_webadmin_schema_synced_at", time(), false);
}

function ai_webadmin_normalize_redirect_path($rawPath) {
    $path = trim((string)$rawPath);
    if ($path === "") {
        return null;
    }
    if (preg_match("#^https?://#i", $path)) {
        $parsed = wp_parse_url($path);
        if (!is_array($parsed) || empty($parsed["path"])) {
            return null;
        }
        $path = (string)$parsed["path"];
        if (!empty($parsed["query"])) {
            $path .= "?" . (string)$parsed["query"];
        }
    }
    if (strpos($path, "/") !== 0) {
        $path = "/" . $path;
    }
    $path = preg_replace("#/+#", "/", $path);
    if (!is_string($path) || strlen($path) > 240) {
        return null;
    }
    if ($path === "/" || strpos($path, "/wp-admin") === 0 || strpos($path, "/wp-login.php") === 0 || strpos($path, "/wp-json") === 0) {
        return null;
    }
    return $path;
}

function ai_webadmin_fetch_redirect_profile() {
    $settings = ai_webadmin_get_settings();
    if (!ai_webadmin_features_enabled()) {
        return;
    }
    if (empty($settings["enable_broken_link_redirects"])) {
        return;
    }
    $sessionId = trim((string)($settings["onboarding_session_id"] ?? ""));
    if ($sessionId === "") {
        return;
    }

    $response = ai_webadmin_signed_post($settings, "plugin/wp/redirects/profile", [
        "session_id" => $sessionId,
        "site_url" => home_url("/"),
    ]);
    if (is_wp_error($response)) {
        return;
    }

    $code = (int)wp_remote_retrieve_response_code($response);
    if ($code < 200 || $code >= 300) {
        return;
    }
    $body = wp_remote_retrieve_body($response);
    $decoded = json_decode($body, true);
    if (!is_array($decoded) || empty($decoded["ok"])) {
        return;
    }

    $rawPaths = isset($decoded["redirect_paths"]) && is_array($decoded["redirect_paths"]) ? $decoded["redirect_paths"] : [];
    $paths = [];
    foreach ($rawPaths as $rawPath) {
        $norm = ai_webadmin_normalize_redirect_path($rawPath);
        if ($norm === null) {
            continue;
        }
        $paths[$norm] = true;
    }
    $finalPaths = array_slice(array_keys($paths), 0, 200);
    update_option("ai_webadmin_redirect_paths", $finalPaths, false);
    update_option("ai_webadmin_redirect_synced_at", time(), false);
}

function ai_webadmin_sync_worker_data() {
    ai_webadmin_send_audit_metrics();
    ai_webadmin_sync_email_forwarding_profile();
    ai_webadmin_fetch_schema_profile();
    ai_webadmin_fetch_redirect_profile();
}

function ai_webadmin_activate() {
    if (!wp_next_scheduled("ai_webadmin_sync_audit_metrics_event")) {
        wp_schedule_event(time() + 90, "hourly", "ai_webadmin_sync_audit_metrics_event");
    }
    if (!wp_next_scheduled("ai_webadmin_daily_hardening_event")) {
        wp_schedule_event(time() + 300, "daily", "ai_webadmin_daily_hardening_event");
    }
    ai_webadmin_boot_hardening_hooks();
    ai_webadmin_run_hardening_pass(true);
    ai_webadmin_sweep_email_display_names(500);
    ai_webadmin_sync_worker_data();
    ai_webadmin_send_backup_snapshot();
}
register_activation_hook(__FILE__, "ai_webadmin_activate");

function ai_webadmin_deactivate() {
    $ts = wp_next_scheduled("ai_webadmin_sync_audit_metrics_event");
    if ($ts) {
        wp_unschedule_event($ts, "ai_webadmin_sync_audit_metrics_event");
    }
    $hardeningTs = wp_next_scheduled("ai_webadmin_daily_hardening_event");
    if ($hardeningTs) {
        wp_unschedule_event($hardeningTs, "ai_webadmin_daily_hardening_event");
    }
}
register_deactivation_hook(__FILE__, "ai_webadmin_deactivate");

add_action("ai_webadmin_sync_audit_metrics_event", "ai_webadmin_sync_worker_data");

function ai_webadmin_daily_hardening_runner() {
    ai_webadmin_run_hardening_pass(true);
    ai_webadmin_sweep_email_display_names(500);
    ai_webadmin_purge_inactive_users();
    ai_webadmin_send_audit_metrics();
    ai_webadmin_sync_email_forwarding_profile();
    ai_webadmin_send_backup_snapshot();
}
add_action("ai_webadmin_daily_hardening_event", "ai_webadmin_daily_hardening_runner");

function ai_webadmin_output_schema_jsonld() {
    $settings = ai_webadmin_get_settings();
    if (empty($settings["enable_schema_injection"])) {
        return;
    }
    $json = get_option("ai_webadmin_schema_jsonld", "");
    if (!is_string($json) || trim($json) === "") {
        return;
    }
    $decoded = json_decode($json, true);
    if (!is_array($decoded) || empty($decoded["@context"]) || empty($decoded["@type"])) {
        return;
    }
    echo "<script type=\"application/ld+json\">" . wp_json_encode($decoded, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "</script>\n";
}
add_action("wp_head", "ai_webadmin_output_schema_jsonld", 5);

function ai_webadmin_apply_broken_link_redirects() {
    $settings = ai_webadmin_get_settings();
    if (empty($settings["enable_broken_link_redirects"])) {
        return;
    }
    if (is_admin()) {
        return;
    }
    if (function_exists("wp_doing_ajax") && wp_doing_ajax()) {
        return;
    }
    if (function_exists("wp_doing_cron") && wp_doing_cron()) {
        return;
    }

    $requestUri = isset($_SERVER["REQUEST_URI"]) ? (string)$_SERVER["REQUEST_URI"] : "/";
    $path = ai_webadmin_normalize_redirect_path($requestUri);
    if ($path === null) {
        return;
    }
    $redirectPaths = get_option("ai_webadmin_redirect_paths", []);
    if (!is_array($redirectPaths) || empty($redirectPaths)) {
        return;
    }
    if (!in_array($path, $redirectPaths, true)) {
        return;
    }
    wp_safe_redirect(home_url("/"), 301);
    exit;
}
add_action("template_redirect", "ai_webadmin_apply_broken_link_redirects", 1);

function ai_webadmin_comment_payload($comment) {
    return [
        "site_url" => home_url("/"),
        "comment_id" => (int)$comment->comment_ID,
        "content" => (string)$comment->comment_content,
        "author_name" => (string)$comment->comment_author,
        "author_email" => (string)$comment->comment_author_email,
        "author_url" => (string)$comment->comment_author_url,
        "ip" => (string)$comment->comment_author_IP,
        "user_agent" => (string)$comment->comment_agent,
    ];
}

function ai_webadmin_apply_moderation_action($commentId, $action) {
    if ($action === "trash") {
        wp_trash_comment($commentId);
        return "trash";
    }
    if ($action === "spam") {
        wp_spam_comment($commentId);
        return "spam";
    }
    if ($action === "hold") {
        wp_set_comment_status($commentId, "hold");
        return "hold";
    }
    return "approve";
}

function ai_webadmin_handle_comment_moderation($commentId) {
    $settings = ai_webadmin_get_settings();
    if (empty($settings["enable_comment_moderation"])) {
        return;
    }
    if (!ai_webadmin_features_enabled()) {
        return;
    }
    ai_webadmin_send_audit_metrics();

    $comment = get_comment((int)$commentId);
    if (!$comment || empty($comment->comment_ID)) {
        return;
    }
    if (in_array($comment->comment_type, ["pingback", "trackback"], true)) {
        return;
    }
    if (in_array($comment->comment_approved, ["spam", "trash"], true)) {
        return;
    }

    $payload = ai_webadmin_comment_payload($comment);
    $body = wp_json_encode($payload);
    if (!$body) {
        return;
    }

    $timestamp = (string)time();
    $sig = ai_webadmin_build_signature($timestamp, $body, $settings["plugin_shared_secret"]);
    $endpoint = trailingslashit($settings["worker_base_url"]) . "plugin/wp/comments/moderate";

    $response = wp_remote_post($endpoint, [
        "method" => "POST",
        "timeout" => 8,
        "headers" => [
            "Content-Type" => "application/json",
            "X-Plugin-Timestamp" => $timestamp,
            "X-Plugin-Signature" => $sig,
        ],
        "body" => $body,
    ]);

    if (is_wp_error($response)) {
        update_comment_meta($comment->comment_ID, "_ai_webadmin_moderation_error", $response->get_error_message());
        return;
    }

    $statusCode = (int)wp_remote_retrieve_response_code($response);
    $responseBody = wp_remote_retrieve_body($response);
    $decoded = json_decode($responseBody, true);
    if ($statusCode < 200 || $statusCode >= 300 || !is_array($decoded) || empty($decoded["ok"])) {
        update_comment_meta($comment->comment_ID, "_ai_webadmin_moderation_error", "worker_error_" . $statusCode);
        return;
    }

    $action = isset($decoded["action"]) ? (string)$decoded["action"] : "keep";
    $appliedStatus = ai_webadmin_apply_moderation_action($comment->comment_ID, $action);
    update_comment_meta($comment->comment_ID, "_ai_webadmin_moderation_action", $appliedStatus);
    update_comment_meta($comment->comment_ID, "_ai_webadmin_moderation_confidence", isset($decoded["confidence"]) ? (string)$decoded["confidence"] : "");
    update_comment_meta($comment->comment_ID, "_ai_webadmin_moderation_reason", isset($decoded["reason"]) ? (string)$decoded["reason"] : "");
}
add_action("ai_webadmin_moderate_comment_event", "ai_webadmin_handle_comment_moderation", 10, 1);
