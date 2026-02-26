# AI WebAdmin WordPress Plugin

This plugin connects WordPress comments to your Cloudflare Worker endpoint for AI moderation.

## Features included

1. Signed moderation requests to Worker endpoint:
- `POST /plugin/wp/comments/moderate`
2. Signed audit-metrics sync requests to Worker endpoint:
- `POST /plugin/wp/audit/sync`
3. Signed GitHub vault connection requests:
- `POST /plugin/wp/github/vault`
4. Signed snapshot backup push requests:
- `POST /plugin/wp/backup/snapshot`
5. Signed email-forwarding config sync:
- `POST /plugin/wp/email/forward/config`
6. Signed lead-email forwarding events:
- `POST /plugin/wp/lead/forward`
7. Signed hosting/control-panel access profile sync:
- `POST /plugin/wp/access/profile` (usernames/public SSH keys/scoped tokens only; plaintext passwords rejected)

8. Automatic comment action mapping:
- `keep` -> approved
- `hold` -> pending moderation
- `spam` -> spam
- `trash` -> trash

9. TollDNS enforcement (free-tier guardrail):
- If `Require TollDNS` is enabled and TollDNS is not active, moderation features are disabled.

10. GitHub signup helper link in settings:
- Promotes sandbox backup workflow before plugin/theme updates.

11. Security hardening controls (plugin-enforced):
- Disable XML-RPC at application level and endpoint block.
- Brute-force login throttling (attempt/window/lockout controls).
- Block known high-risk file-manager plugins (`WP File Manager` family).
- Enforce one Administrator role (additional admins are demoted to Editor).
- Prevent email addresses from being used as display names.
- Optional Administrator SSO enforcement via header (non-admin username/password still allowed).
- Optional Apache/LiteSpeed `.htaccess` hardening snippet management.

12. Plugin rationalization and cleanup:
- Audits plugin inventory for inactive/unneeded installs.
- Automatically removes migration/replication plugins (when enabled).
- Deletes inactive user accounts with no login over configured threshold (default 365 days).
- Removes common SMTP/email plugins (when enabled) and routes lead-email events via Worker.

13. Worker-managed backup and token gateway:
- Daily site snapshot manifest can be sent to Worker + R2.
- WordPress submits GitHub classic token to Worker vault; WP stores only masked token status.
- Worker can push snapshot manifests into `owner/repo` backup path.

14. Optional unlock controls on wp-login:
- Passcode unlock.
- Hardware key/passkey unlock integration.
- Ethereum or Solana wallet signature unlock (Worker-verified).

15. Sandbox conflict pool UI for agent coordination:
- Report conflict blockers to Worker:
  - `POST /plugin/wp/sandbox/conflicts/report`
- Read shared conflict feed:
  - `POST /plugin/wp/sandbox/conflicts/list`
- Resolve or dismiss conflicts:
  - `POST /plugin/wp/sandbox/conflicts/resolve`

## Install (manual)

1. Copy this folder to:
- `wp-content/plugins/ai-webadmin`

2. Activate plugin:
- `AI WebAdmin (Cloudflare Worker)`

3. Configure in:
- `Settings -> AI WebAdmin`

## Required settings

1. `Worker Base URL`
- Example: `https://api.cardetailingreno.com`

2. `Plugin Shared Secret`
- Must match Worker env var `WP_PLUGIN_SHARED_SECRET`.

3. `Plugin Instance ID` (recommended)
- Used as `X-Plugin-Id` for signed sandbox scheduler/conflict requests.
- If blank, plugin falls back to onboarding session ID, then site host.

4. `Sandbox Capability Token`
- Must match Worker env var `CAP_TOKEN_SANDBOX_WRITE`.
- Required for sandbox scheduler/conflict endpoints.

5. `Onboarding Session ID` (recommended)
- Allows plugin telemetry (email queue / outdated plugins / pending comment moderation count) to appear in chat audit output.

6. `Enable comment moderation via Worker`
- Enable to process new comments asynchronously via WP-Cron.

7. `Require TollDNS`
- Keep enabled for free-tier policy enforcement.

8. Security hardening (recommended defaults):
- `Enable hardening controls`
- `Disable XML-RPC`
- `Prevent email addresses as display names`
- `Keep only one Administrator role`
- `Block risky file-manager plugins`
- `Limit brute-force login attempts`
- Optional: `Require SSO header for Administrator logins`
- Optional: `Apply Apache/LiteSpeed .htaccess hardening rules`

9. GitHub backup gateway:
- Set `GitHub Repo` as `owner/repo`
- Set `GitHub Branch` (default `main`)
- Paste `GitHub classic token` in settings save form (forwarded to Worker vault; not persisted in WP options)

10. Cleanup controls:
- `Audit plugin inventory and flag unneeded/lazy installs`
- `Remove migration/DB replication plugins automatically`
- `Delete users with no login for over N days`
- `Remove SMTP/email plugins automatically`

11. Email forwarding controls:
- `Forward lead-form emails through Cloudflare Worker`
- `Lead forward destination email` (optional; defaults to primary admin email)
- `Suppress local lead-email delivery after Worker accepts event`
- Worker also stores MX/provider hints for forwarding profile personalization.

12. Unlock options:
- `Require passcode unlock on login`
- `Require hardware key/passkey verification` (requires WebAuthn integration plugin + filter)
- `Require wallet signature unlock` (choose Ethereum or Solana)

## Worker requirements

Set in Worker environment:

1. `WP_PLUGIN_SHARED_SECRET`
2. `CAP_TOKEN_SANDBOX_WRITE` (required for sandbox scheduler/conflict endpoints)
3. Optional: `OPENAI_API_KEY` for higher quality moderation decisions.
4. Recommended: `GITHUB_VAULT_KEY` (secret used to encrypt GitHub tokens in Worker vault state).
5. Optional for wallet unlock: `WALLET_VERIFY_WEBHOOK`
- Worker forwards wallet challenge payload to this verifier and expects `{ ok: true, verified: true, wallet_address: "0x..." }`.
6. Optional for wallet unlock webhook signing: `WALLET_VERIFY_WEBHOOK_SECRET`
7. Optional for lead forwarding handoff: `LEAD_FORWARD_WEBHOOK_URL`
- Worker POSTs normalized lead events here after receiving signed plugin forwarding payloads.
8. Optional for lead forwarding webhook signing: `LEAD_FORWARD_WEBHOOK_SECRET`

## Security notes

1. Plugin sends `X-Plugin-Timestamp` and HMAC `X-Plugin-Signature`.
2. Worker rejects stale requests (older/newer than 5 minutes).
3. Worker rejects invalid signatures and unsigned requests.
4. Sandbox scheduler/conflict endpoints use stricter signed mutation headers:
- `X-Plugin-Id`
- `X-Plugin-Timestamp`
- `X-Plugin-Nonce`
- `X-Plugin-Signature`
- `X-Capability-Token`
- `Idempotency-Key`
5. Hardening logic is additive:
- Keep WordPress core/themes/plugins updated.
- Keep plugin count minimal and remove unused plugins.
- Do not install server-level file managers in WP.
- Use Cloudflare Access/SSO for admin identity when possible.
- Keep 2FA enabled for privileged users.
6. `.htaccess` rules only apply on Apache/LiteSpeed and only when `.htaccess` exists and is writable.
7. In multisite, single-admin enforcement is intentionally conservative to avoid breaking network-super-admin workflows.
8. Hardware-key unlock is exposed via integration hook `ai_webadmin_hardware_key_verified`; WP/WebAuthn plugin adapters should return `true` when passkey assertion is complete.

## Best-practice references

- WordPress Hardening: https://developer.wordpress.org/advanced-administration/security/hardening/
- WordPress XML-RPC docs: https://wordpress.org/documentation/article/xml-rpc-support/
- Cloudflare Access (SSO for apps): https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-apps/
- Cloudflare WAF guidance: https://developers.cloudflare.com/waf/
