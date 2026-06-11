import { env } from 'cloudflare:test';
import { beforeAll } from 'vitest';

const DDL = [
  `CREATE TABLE IF NOT EXISTS logs (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp          TEXT NOT NULL,
    model              TEXT NOT NULL,
    method             TEXT NOT NULL,
    path               TEXT NOT NULL,
    status             INTEGER NOT NULL,
    duration_ms        INTEGER NOT NULL,
    prompt_tokens      INTEGER DEFAULT 0,
    completion_tokens  INTEGER DEFAULT 0,
    total_tokens       INTEGER DEFAULT 0,
    request_body       TEXT,
    response_body      TEXT,
    source             TEXT DEFAULT 'proxy',
    provider_id        INTEGER,
    cache_creation_tokens INTEGER DEFAULT 0,
    cache_read_tokens     INTEGER DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_model ON logs(model)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_status ON logs(status)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_provider ON logs(provider_id)`,
  `CREATE TABLE IF NOT EXISTS providers (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL UNIQUE,
    base_url          TEXT NOT NULL,
    api_key           TEXT NOT NULL,
    priority          INTEGER NOT NULL DEFAULT 100,
    enabled           INTEGER NOT NULL DEFAULT 1,
    models            TEXT DEFAULT '[]',
    model_map         TEXT DEFAULT '{}',
    health_status     TEXT DEFAULT 'unknown',
    last_latency_ms   INTEGER,
    last_checked_at   TEXT,
    last_error        TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS provider_health_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id  INTEGER NOT NULL,
    checked_at   TEXT NOT NULL,
    status       TEXT NOT NULL,
    latency_ms   INTEGER,
    http_status  INTEGER,
    model_count  INTEGER,
    error        TEXT
  )`,
];

beforeAll(async () => {
  for (const sql of DDL) {
    await env.DB.prepare(sql).run();
  }
});
