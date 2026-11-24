CREATE TABLE IF NOT EXISTS asset_inspections (
  inspection_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  blender_version TEXT,
  report_json TEXT NOT NULL DEFAULT '{}',
  processed_dir TEXT,
  output_model_path TEXT,
  log_excerpt TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(asset_id)
);

CREATE INDEX IF NOT EXISTS idx_asset_inspections_asset
  ON asset_inspections(asset_id, created_at);

CREATE TABLE IF NOT EXISTS unity_import_jobs (
  request_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  project_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  request_json TEXT NOT NULL,
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(asset_id)
);

CREATE INDEX IF NOT EXISTS idx_unity_import_jobs_asset
  ON unity_import_jobs(asset_id, created_at);
