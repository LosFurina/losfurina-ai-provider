// src/routes/api-providers.js
import { listProviders } from '../lib/router.js';
import { probeAllProviders } from '../lib/healthcheck.js';

export async function handleProvidersApi(request, env, ctx) {
  const url = new URL(request.url);
  const method = request.method;

  // POST /api/providers/probe — manual trigger
  if (url.pathname === '/api/providers/probe' && method === 'POST') {
    await probeAllProviders(env, ctx);
    return jsonResponse({ ok: true });
  }

  // GET /api/providers/:id/health
  const healthMatch = url.pathname.match(/^\/api\/providers\/(\d+)\/health$/);
  if (healthMatch) {
    const id = parseInt(healthMatch[1], 10);
    const hours = parseInt(url.searchParams.get('hours') || '24', 10);
    const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const { results } = await env.DB.prepare(
      `SELECT checked_at AS ts, status, latency_ms, http_status, model_count, error
       FROM provider_health_logs
       WHERE provider_id = ? AND checked_at >= ?
       ORDER BY checked_at ASC`
    ).bind(id, cutoff).all();
    return jsonResponse({ buckets: results });
  }

  // POST /api/providers — create
  if (url.pathname === '/api/providers' && method === 'POST') {
    const body = await safeJson(request);
    const err = validate(body, true);
    if (err) return jsonResponse({ error: err }, 400);
    const now = new Date().toISOString();
    const result = await env.DB.prepare(
      `INSERT INTO providers (name, base_url, api_key, priority, enabled, models, model_map, health_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '{}', 'unknown', ?, ?)`
    ).bind(
      body.name.trim(),
      body.base_url.trim(),
      body.api_key.trim(),
      body.priority ?? 100,
      body.enabled === false ? 0 : 1,
      JSON.stringify(normalizeModels(body.models)),
      now, now,
    ).run();
    return jsonResponse({ id: result.meta.last_row_id }, 201);
  }

  // PATCH /api/providers/:id — update
  // DELETE /api/providers/:id — delete
  const idMatch = url.pathname.match(/^\/api\/providers\/(\d+)$/);
  if (idMatch) {
    const id = parseInt(idMatch[1], 10);
    if (method === 'DELETE') {
      await env.DB.prepare(`DELETE FROM providers WHERE id = ?`).bind(id).run();
      return jsonResponse({ ok: true });
    }
    if (method === 'PATCH') {
      const body = await safeJson(request);
      const err = validate(body, false);
      if (err) return jsonResponse({ error: err }, 400);
      const sets = [];
      const args = [];
      if (body.name !== undefined)     { sets.push('name = ?');      args.push(body.name.trim()); }
      if (body.base_url !== undefined) { sets.push('base_url = ?');  args.push(body.base_url.trim()); }
      if (body.api_key !== undefined && body.api_key !== '')
                                       { sets.push('api_key = ?');   args.push(body.api_key.trim()); }
      if (body.priority !== undefined) { sets.push('priority = ?');  args.push(body.priority); }
      if (body.enabled !== undefined)  { sets.push('enabled = ?');   args.push(body.enabled ? 1 : 0); }
      if (body.models !== undefined)   { sets.push('models = ?');    args.push(JSON.stringify(normalizeModels(body.models))); }
      if (!sets.length) return jsonResponse({ error: 'no fields to update' }, 400);
      sets.push('updated_at = ?');
      args.push(new Date().toISOString());
      args.push(id);
      await env.DB.prepare(`UPDATE providers SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run();
      return jsonResponse({ ok: true });
    }
  }

  // GET /api/providers
  const list = await listProviders(env.DB, { includeDisabled: true });
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const enriched = await Promise.all(list.map(async p => {
    const { results } = await env.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'healthy' THEN 1 ELSE 0 END) AS healthy
       FROM provider_health_logs WHERE provider_id = ? AND checked_at >= ?`
    ).bind(p.id, cutoff).all();
    const row = results[0] || { total: 0, healthy: 0 };
    const uptime = row.total > 0 ? row.healthy / row.total : null;
    return {
      ...p,
      api_key: maskKey(p.api_key),
      uptime_24h: uptime,
      model_count: Object.keys(p.model_map || {}).length || (Array.isArray(p.models) ? p.models.length : 0),
      prefixed_models: Object.keys(p.model_map || {}),
    };
  }));
  return jsonResponse(enriched);
}

async function safeJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function validate(body, requireAll) {
  if (!body || typeof body !== 'object') return 'invalid body';
  const required = ['name', 'base_url', 'api_key'];
  if (requireAll) {
    for (const k of required) {
      if (!body[k] || typeof body[k] !== 'string' || !body[k].trim()) return `missing field: ${k}`;
    }
  }
  if (body.base_url !== undefined && body.base_url && !/^https?:\/\//.test(body.base_url)) {
    return 'base_url must start with http(s)://';
  }
  if (body.priority !== undefined && (typeof body.priority !== 'number' || body.priority < 0)) {
    return 'priority must be a non-negative number';
  }
  return null;
}

function normalizeModels(models) {
  if (Array.isArray(models)) return models.map(m => String(m).trim()).filter(Boolean);
  if (typeof models === 'string') return models.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '...' + key.slice(-4);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
