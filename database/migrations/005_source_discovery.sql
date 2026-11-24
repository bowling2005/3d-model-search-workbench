CREATE TABLE IF NOT EXISTS source_candidates (
  candidate_id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  homepage TEXT NOT NULL,
  display_name TEXT NOT NULL,
  discovered_from TEXT NOT NULL,
  discovery_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',
  score REAL NOT NULL DEFAULT 0,
  probe_json TEXT NOT NULL DEFAULT '{}',
  license_summary TEXT,
  formats_json TEXT NOT NULL DEFAULT '[]',
  access_mode TEXT,
  last_probe_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_source_candidates_status
  ON source_candidates(status, score DESC);

CREATE TABLE IF NOT EXISTS discovery_runs (
  run_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);
