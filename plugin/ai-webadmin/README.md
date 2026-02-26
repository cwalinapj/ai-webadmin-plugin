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

7. Automatic comment action mapping:
- `keep` -> approved
- `hold` -> pending moderation
- `spam` -> spam
- `trash` -> trash

8. TollDNS enforcement (free-tier guardrail):
- If `Require TollDNS` is enabled and TollDNS is not active, moderation features are disabled.

9. GitHub signup helper link in settings:
- Promotes sandbox backup workflow before plugin/theme updates.

10. Security hardening controls (plugin-enforced):
- Disable XML-RPC at application level and endpoint block.
- Brute-force login throttling (attempt/window/lockout controls).
- Block known high-risk file-manager plugins (`WP File Manager` family).
- Enforce one Administrator role (additional admins are demoted to Editor).
- Prevent email addresses from being used as display names.
- Optional Administrator SSO enforcement via header (non-admin username/password still allowed).
- Optional Apache/LiteSpeed `.htaccess` hardening snippet management.

11. Plugin rationalization and cleanup:
- Audits plugin inventory for inactive/unneeded installs.
- Automatically removes migration/replication plugins (when enabled).
- Deletes inactive user accounts with no login over configured threshold (default 365 days).
- Removes common SMTP/email plugins (when enabled) and routes lead-email events via Worker.

12. Worker-managed backup and token gateway:
- Daily site snapshot manifest can be sent to Worker + R2.
- WordPress submits GitHub classic token to Worker vault; WP stores only masked token status.
- Worker can push snapshot manifests into `owner/repo` backup path.

13. Optional unlock controls on wp-login:
- Passcode unlock.
- Hardware key/passkey unlock integration.
- Web3 wallet signature unlock (Worker-verified).

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

3. `Onboarding Session ID` (recommended)
- Allows plugin telemetry (email queue / outdated plugins / pending comment moderation count) to appear in chat audit output.

4. `Enable comment moderation via Worker`
- Enable to process new comments asynchronously via WP-Cron.

5. `Require TollDNS`
- Keep enabled for free-tier policy enforcement.

6. Security hardening (recommended defaults):
- `Enable hardening controls`
- `Disable XML-RPC`
- `Prevent email addresses as display names`
- `Keep only one Administrator role`
- `Block risky file-manager plugins`
- `Limit brute-force login attempts`
- Optional: `Require SSO header for Administrator logins`
- Optional: `Apply Apache/LiteSpeed .htaccess hardening rules`

7. GitHub backup gateway:
- Set `GitHub Repo` as `owner/repo`
- Set `GitHub Branch` (default `main`)
- Paste `GitHub classic token` in settings save form (forwarded to Worker vault; not persisted in WP options)

8. Cleanup controls:
- `Audit plugin inventory and flag unneeded/lazy installs`
- `Remove migration/DB replication plugins automatically`
- `Delete users with no login for over N days`
- `Remove SMTP/email plugins automatically`

9. Email forwarding controls:
- `Forward lead-form emails through Cloudflare Worker`
- `Lead forward destination email` (optional; defaults to primary admin email)
- `Suppress local lead-email delivery after Worker accepts event`
- Worker also stores MX/provider hints for forwarding profile personalization.

10. Unlock options:
- `Require passcode unlock on login`
- `Require hardware key/passkey verification` (requires WebAuthn integration plugin + filter)
- `Require Web3 wallet signature unlock`

## Worker requirements

Set in Worker environment:

1. `WP_PLUGIN_SHARED_SECRET`
2. Optional: `OPENAI_API_KEY` for higher quality moderation decisions.
3. Recommended: `GITHUB_VAULT_KEY` (secret used to encrypt GitHub tokens in Worker vault state).
4. Optional for wallet unlock: `WALLET_VERIFY_WEBHOOK`
- Worker forwards wallet challenge payload to this verifier and expects `{ ok: true, verified: true, wallet_address: "0x..." }`.
5. Optional for wallet unlock webhook signing: `WALLET_VERIFY_WEBHOOK_SECRET`
6. Optional for lead forwarding handoff: `LEAD_FORWARD_WEBHOOK_URL`
- Worker POSTs normalized lead events here after receiving signed plugin forwarding payloads.
7. Optional for lead forwarding webhook signing: `LEAD_FORWARD_WEBHOOK_SECRET`

## Security notes

1. Plugin sends `X-Plugin-Timestamp` and HMAC `X-Plugin-Signature`.
2. Worker rejects stale requests (older/newer than 5 minutes).
3. Worker rejects invalid signatures and unsigned requests.
4. Hardening logic is additive:
- Keep WordPress core/themes/plugins updated.
- Keep plugin count minimal and remove unused plugins.
- Do not install server-level file managers in WP.
- Use Cloudflare Access/SSO for admin identity when possible.
- Keep 2FA enabled for privileged users.
5. `.htaccess` rules only apply on Apache/LiteSpeed and only when `.htaccess` exists and is writable.
6. In multisite, single-admin enforcement is intentionally conservative to avoid breaking network-super-admin workflows.
7. Hardware-key unlock is exposed via integration hook `ai_webadmin_hardware_key_verified`; WP/WebAuthn plugin adapters should return `true` when passkey assertion is complete.

## Best-practice references

- WordPress Hardening: https://developer.wordpress.org/advanced-administration/security/hardening/
- WordPress XML-RPC docs: https://wordpress.org/documentation/article/xml-rpc-support/
- Cloudflare Access (SSO for apps): https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-apps/
- Cloudflare WAF guidance: https://developers.cloudflare.com/waf/
