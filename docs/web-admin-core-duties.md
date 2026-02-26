# Core Duties: Small-Business Web Admin (Top 10)

These are the highest-value tasks a human web admin typically performs for small business sites.

1. **Safe updates**
   - Stage WordPress/core/plugin/theme updates in a sandbox first.
   - Run smoke tests before production rollout.

2. **Backups and restore readiness**
   - Daily snapshots + retention policy.
   - Validate restore workflows regularly.

3. **Uptime and performance monitoring**
   - Track uptime, latency, and error rates.
   - Alert and triage incidents quickly.

4. **Security hardening and patching**
   - Enforce least privilege, block risky plugins, rotate secrets.
   - Keep attack surface minimal.

5. **Spam and abuse control**
   - Moderate comments/forms and tune anti-spam controls.
   - Quarantine suspicious events.

6. **Malware/integrity checks**
   - Detect file integrity drift and malicious changes.
   - Trigger containment or rollback.

7. **DNS/SSL hygiene**
   - Ensure DNS, TLS certificates, redirects, and edge policies stay healthy.
   - Prevent expiry-induced outages.

8. **SEO/technical health maintenance**
   - Validate schema, broken links, crawlability, and index health.
   - Fix regressions after site changes.

9. **Email deliverability operations**
   - Maintain forwarding/auth records and monitor failures.
   - Keep customer leads from being dropped.

10. **Change/audit discipline**
   - Log who changed what and when.
   - Maintain rollback notes and incident timelines.

---

## Mapping to AI WebAdmin plugin productization

For your plugin ecosystem, the first automation wave should focus on:
- sandboxed upgrade pipeline
- snapshot + restore automation
- watchdog + incident telemetry
- anti-spam + malware signal forwarding
- baseline security checks
