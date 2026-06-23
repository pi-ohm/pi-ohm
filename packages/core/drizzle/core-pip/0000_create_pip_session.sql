CREATE TABLE IF NOT EXISTS ohm_pip_session (
  pip_id TEXT PRIMARY KEY,
  owner_package TEXT NOT NULL,
  role TEXT NOT NULL,
  parent_session_id TEXT NOT NULL,
  child_session_id TEXT NOT NULL,
  child_session_file TEXT,
  status_state TEXT NOT NULL,
  status_result TEXT,
  status_error TEXT,
  created_at_epoch_ms INTEGER NOT NULL,
  updated_at_epoch_ms INTEGER NOT NULL
);
