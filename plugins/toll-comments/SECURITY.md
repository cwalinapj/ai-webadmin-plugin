# Security Checklist

- Nonces: REST endpoints are public; coordinator handles auth via site token.
- Capability checks: settings page requires `manage_options`.
- Input sanitization: wallet, post IDs, and comment hashes are sanitized.
- Secrets: site token is stored in WP options and never sent to the browser.
- Output escaping: admin settings fields are escaped.
- No SQL in plugin (avoids injection risk).

If you find a security issue, report it to the core maintainers.
