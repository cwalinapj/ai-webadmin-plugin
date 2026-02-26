ALTER TABLE host_optimizer_baselines ADD COLUMN memory_class TEXT NOT NULL DEFAULT '';
ALTER TABLE host_optimizer_baselines ADD COLUMN webserver_type TEXT NOT NULL DEFAULT '';
ALTER TABLE host_optimizer_baselines ADD COLUMN gpu_acceleration_mode TEXT NOT NULL DEFAULT '';
ALTER TABLE host_optimizer_baselines ADD COLUMN gpu_model TEXT NOT NULL DEFAULT '';
ALTER TABLE host_optimizer_baselines ADD COLUMN gpu_count TEXT NOT NULL DEFAULT '';
ALTER TABLE host_optimizer_baselines ADD COLUMN gpu_vram_gb TEXT NOT NULL DEFAULT '';
ALTER TABLE host_optimizer_baselines ADD COLUMN memory_pressure_score REAL;
