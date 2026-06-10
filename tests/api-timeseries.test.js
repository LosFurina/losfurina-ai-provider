import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { queryTimeseries } from '../src/db.js';

async function seed(db) {
  await db.exec(`DELETE FROM logs`);
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    const ts = new Date(now - i * 3600 * 1000).toISOString();
    await db.prepare(
      `INSERT INTO logs (timestamp, model, method, path, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, cost_usd, request_body, response_body)
       VALUES (?, ?, 'POST', '/v1/c', 200, 500, 100, 200, 300, ?, '{}', '{}')`
    ).bind(ts, 'gpt-4o', 0.01).run();
  }
}

describe('queryTimeseries', () => {
  beforeEach(async () => { await seed(env.DB); });

  it('buckets by hour for last 6 hours, count metric', async () => {
    const result = await queryTimeseries(env.DB, { hours: 6, granularity: 'hour', metric: 'count' });
    expect(Array.isArray(result.buckets)).toBe(true);
    expect(result.buckets.length).toBe(6);
    const totalValue = result.buckets.reduce((s, b) => s + b.value, 0);
    expect(totalValue).toBe(5);
  });

  it('buckets cost metric and includes breakdown by model', async () => {
    const result = await queryTimeseries(env.DB, { hours: 6, granularity: 'hour', metric: 'cost', breakdown: 'model' });
    const total = result.buckets.reduce((s, b) => s + b.value, 0);
    expect(Math.round(total * 100) / 100).toBe(0.05);
    const someBucket = result.buckets.find(b => b.value > 0);
    expect(someBucket.breakdown).toBeDefined();
    expect(someBucket.breakdown['gpt-4o']).toBeGreaterThan(0);
  });
});
