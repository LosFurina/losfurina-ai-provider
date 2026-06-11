import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { resolveProvider, aggregateModels, invalidateCache } from '../src/lib/router.js';

async function seed(db) {
  await db.exec(`DELETE FROM providers`);
  await db.prepare(
    `INSERT INTO providers (name, base_url, api_key, priority, enabled, models, model_map, health_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, 'healthy', datetime('now'), datetime('now'))`
  ).bind('A', 'https://a.test/v1', 'keyA', 10, '["gpt-4o","claude-4"]', '{"A-gpt-4o":"gpt-4o","A-claude-4":"claude-4"}').run();
  await db.prepare(
    `INSERT INTO providers (name, base_url, api_key, priority, enabled, models, model_map, health_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, 'healthy', datetime('now'), datetime('now'))`
  ).bind('B', 'https://b.test/v1', 'keyB', 5, '["gpt-4o","deepseek-v3"]', '{"B-gpt-4o":"gpt-4o","B-deepseek-v3":"deepseek-v3"}').run();
  await db.prepare(
    `INSERT INTO providers (name, base_url, api_key, priority, enabled, models, model_map, health_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, 'healthy', datetime('now'), datetime('now'))`
  ).bind('C-disabled', 'https://c.test/v1', 'keyC', 1, '["o1-preview"]', '{"C-disabled-o1-preview":"o1-preview"}').run();
}

describe('resolveProvider', () => {
  beforeEach(async () => { await seed(env.DB); invalidateCache(); });

  it('resolves prefixed model to exact provider', async () => {
    const r = await resolveProvider(env.DB, 'A-claude-4');
    expect(r).not.toBeNull();
    expect(r.provider.name).toBe('A');
    expect(r.rawModel).toBe('claude-4');
  });

  it('prefixed match bypasses priority (B-gpt-4o goes to B)', async () => {
    const r = await resolveProvider(env.DB, 'B-gpt-4o');
    expect(r.provider.name).toBe('B');
    expect(r.rawModel).toBe('gpt-4o');
  });

  it('bare model falls back to priority-based routing', async () => {
    const r = await resolveProvider(env.DB, 'gpt-4o');
    expect(r).not.toBeNull();
    expect(r.provider.name).toBe('B');
    expect(r.rawModel).toBe('gpt-4o');
  });

  it('bare unique model resolves correctly', async () => {
    const r = await resolveProvider(env.DB, 'claude-4');
    expect(r.provider.name).toBe('A');
    expect(r.rawModel).toBe('claude-4');
  });

  it('skips disabled Providers', async () => {
    const r = await resolveProvider(env.DB, 'C-disabled-o1-preview');
    expect(r).toBeNull();
  });

  it('returns null for unknown model', async () => {
    const r = await resolveProvider(env.DB, 'unknown-model');
    expect(r).toBeNull();
  });
});

describe('aggregateModels', () => {
  beforeEach(async () => { await seed(env.DB); invalidateCache(); });

  it('returns prefixed model names from model_map', async () => {
    const list = await aggregateModels(env.DB);
    const ids = list.map(m => m.id);
    expect(ids).toContain('B-gpt-4o');
    expect(ids).toContain('B-deepseek-v3');
    expect(ids).toContain('A-gpt-4o');
    expect(ids).toContain('A-claude-4');
    expect(ids).not.toContain('C-disabled-o1-preview');
  });

  it('sets owned_by to provider name', async () => {
    const list = await aggregateModels(env.DB);
    const bGpt = list.find(m => m.id === 'B-gpt-4o');
    expect(bGpt.owned_by).toBe('B');
  });
});
