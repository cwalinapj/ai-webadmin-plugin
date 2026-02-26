export interface CreateHostOptimizerBaselineInput {
  pluginId: string;
  siteUrl: string;
  providerName: string;
  regionLabel: string;
  virtualizationOs: string;
  cpuModel: string;
  cpuYear: string;
  ramGb: string;
  memoryClass: string;
  webserverType: string;
  storageType: string;
  uplinkMbps: string;
  gpuAccelerationMode: string;
  gpuModel: string;
  gpuCount: string;
  gpuVramGb: string;
  reason: string;
  capturedAt: string;
  homeTtfbMs: number | null;
  restTtfbMs: number | null;
  cpuOpsPerSec: number | null;
  diskWriteMbPerSec: number | null;
  diskReadMbPerSec: number | null;
  memoryPressureScore: number | null;
  payloadJson: string;
}

export interface HostOptimizerBaselineRecord {
  id: string;
  plugin_id: string;
  site_url: string;
  provider_name: string;
  region_label: string;
  virtualization_os: string;
  cpu_model: string;
  cpu_year: string;
  ram_gb: string;
  memory_class: string;
  webserver_type: string;
  storage_type: string;
  uplink_mbps: string;
  gpu_acceleration_mode: string;
  gpu_model: string;
  gpu_count: string;
  gpu_vram_gb: string;
  reason: string;
  captured_at: string;
  ingested_at: string;
  home_ttfb_ms: number | null;
  rest_ttfb_ms: number | null;
  cpu_ops_per_sec: number | null;
  disk_write_mb_per_sec: number | null;
  disk_read_mb_per_sec: number | null;
  memory_pressure_score: number | null;
  payload_json: string;
}

export async function createHostOptimizerBaseline(
  db: D1Database,
  input: CreateHostOptimizerBaselineInput,
): Promise<HostOptimizerBaselineRecord> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO host_optimizer_baselines (
         id, plugin_id, site_url, provider_name, region_label, virtualization_os,
         cpu_model, cpu_year, ram_gb, memory_class, webserver_type, storage_type,
         uplink_mbps, gpu_acceleration_mode, gpu_model, gpu_count, gpu_vram_gb,
         reason, captured_at, ingested_at, home_ttfb_ms, rest_ttfb_ms, cpu_ops_per_sec,
         disk_write_mb_per_sec, disk_read_mb_per_sec, memory_pressure_score, payload_json
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6,
         ?7, ?8, ?9, ?10, ?11, ?12,
         ?13, ?14, ?15, ?16, ?17,
         ?18, ?19, ?20, ?21, ?22, ?23,
         ?24, ?25, ?26
       )`,
    )
    .bind(
      id,
      input.pluginId,
      input.siteUrl,
      input.providerName,
      input.regionLabel,
      input.virtualizationOs,
      input.cpuModel,
      input.cpuYear,
      input.ramGb,
      input.memoryClass,
      input.webserverType,
      input.storageType,
      input.uplinkMbps,
      input.gpuAccelerationMode,
      input.gpuModel,
      input.gpuCount,
      input.gpuVramGb,
      input.reason,
      input.capturedAt,
      now,
      input.homeTtfbMs,
      input.restTtfbMs,
      input.cpuOpsPerSec,
      input.diskWriteMbPerSec,
      input.diskReadMbPerSec,
      input.memoryPressureScore,
      input.payloadJson,
    )
    .run();

  return {
    id,
    plugin_id: input.pluginId,
    site_url: input.siteUrl,
    provider_name: input.providerName,
    region_label: input.regionLabel,
    virtualization_os: input.virtualizationOs,
    cpu_model: input.cpuModel,
    cpu_year: input.cpuYear,
    ram_gb: input.ramGb,
    memory_class: input.memoryClass,
    webserver_type: input.webserverType,
    storage_type: input.storageType,
    uplink_mbps: input.uplinkMbps,
    gpu_acceleration_mode: input.gpuAccelerationMode,
    gpu_model: input.gpuModel,
    gpu_count: input.gpuCount,
    gpu_vram_gb: input.gpuVramGb,
    reason: input.reason,
    captured_at: input.capturedAt,
    ingested_at: now,
    home_ttfb_ms: input.homeTtfbMs,
    rest_ttfb_ms: input.restTtfbMs,
    cpu_ops_per_sec: input.cpuOpsPerSec,
    disk_write_mb_per_sec: input.diskWriteMbPerSec,
    disk_read_mb_per_sec: input.diskReadMbPerSec,
    memory_pressure_score: input.memoryPressureScore,
    payload_json: input.payloadJson,
  };
}
