import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { queryKpis } from '../src/db.js';

async function seed(db) {
  await db.exec(`DELETE FROM logs`);
  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  // 2 successes today, 1 error today, 1 success yesterday (outside 24h window)
  await db.prepare(
    `INSERT INTO logs (timestamp, model, method, path, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, request_body, response_body)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(now, 'gpt-4o', 'POST', '/v1/c', 200, 800, 100, 200, 300, '', '{}').run();
  await db.prepare(
    `INSERT INTO logs (timestamp, model, method, path, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, request_body, response_body)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(now, 'gpt-4o', 'POST', '/v1/c', 200, 1200, 100, 200, 300, '{}', '{}').run();
  await db.prepare(
    `INSERT INTO logs (timestamp, model, method, path, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, request_body, response_body)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(now, 'gpt-4o', 'POST', '/v1/c', 500, 200, 0, 0, 0, '{}', '{}').run();
  await db.prepare(
    `INSERT INTO logs (timestamp, model, method, path, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, request_body, response_body)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(earlier, 'gpt-4o', 'POST', '/v1/c', 200, 500, 100, 200, 300, '{}', '{}').run();
}

describe('queryKpis', () => {
  beforeEach(async () => { await seed(env.DB); });

  it('aggregates 24h KPIs', async () => {
    const k = await queryKpis(env.DB, { hours: 24 });
    expect(k.request_count).toBe(3);
    expect(k.error_count).toBe(1);
    expect(Math.round(k.success_rate * 1000) / 1000).toBe(0.667);
    expect(k.total_tokens).toBe(600);
    expect(k.avg_latency).toBeGreaterThan(700);
  });

  it('returns previous period for delta comparison', async () => {
    const k = await queryKpis(env.DB, { hours: 24, includePrevious: true });
    expect(k.previous).toBeDefined();
    expect(k.previous.request_count).toBe(1);
  });
});
