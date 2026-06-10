-- migrations/0004_pricing_alerts.sql
CREATE TABLE IF NOT EXISTS pricing (
  model              TEXT PRIMARY KEY,
  prompt_per_1k      REAL NOT NULL,
  completion_per_1k  REAL NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  metric       TEXT NOT NULL,
  operator     TEXT NOT NULL,
  threshold    REAL NOT NULL,
  window_min   INTEGER DEFAULT 10,
  action       TEXT NOT NULL,
  enabled      INTEGER DEFAULT 1,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_triggers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id      INTEGER NOT NULL,
  triggered_at TEXT NOT NULL,
  actual_value REAL NOT NULL,
  context      TEXT,
  acknowledged INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_alert_triggers_unack
  ON alert_triggers(acknowledged, triggered_at);

INSERT OR IGNORE INTO pricing (model, prompt_per_1k, completion_per_1k, updated_at) VALUES
  ('gpt-4o',                0.0025,  0.010, datetime('now')),
  ('gpt-4o-mini',           0.00015, 0.0006, datetime('now')),
  ('claude-4',              0.003,   0.015,  datetime('now')),
  ('claude-3-5-sonnet',     0.003,   0.015,  datetime('now')),
  ('deepseek-v3',           0.00027, 0.0011, datetime('now'));
