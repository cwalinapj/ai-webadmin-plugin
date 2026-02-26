# AI WebAdmin Plugin Contract Notes

The plugin expects the following backend paths to remain stable:
- `/plugin/connect/start`
- `/plugin/connect/verify`
- `/plugin/wp/comments/moderate`
- `/plugin/wp/audit/sync`
- `/plugin/wp/access/profile`
- `/plugin/wp/schema/profile`
- `/plugin/wp/redirects/profile`
- `/plugin/wp/backup/snapshot`
- `/plugin/wp/github/vault`
- `/plugin/wp/watchdog/heartbeat`
- `/plugin/wp/auth/wallet/verify`
- `/plugin/wp/sandbox/request`
- `/plugin/wp/sandbox/vote`
- `/plugin/wp/sandbox/claim`
- `/plugin/wp/sandbox/release`
- `/plugin/wp/sandbox/conflicts/report`
- `/plugin/wp/sandbox/conflicts/list`
- `/plugin/wp/sandbox/conflicts/resolve`
- `/plugin/wp/host-optimizer/baseline`

VPS control-panel addons should use the same contracts with the `site` alias:
- `/plugin/site/watchdog/heartbeat`
- `/plugin/site/auth/wallet/verify`
- `/plugin/site/host-optimizer/baseline`
- `/plugin/site/sandbox/request`
- `/plugin/site/sandbox/vote`
- `/plugin/site/sandbox/claim`
- `/plugin/site/sandbox/release`
- `/plugin/site/sandbox/conflicts/report`
- `/plugin/site/sandbox/conflicts/list`
- `/plugin/site/sandbox/conflicts/resolve`

Both `wp` and `site` routes are accepted by the worker so WordPress agents and non-WordPress panel addons share one control plane.

For canonical schema definitions, reference `Sitebuilder1.0/api-contracts.md`.
