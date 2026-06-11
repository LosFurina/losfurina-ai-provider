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
    `SELECT id, name, base_url, api_key, priority, enabled, models, model_map, health_status
     FROM providers
     WHERE enabled = 1
     ORDER BY priority ASC`
  ).all();
  cache = results.map(r => ({ ...r, models: safeParse(r.models), model_map: safeParseObj(r.model_map) }));
  cacheExpiry = now + CACHE_TTL_MS;
  return cache;
}

function safeParse(s) {
  try { return JSON.parse(s || '[]'); } catch { return []; }
}

function safeParseObj(s) {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

export async function resolveProvider(db, model) {
  if (!model) return null;
  const providers = await getProviders(db);
  // First pass: exact match on prefixed model_map keys
  for (const p of providers) {
    if (p.health_status === 'unhealthy') continue;
    if (p.model_map[model]) {
      return { provider: p, rawModel: p.model_map[model] };
    }
  }
  // Fallback: bare-name match on models array (priority-based)
  for (const p of providers) {
    if (p.health_status === 'unhealthy') continue;
    if (Array.isArray(p.models) && p.models.includes(model)) {
      return { provider: p, rawModel: model };
    }
  }
  return null;
}

export async function aggregateModels(db) {
  const providers = await getProviders(db);
  const seen = new Set();
  const result = [];
  for (const p of providers) {
    if (p.health_status === 'unhealthy') continue;
    for (const prefixedName of Object.keys(p.model_map)) {
      if (seen.has(prefixedName)) continue;
      seen.add(prefixedName);
      result.push({ id: prefixedName, object: 'model', owned_by: p.name });
    }
  }
  return result;
}

export async function listProviders(db, { includeDisabled = false } = {}) {
  const where = includeDisabled ? '' : 'WHERE enabled = 1';
  const { results } = await db.prepare(
    `SELECT * FROM providers ${where} ORDER BY priority ASC`
  ).all();
  return results.map(r => ({ ...r, models: safeParse(r.models), model_map: safeParseObj(r.model_map) }));
}
