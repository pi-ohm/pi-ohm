export const OHM_DB_SCHEMA_VERSION = 1;

export const OHM_DB_BOOTSTRAP_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ohm_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at_epoch_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ohm_state (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at_epoch_ms INTEGER NOT NULL,
  PRIMARY KEY(namespace, key)
);

CREATE TABLE IF NOT EXISTS ohm_subagent_session (
  id TEXT PRIMARY KEY,
  project_cwd TEXT NOT NULL,
  subagent_type TEXT NOT NULL,
  invocation TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  output TEXT,
  created_at_epoch_ms INTEGER NOT NULL,
  updated_at_epoch_ms INTEGER NOT NULL,
  ended_at_epoch_ms INTEGER
);

CREATE TABLE IF NOT EXISTS ohm_subagent_session_event (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  at_epoch_ms INTEGER NOT NULL,
  PRIMARY KEY(session_id, seq),
  FOREIGN KEY(session_id) REFERENCES ohm_subagent_session(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ohm_subagent_session_project_updated
  ON ohm_subagent_session(project_cwd, updated_at_epoch_ms DESC);

CREATE INDEX IF NOT EXISTS idx_ohm_subagent_session_event_session_at
  ON ohm_subagent_session_event(session_id, at_epoch_ms ASC);
`;
