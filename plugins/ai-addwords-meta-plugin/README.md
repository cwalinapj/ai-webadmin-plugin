# AI AddWords + Meta Paid Traffic Plugin

WordPress plugin that coordinates multi-tool AI ad production and split testing, then applies CPA-based scaling logic with optional Web3 settlement instructions.

## Plugin family links
- [AI_WP_Plugin_Family](../ai-webadmin/README.md) - AI WebAdmin
- [AI_WP_Plugin_Family](../tolldns/README.md) - TollDNS
- [AI_WP_Plugin_Family](../ai-wp-host-optimizer/README.md) - AI WP Host Optimizer Plugin
- [AI_WP_Plugin_Family](../../apps/webadmin-edge-agent/readme.txt) - WebAdmin Edge Agent
- [AI_WP_Plugin_Family](../../README.md#ai_wp_plugin_family) - Family index

## What it does
- Pulls ad-performance metrics from AdWords manager and Meta ads manager endpoints.
- Scores campaigns against business owner target CPA.
- Decides campaign actions:
  - `scale` when CPA beats target by configured margin.
  - `keep` when CPA is within target band.
  - `pause` when CPA exceeds target by configured margin.
- Triggers creative refresh workflows via:
  - Creatify.ai (video generation)
  - Typecast.ai (voice/narration)
  - AdCreative.ai (copy/creative variants)
  - Landbot.io (AI assistant funnel updates)
  - Adamigo.ai (Meta strategy rebalancing)
- Builds settlement payload for Web3 executor:
  - Traffic financing in USD.
  - Owner payable amount from fixed CPA.
  - Profit delta and SPL burn notional percentage.

## Safety defaults
- `Dry run` is enabled by default.
- No live budget changes or Web3 webhook dispatch happen until dry run is disabled.
- Scale actions are auto-throttled by `max_daily_spend_usd` guardrail.
- Missing provider credentials automatically fallback to simulation metrics so admin can validate logic flow.

## Install
1. Copy folder to `wp-content/plugins/ai-addwords-meta-plugin`
2. Activate `AI AddWords + Meta Paid Traffic Plugin`
3. Open `Settings -> AI AddWords + Meta`
4. Configure API endpoints, keys, target CPA, and (optionally) Web3 settlement webhook.
5. Start in dry-run mode, review logs/reports, then disable dry-run for live operation.

## Endpoints expected
- Ad managers:
  - `POST /campaigns/metrics`
  - `POST /campaigns/update`
- Creative providers:
  - `POST /creative/video/generate`
  - `POST /voiceover/generate`
  - `POST /copy/variants`
  - `POST /funnels/assistant/update`
  - `POST /meta/strategy/rebalance`
- Settlement webhook:
  - Receives signed JSON with `traffic_finance_usd`, `owner_payable_usd`, `profit_usd`, and `spl_burn_notional_usd`.

## Notes
- The plugin ships with connector scaffolding and decision logic. API contracts can be adapted per provider account/workflow.
- Real token burning and trade execution should be handled by a dedicated settlement service that enforces treasury controls and chain-level security policies.
