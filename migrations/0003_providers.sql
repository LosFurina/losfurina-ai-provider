-- migrations/0003_providers.sql
CREATE TABLE IF NOT EXISTS providers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL UNIQUE,
  base_url          TEXT NOT NULL,
  api_key           TEXT NOT NULL,
  priority          INTEGER NOT NULL DEFAULT 100,
  enabled           INTEGER NOT NULL DEFAULT 1,
  models            TEXT DEFAULT '[]',
  health_status     TEXT DEFAULT 'unknown',
  last_latency_ms   INTEGER,
  last_checked_at   TEXT,
  last_error        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_providers_enabled ON providers(enabled);
CREATE INDEX IF NOT EXISTS idx_providers_priority ON providers(priority);

CREATE TABLE IF NOT EXISTS provider_health_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id  INTEGER NOT NULL,
  checked_at   TEXT NOT NULL,
  status       TEXT NOT NULL,
  latency_ms   INTEGER,
  http_status  INTEGER,
  model_count  INTEGER,
  error        TEXT
);

CREATE INDEX IF NOT EXISTS idx_health_provider_time ON provider_health_logs(provider_id, checked_at);
