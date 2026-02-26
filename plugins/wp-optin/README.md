# DDNS Opt-in

Opt-in and connect a WordPress site to the DDNS compat control plane.

## What it does
- Provides a settings page to connect this WordPress site to the DECENTRALIZED-DNS control plane.
- Allows the site to register and receive a site token for authenticated API calls.
- Configures the DoH resolver URL for `.free` domain and enhanced Web3 DNS routes.

## Install
1. Copy the `plugin/` folder to `wp-content/plugins/ddns-optin`.
2. Activate **DDNS Opt-in** in WordPress admin → Plugins.

## Configure
WordPress admin → **DDNS Opt-in**:
- **Control Plane URL**: URL of the DDNS control plane API (default: `http://localhost:8788`).
- **Site ID**: unique identifier for this WordPress site.
- **Resolver DoH URL**: URL for the DDNS DoH resolver (optional).
- Click **Register** to register the site and receive a site token.

## Related projects
- **DECENTRALIZED-DNS** — the decentralized Cloudflare-like DNS platform: https://github.com/cwalinapj/DECENTRALIZED-DNS-
- **TollDNS** — the companion plugin in this repo (`plugins/tolldns`) for free-tier policy enforcement.
