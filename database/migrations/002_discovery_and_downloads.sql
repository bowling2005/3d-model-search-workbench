ALTER TABLE sources ADD COLUMN upstream_source_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sources_upstream_id
  ON sources(upstream_source_id);

ALTER TABLE assets ADD COLUMN thumbnail_url TEXT;
ALTER TABLE assets ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE assets ADD COLUMN license_name TEXT;
ALTER TABLE assets ADD COLUMN license_url TEXT;
ALTER TABLE assets ADD COLUMN license_commercial INTEGER;
ALTER TABLE assets ADD COLUMN license_attribution INTEGER;
ALTER TABLE assets ADD COLUMN downloadable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN last_seen_at TEXT;

CREATE VIRTUAL TABLE IF NOT EXISTS asset_search USING fts5(
  asset_id UNINDEXED,
  title,
  author,
  tags,
  categories,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS asset_files (
  file_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  file_kind TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(asset_id)
);

CREATE INDEX IF NOT EXISTS idx_asset_files_asset
  ON asset_files(asset_id);

ALTER TABLE download_jobs ADD COLUMN asset_id TEXT;
ALTER TABLE download_jobs ADD COLUMN download_dir TEXT;
ALTER TABLE download_jobs ADD COLUMN completed_at TEXT;
