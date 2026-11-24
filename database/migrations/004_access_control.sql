ALTER TABLE access_profiles ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE access_profiles ADD COLUMN last_checked_at TEXT;
ALTER TABLE access_profiles ADD COLUMN notes_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS access_secrets (
  profile_id TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  encoding TEXT NOT NULL DEFAULT 'base64',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profile_id) REFERENCES access_profiles(profile_id)
);

CREATE TABLE IF NOT EXISTS permission_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  permissions_json TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profile_id) REFERENCES access_profiles(profile_id)
);

CREATE TABLE IF NOT EXISTS quota_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  remaining INTEGER,
  limit_value INTEGER,
  resets_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profile_id) REFERENCES access_profiles(profile_id)
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
