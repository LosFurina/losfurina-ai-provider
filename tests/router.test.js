import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { resolveProvider, aggregateModels, invalidateCache } from '../src/lib/router.js';

async function seed(db) {
  await db.exec(`DELETE FROM providers`);
  await db.prepare(
    `INSERT INTO providers (name, base_url, api_key, priority, enabled, models, health_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, 'healthy', datetime('now'), datetime('now'))`
  ).bind('A', 'https://a.test/v1', 'keyA', 10, '["gpt-4o","claude-4"]').run();
  await db.prepare(
    `INSERT INTO providers (name, base_url, api_key, priority, enabled, models, health_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, 'healthy', datetime('now'), datetime('now'))`
  ).bind('B', 'https://b.test/v1', 'keyB', 5, '["gpt-4o","deepseek-v3"]').run();
  await db.prepare(
    `INSERT INTO providers (name, base_url, api_key, priority, enabled, models, health_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, 'healthy', datetime('now'), datetime('now'))`
  ).bind('C-disabled', 'https://c.test/v1', 'keyC', 1, '["o1-preview"]').run();
}

describe('resolveProvider', () => {
  beforeEach(async () => { await seed(env.DB); invalidateCache(); });

  it('returns the higher-priority (lower number) Provider on conflict', async () => {
    const p = await resolveProvider(env.DB, 'gpt-4o');
    expect(p).not.toBeNull();
    expect(p.name).toBe('B');
  });

  it('returns the only Provider that owns a unique model', async () => {
    const p = await resolveProvider(env.DB, 'claude-4');
    expect(p.name).toBe('A');
  });

  it('skips disabled Providers', async () => {
    const p = await resolveProvider(env.DB, 'o1-preview');
    expect(p).toBeNull();
  });

  it('returns null for unknown model', async () => {
    const p = await resolveProvider(env.DB, 'unknown-model');
    expect(p).toBeNull();
  });
});

describe('aggregateModels', () => {
  beforeEach(async () => { await seed(env.DB); invalidateCache(); });

  it('returns deduplicated model list with owner', async () => {
    const list = await aggregateModels(env.DB);
    const ids = list.map(m => m.id);
    expect(ids).toContain('gpt-4o');
    expect(ids).toContain('claude-4');
    expect(ids).toContain('deepseek-v3');
    expect(ids).not.toContain('o1-preview');
    const gpt = list.find(m => m.id === 'gpt-4o');
    expect(gpt.owned_by).toBe('B'); // higher priority wins
  });
});
