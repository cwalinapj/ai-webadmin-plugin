# Toll Comments (DDNS)

Refundable, credit-based comment tolls to reduce spam.

## What it does
- Requires a refundable **credit hold** before comments are accepted.
- On approval: credits are refunded (optionally with a bonus).
- On spam/trash: credits are forfeited.
- Wallet is identified via **challenge + signature** (no private keys).
- Optional Node Mode caches verified `/resolve` responses and credits the Site Reward Pool.

## Requirements
- Credits coordinator running (default: `http://localhost:8054`).
- A site token configured in the coordinator and in WP settings.

## Install
1. Copy this folder to `wp-content/plugins/toll-comments`.
2. Activate in WordPress admin → Plugins.

## Configure
Settings → **DDNS Toll Comments**:
- **Enabled**: turn on tolls.
- **Coordinator URL**: `http://localhost:8054` (default).
- **Site ID**: unique identifier for this WP site.
- **Site token**: shared secret to call the coordinator.
- **Toll amount**: default `1` credit.
- **Bonus**: optional; default multiplier 2x.
- **Exempt roles/users**: skip tolls for trusted users.
- **High-rep wallets**: optional allowlist for free comments.
- **Node Mode**: opt-in cache + verify with resource caps.

## Comment flow
1. User connects wallet and signs a login challenge.
2. Plugin requests a **hold** from the coordinator.
3. On submission, a comment hash is submitted to the coordinator.
4. On moderation change:
   - **approved** → refund (bonus if enabled)
   - **spam/trash** → forfeit

## Mock coordinator mode
For local dev, define in `wp-config.php`:
```php
define('DDNS_TOLL_COMMENTS_MOCK_MODE', true);
```
This bypasses coordinator calls and issues mock tickets.

## REST endpoints (plugin)
- `POST /wp-json/ddns/v1/toll/challenge`
- `POST /wp-json/ddns/v1/toll/verify`
- `POST /wp-json/ddns/v1/toll/hold`

## Security notes
- Site token is stored server-side and never exposed to the browser.
- Wallet signatures are verified by the coordinator.

## Related projects
- **DECENTRALIZED-DNS** — the decentralized Cloudflare-like DNS platform this plugin integrates with: https://github.com/cwalinapj/DECENTRALIZED-DNS-
- **TollDNS** — the companion WordPress plugin in this repo (`plugins/tolldns`) for free-tier policy enforcement.
