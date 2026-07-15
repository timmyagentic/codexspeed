CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  payload_sha256 TEXT NOT NULL,
  suite_version TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  runner_version TEXT NOT NULL,
  codex_cli_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  status TEXT NOT NULL,
  public_payload_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  published_at TEXT NOT NULL
);

CREATE INDEX runs_published_at_idx ON runs(published_at DESC, run_id DESC);

CREATE TABLE site_state (
  key TEXT PRIMARY KEY CHECK (key = 'latest'),
  latest_run_id TEXT NOT NULL REFERENCES runs(run_id),
  generation INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
