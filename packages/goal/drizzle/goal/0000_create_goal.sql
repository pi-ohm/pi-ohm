CREATE TABLE IF NOT EXISTS ohm_goal (
  session_id TEXT PRIMARY KEY NOT NULL,
  goal_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'blocked', 'usage_limited', 'budget_limited', 'complete')),
  token_budget INTEGER CHECK(token_budget IS NULL OR token_budget > 0),
  tokens_used INTEGER NOT NULL DEFAULT 0 CHECK(tokens_used >= 0),
  time_used_seconds INTEGER NOT NULL DEFAULT 0 CHECK(time_used_seconds >= 0),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ohm_goal_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  turn_key TEXT,
  token_delta INTEGER,
  time_delta_seconds INTEGER,
  created_at_ms INTEGER NOT NULL,
  payload_json TEXT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ohm_goal_event_session_created_idx
ON ohm_goal_event (session_id, created_at_ms DESC);
