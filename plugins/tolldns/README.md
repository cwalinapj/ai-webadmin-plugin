# TollDNS

## Plugin family links
- [AI_WP_Plugin_Family](../ai-webadmin/README.md) - AI WebAdmin
- [AI_WP_Plugin_Family](../../apps/webadmin-edge-agent/readme.txt) - WebAdmin Edge Agent
- [AI_WP_Plugin_Family](../ai-wp-host-optimizer/README.md) - AI WP Host Optimizer Plugin
- [AI_WP_Plugin_Family](../../README.md#ai_wp_plugin_family) - Family index

## What it does
- Provides a functional `tolldns/tolldns.php` plugin slug for AI WebAdmin free-tier enforcement.
- Exposes status via `GET /wp-json/tolldns/v1/status`.
- Adds a basic settings screen under `Settings -> TollDNS`.

## Install
1. Copy this folder to `wp-content/plugins/tolldns`
2. Activate `TollDNS`

## Notes
- AI WebAdmin checks plugin activation state, so this plugin intentionally stays lightweight.
- This plugin does not manage DNS records directly in this MVP.
