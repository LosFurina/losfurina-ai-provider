let pricingCache = null;
let pricingCacheExpiry = 0;
const CACHE_TTL_MS = 60 * 1000;

export function invalidatePricingCache() {
  pricingCache = null;
  pricingCacheExpiry = 0;
}

export async function getPricing(db) {
  const now = Date.now();
  if (pricingCache && now < pricingCacheExpiry) return pricingCache;
  const { results } = await db.prepare('SELECT * FROM pricing').all();
  pricingCache = new Map(results.map(r => [r.model, r]));
  pricingCacheExpiry = now + CACHE_TTL_MS;
  return pricingCache;
}

export async function calculateCost(db, model, promptTokens, completionTokens) {
  const pricing = await getPricing(db);
  const p = pricing.get(model);
  if (!p) return 0;
  return (promptTokens / 1000) * p.prompt_per_1k + (completionTokens / 1000) * p.completion_per_1k;
}
