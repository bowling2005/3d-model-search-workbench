CREATE TABLE IF NOT EXISTS sources (
  source_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  homepage TEXT NOT NULL,
  domains_json TEXT NOT NULL,
  aliases_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  user_metadata_json TEXT,
  seed_entries_json TEXT NOT NULL,
  upstream_access TEXT,
  connector_status TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  notes_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sources_status
  ON sources(connector_status);

CREATE INDEX IF NOT EXISTS idx_sources_enabled
  ON sources(enabled);

CREATE VIRTUAL TABLE IF NOT EXISTS source_search USING fts5(
  source_id UNINDEXED,
  display_name,
  domains,
  aliases,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS assets (
  asset_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_asset_id TEXT,
  title TEXT NOT NULL,
  author TEXT,
  source_url TEXT NOT NULL,
  thumbnail_path TEXT,
  asset_type TEXT NOT NULL DEFAULT 'model',
  formats_json TEXT NOT NULL DEFAULT '[]',
  style_tags_json TEXT NOT NULL DEFAULT '[]',
  verified_triangle_count INTEGER,
  triangle_bucket TEXT,
  duplicate_group_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_id) REFERENCES sources(source_id)
);

CREATE INDEX IF NOT EXISTS idx_assets_source
  ON assets(source_id);

CREATE TABLE IF NOT EXISTS license_evidence (
  evidence_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  license_id TEXT,
  license_url TEXT,
  snapshot_path TEXT,
  terms_hash TEXT,
  commercial_allowed INTEGER,
  attribution_required INTEGER,
  captured_at TEXT NOT NULL,
  FOREIGN KEY (asset_id) REFERENCES assets(asset_id)
);

CREATE TABLE IF NOT EXISTS access_profiles (
  profile_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  auth_mode TEXT NOT NULL,
  username_hint TEXT,
  credential_ref TEXT,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'unconfigured',
  last_verified_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_id) REFERENCES sources(source_id)
);

CREATE TABLE IF NOT EXISTS pending_actions (
  action_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  profile_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_id) REFERENCES sources(source_id)
);

CREATE TABLE IF NOT EXISTS download_jobs (
  job_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_asset_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0,
  staging_path TEXT,
  error_code TEXT,
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_id) REFERENCES sources(source_id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS source_probe_reports (
  probe_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL,
  report_json TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES sources(source_id)
);

CREATE TABLE IF NOT EXISTS source_query_state (
  query_key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  access_profile_id TEXT,
  status TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  stale_until INTEGER,
  result_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  retry_at INTEGER,
  PRIMARY KEY (query_key, source_id, access_profile_id)
);
