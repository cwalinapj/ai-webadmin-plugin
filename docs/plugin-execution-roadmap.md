# AI WebAdmin Plugin-Only Execution Roadmap

## Product boundary
- WordPress plugins act as secure **agents**.
- Heavy orchestration runs in backend control plane/worker APIs.
- Plugins collect signals, request jobs, and display state.

## Phase 1 (MVP)
1. **Preflight + sandbox launch**
2. **Snapshot before change**
3. **Controlled update execution**
4. **Post-update smoke tests**
5. **Rollback trigger path**
6. **Watchdog heartbeat + incident feed**

## Phase 2
1. Malware/integrity deep checks.
2. Automated patch windows and maintenance calendar.
3. Change approval workflows (owner/admin acknowledgement).

## Phase 3
1. Multi-node replication and HA failover workflows.
2. Policy packs by business type.

## Non-goals (for now)
- Auto-delete users.
- Auto-demote administrators.
- Unbounded self-modifying behavior.

## Core contracts needed
- `POST /plugin/wp/sandbox/preflight`
- `POST /plugin/wp/sandbox/launch`
- `POST /plugin/wp/backup/snapshot`
- `POST /plugin/wp/upgrade/plan`
- `POST /plugin/wp/upgrade/execute`
- `POST /plugin/wp/upgrade/verify`
- `POST /plugin/wp/rollback/execute`
- `POST /plugin/wp/watchdog/heartbeat`
- `POST /plugin/wp/security/integrity/report`
