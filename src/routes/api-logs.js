import { queryLogs, queryStats, queryLogById, queryKpis } from '../db.js';

export async function handleLogsApi(request, env) {
  const url = new URL(request.url);

  // /api/logs/:id
  const idMatch = url.pathname.match(/^\/api\/logs\/(\d+)$/);
  if (idMatch) {
    const row = await queryLogById(env.DB, parseInt(idMatch[1], 10));
    if (!row) return jsonResponse({ error: 'not_found' }, 404);
    return jsonResponse(row);
  }

  const hours = parseInt(url.searchParams.get('hours') || '24', 10);

  try {
    if (url.pathname === '/api/logs/kpis') {
      const includePrevious = url.searchParams.get('compare') === 'true';
      const kpis = await queryKpis(env.DB, { hours, includePrevious });
      return jsonResponse(kpis);
    }

    if (url.pathname === '/api/logs/stats') {
      const stats = await queryStats(env.DB, { hours });
      return jsonResponse(stats);
    }

    const opts = {
      hours,
      limit: parseInt(url.searchParams.get('limit') || '100', 10),
      cursor: url.searchParams.has('cursor') ? parseInt(url.searchParams.get('cursor'), 10) : undefined,
      models: url.searchParams.getAll('model'),
      statusBucket: url.searchParams.get('status') || undefined,
      minDuration: numParam(url, 'min_duration'),
      maxDuration: numParam(url, 'max_duration'),
      minCost: numParam(url, 'min_cost'),
      maxCost: numParam(url, 'max_cost'),
      search: url.searchParams.get('search') || undefined,
    };
    const logs = await queryLogs(env.DB, opts);
    return jsonResponse(logs);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

function numParam(url, key) {
  const v = url.searchParams.get(key);
  return v === null ? undefined : parseFloat(v);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
