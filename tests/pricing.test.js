import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { calculateCost, invalidatePricingCache } from '../src/lib/pricing.js';

async function seedPricing(db) {
  await db.exec('DELETE FROM pricing');
  await db.prepare(
    'INSERT INTO pricing (model, prompt_per_1k, completion_per_1k, updated_at) VALUES (?, ?, ?, datetime("now"))'
  ).bind('gpt-4o', 0.0025, 0.010).run();
}

describe('calculateCost', () => {
  beforeEach(async () => {
    await seedPricing(env.DB);
    invalidatePricingCache();
  });

  it('returns 0 for unknown model', async () => {
    const cost = await calculateCost(env.DB, 'unknown-model', 1000, 500);
    expect(cost).toBe(0);
  });

  it('calculates cost correctly for known model', async () => {
    const cost = await calculateCost(env.DB, 'gpt-4o', 1000, 500);
    // 1000/1000 * 0.0025 + 500/1000 * 0.010 = 0.0025 + 0.005 = 0.0075
    expect(cost).toBeCloseTo(0.0075, 6);
  });

  it('returns 0 when token counts are 0', async () => {
    const cost = await calculateCost(env.DB, 'gpt-4o', 0, 0);
    expect(cost).toBe(0);
  });
});
