# AI WP Host Optimizer Plugin

WordPress plugin for collecting host-performance baselines per hardware/location profile and exporting signed samples to a control plane.

## Plugin family links
- [AI_WP_Plugin_Family](../ai-webadmin/README.md) - AI WebAdmin
- [AI_WP_Plugin_Family](../tolldns/README.md) - TollDNS
- [AI_WP_Plugin_Family](../../apps/webadmin-edge-agent/readme.txt) - WebAdmin Edge Agent
- [AI_WP_Plugin_Family](../../README.md#ai_wp_plugin_family) - Family index

## What it does
- Captures repeatable baseline metrics on a schedule (5/15/30/60 minutes).
- Records page-speed probes (`/` and `/wp-json/`) and local CPU/disk microbenchmarks.
- Stores hardware and network tags (NVMe/SSD/HDD, uplink Mbps, CPU year/model, virtualization mode).
- Tracks memory profile and web stack tags (`ECC_DDR3`..`ECC_DDR7`, webserver type, memory pressure).
- Captures GPU accelerator metadata (mode/model/count/VRAM + effect note for large dedicated servers).
- Runs TCP connect probes to configurable targets for latency trend comparisons.
- Exports samples with signed headers to Worker endpoint:
  - `POST /plugin/wp/host-optimizer/baseline`
- Optionally pushes full baseline artifacts to Storage Anchor API:
  - `POST /anchor/store`

## Suggested use for VPS pooling
- Deploy on test nodes across regions (Los Angeles, San Francisco, Seattle, Dallas, New York, etc.).
- Tag each install with provider, region, virtualization stack (`proxmox`, `esxi`, `bare_metal`).
- Keep hardware metadata consistent so pooled comparisons stay clean.
- Use sample history to generate default plan recommendations for new clients.

## Install
1. Copy folder to `wp-content/plugins/ai-wp-host-optimizer`
2. Activate `AI WP Host Optimizer Plugin`
3. Open `Settings -> AI WP Host Optimizer`
4. Save provider/region/hardware fields and run `Run Baseline Now`

## Required worker settings
- Worker env `WP_PLUGIN_SHARED_SECRET`
- Worker env `CAP_TOKEN_HOST_OPTIMIZER_WRITE`
- Plugin settings `Plugin Shared Secret` and `Host Optimizer Capability Token` must match those worker values.

## Optional anchor storage settings
- Enable `Anchor Storage` in plugin settings.
- Set `Anchor API Base URL` and `Anchor API Token`.
- Configure `Anchor Retention Class` (`hot`/`balanced`/`cold`) and `Anchor Priority` (`standard`/`high`).
- Enable `Force IPFS Backup` to request IPFS backup for each artifact when quota/config permits.

## Notes
- This plugin measures WordPress/app-level and host-adjacent signals; it does not directly tune Proxmox/ESXi.
- Accurate cross-location user latency still benefits from external probes hitting this site from each region.
