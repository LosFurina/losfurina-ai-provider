let cache = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 30 * 1000;

export function invalidateCache() {
  cache = null;
  cacheExpiry = 0;
}

async function getProviders(db) {
  const now = Date.now();
  if (cache && now < cacheExpiry) return cache;
  const { results } = await db.prepare(
    `SELECT id, name, base_url, api_key, priority, enabled, models, health_status
     FROM providers
     WHERE enabled = 1
     ORDER BY priority ASC`
  ).all();
  cache = results.map(r => ({ ...r, models: safeParse(r.models) }));
  cacheExpiry = now + CACHE_TTL_MS;
  return cache;
}

function safeParse(s) {
  try { return JSON.parse(s || '[]'); } catch { return []; }
}

export async function resolveProvider(db, model) {
  if (!model) return null;
  const providers = await getProviders(db);
  for (const p of providers) {
    if (p.health_status === 'unhealthy') continue;
    if (Array.isArray(p.models) && p.models.includes(model)) return p;
  }
  return null;
}

export async function aggregateModels(db) {
  const providers = await getProviders(db);
  const seen = new Set();
  const result = [];
  for (const p of providers) {
    if (p.health_status === 'unhealthy') continue;
    for (const m of (p.models || [])) {
      if (seen.has(m)) continue;
      seen.add(m);
      result.push({ id: m, object: 'model', owned_by: p.name });
    }
  }
  return result;
}

export async function listProviders(db, { includeDisabled = false } = {}) {
  const where = includeDisabled ? '' : 'WHERE enabled = 1';
  const { results } = await db.prepare(
    `SELECT * FROM providers ${where} ORDER BY priority ASC`
  ).all();
  return results.map(r => ({ ...r, models: safeParse(r.models) }));
}
