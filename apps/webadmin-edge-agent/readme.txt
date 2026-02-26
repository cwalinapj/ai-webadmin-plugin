=== WebAdmin Edge Agent ===
Contributors: sitebuilder
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Connects WordPress to a Cloudflare Workers control plane using signed requests.

== Description ==

WebAdmin Edge Agent provides five admin tabs:

1. Uptime & Performance
2. Security
3. Analytics & Reporting
4. Domain, DNS & Email Administration
5. Form, Lead & Integration Management

Milestone 1 includes signed heartbeat transport, replay protection headers, and an event log viewer.

== Installation ==

1. Upload the `webadmin-edge-agent` directory to `/wp-content/plugins/`.
2. Activate the plugin.
3. Open `WebAdmin Edge Agent` in the WordPress admin menu.
4. Configure connection settings and send a heartbeat.

== Changelog ==

= 0.1.0 =
* Initial production slice with signed heartbeat and five-tab admin shell.
