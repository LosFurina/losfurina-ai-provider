import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { queryCacheStats } from '../src/db.js';

async function seed(db) {
  await db.exec('DELETE FROM logs');
  const insert = (model, prompt, cacheCreate, cacheRead, total) =>
    db.prepare(
      `INSERT INTO logs (timestamp, model, method, path, status, duration_ms,
                         prompt_tokens, completion_tokens, total_tokens,
                         cache_creation_tokens, cache_read_tokens, source)
       VALUES (?, ?, 'POST', '/v1/messages', 200, 100, ?, 10, ?, ?, ?, 'proxy')`
    ).bind(new Date().toISOString(), model, prompt, total, cacheCreate, cacheRead).run();
  await insert('claude-opus-4-7', 100, 500, 9000, 9610);
  await insert('claude-opus-4-7', 200, 100, 5000, 5310);
  await insert('claude-haiku-4-5', 50, 0, 0, 60);
}

describe('queryCacheStats', () => {
  beforeEach(async () => { await seed(env.DB); });

  it('aggregates totals across the window', async () => {
    const r = await queryCacheStats(env.DB, { hours: 24 });
    expect(r.totalPrompt).toBe(350);
    expect(r.totalCacheCreation).toBe(600);
    expect(r.totalCacheRead).toBe(14000);
    expect(r.totalContext).toBe(350 + 600 + 14000);
    expect(r.requestCount).toBe(3);
  });

  it('computes overall hit rate', async () => {
    const r = await queryCacheStats(env.DB, { hours: 24 });
    expect(r.hitRate).toBeCloseTo(14000 / (350 + 600 + 14000), 4);
  });

  it('returns per-model breakdown sorted by total context', async () => {
    const r = await queryCacheStats(env.DB, { hours: 24 });
    expect(r.perModel).toHaveLength(2);
    expect(r.perModel[0].model).toBe('claude-opus-4-7');
    expect(r.perModel[0].requests).toBe(2);
    expect(r.perModel[0].cacheRead).toBe(14000);
    expect(r.perModel[0].hitRate).toBeGreaterThan(0.9);
    expect(r.perModel[1].model).toBe('claude-haiku-4-5');
    expect(r.perModel[1].cacheRead).toBe(0);
    expect(r.perModel[1].hitRate).toBe(0);
  });

  it('returns zeros when no rows in window', async () => {
    await env.DB.exec('DELETE FROM logs');
    const r = await queryCacheStats(env.DB, { hours: 24 });
    expect(r.requestCount).toBe(0);
    expect(r.totalContext).toBe(0);
    expect(r.hitRate).toBe(0);
    expect(r.perModel).toEqual([]);
  });
});
