import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { queryLogs } from '../src/db.js';

async function seed(db) {
  await db.exec(`DELETE FROM logs`);
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO logs (timestamp, model, method, path, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, request_body, response_body)
     VALUES (?, ?, 'POST', '/v1/chat/completions', ?, ?, 100, 200, 300, ?, ?)`
  ).bind(now, 'gpt-4o', 200, 800, '{"q":"hello"}', '{"a":"world"}').run();
  await db.prepare(
    `INSERT INTO logs (timestamp, model, method, path, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, request_body, response_body)
     VALUES (?, ?, 'POST', '/v1/chat/completions', ?, ?, 200, 400, 600, ?, ?)`
  ).bind(now, 'claude-4', 429, 300, '{"q":"big"}', '{}').run();
}

describe('queryLogs filters', () => {
  beforeEach(async () => { await seed(env.DB); });

  it('filters by model', async () => {
    const rows = await queryLogs(env.DB, { hours: 24, models: ['gpt-4o'] });
    expect(rows.length).toBe(1);
    expect(rows[0].model).toBe('gpt-4o');
  });

  it('filters by status range (4xx)', async () => {
    const rows = await queryLogs(env.DB, { hours: 24, statusBucket: '4xx' });
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe(429);
  });

  it('filters by full-text search on request_body', async () => {
    const rows = await queryLogs(env.DB, { hours: 24, search: 'big' });
    expect(rows.length).toBe(1);
    expect(rows[0].model).toBe('claude-4');
  });

  it('cursor-based pagination returns next page', async () => {
    const page1 = await queryLogs(env.DB, { hours: 24, limit: 1 });
    expect(page1.length).toBe(1);
    const page2 = await queryLogs(env.DB, { hours: 24, limit: 1, cursor: page1[0].id });
    expect(page2.length).toBe(1);
    expect(page2[0].id).not.toBe(page1[0].id);
  });
});
