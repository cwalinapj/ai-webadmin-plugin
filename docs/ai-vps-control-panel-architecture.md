# AI VPS Control Panel Architecture

## Goal
Build a VPS-native control panel where operators manage infrastructure through a chat-agent, while guardrails enforce safe execution.

## Core components
1. Chat-agent API
- Receives operator prompts.
- Produces structured actions with risk labels and confirmation requirements.

2. Policy + guardrails
- Every action has `risk`, `dry_run`, and `requires_confirmation`.
- Command execution is allowlist-based.
- High-risk actions require explicit confirmation.

3. Execution engine
- Converts approved actions into host commands.
- Captures command output and exit status for audit.

4. Site registry
- Tracks managed sites, runtime type, and panel metadata.
- Supports mixed stacks (WordPress, PHP, Node, static).

5. Worker integration
- Panel agent reports telemetry to `/plugin/site/*`.
- Reuses shared signing/replay/capability contract from panel-addon-core.

## Phase breakdown
### Phase 1 (implemented)
- Backend scaffold in `apps/ai-vps-control-panel`.
- Chat planner and safe command executor.
- API routes for sites, chat planning, and action execution.
- API-key auth with tenant-scoped RBAC (`viewer`/`operator`/`admin`).
- Persistent API key + PAT store (SQLite) with hash-at-rest secrets, revoke/rotate flows, auto-rotation hooks, and token audit events.
- Worker sync hook that publishes signed telemetry/jobs through `panel-addon-core`.
- SQLite persistence for:
  - sites
  - conversations/messages
  - queued actions
  - audit logs
- First web UI shell:
  - site inventory form/list
  - chat console
  - approve/execute queue view
  - audit feed

### Phase 2
- Add stronger auth (session/JWT + key rotation service) on top of API keys.
- Add persistent storage (Postgres or D1 equivalent).
- Add immutable audit logs for every action and command output.

### Phase 3
- Add frontend dashboard:
  - site inventory
  - live chat console
  - action queue with approve/reject
  - real-time metrics/log widgets

### Phase 4
- Agent memory and runbooks per site type.
- Policy engine for maintenance windows and SLO-based autopilot.
- Automated rollback workflows for failed remediations.

## Safety model
- Default all commands to `dry_run=true`.
- Require confirmation for high-risk operations.
- Restrict command generation to validated templates (no free-form shell).
- Keep capability tokens and shared secrets outside source control.
