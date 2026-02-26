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

For canonical schema definitions, reference `Sitebuilder1.0/api-contracts.md`.
