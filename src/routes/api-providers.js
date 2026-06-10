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

  // GET /api/providers
  const list = await listProviders(env.DB, { includeDisabled: true });
  // Compute uptime_24h for each
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
      model_count: Array.isArray(p.models) ? p.models.length : 0,
    };
  }));
  return jsonResponse(enriched);
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
