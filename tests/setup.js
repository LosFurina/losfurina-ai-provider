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
    cost_usd           REAL DEFAULT 0,
    source             TEXT DEFAULT 'proxy',
    provider_id        INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_model ON logs(model)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_status ON logs(status)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_cost ON logs(cost_usd)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_provider ON logs(provider_id)`,
];

beforeAll(async () => {
  for (const sql of DDL) {
    await env.DB.prepare(sql).run();
  }
});
