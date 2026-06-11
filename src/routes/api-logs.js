import { queryLogs, queryStats, queryLogById, queryKpis, queryTimeseries } from '../db.js';

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
    if (url.pathname === '/api/poll') {
      const since = url.searchParams.get('since');
      const sinceClause = since ? 'AND timestamp > ?' : '';
      const sinceArgs = since ? [since] : [];
      const { results: newLogs } = await env.DB.prepare(
        `SELECT * FROM logs WHERE 1=1 ${sinceClause} ORDER BY id DESC LIMIT 50`
      ).bind(...sinceArgs).all();

      const { results: alerts } = await env.DB.prepare(
        `SELECT t.id, t.triggered_at, t.actual_value, t.context, r.name AS rule_name, r.metric, r.action
         FROM alert_triggers t LEFT JOIN alert_rules r ON r.id = t.rule_id
         WHERE t.acknowledged = 0 AND (r.action = 'banner' OR r.action = 'both')
         ORDER BY t.triggered_at DESC LIMIT 10`
      ).all();

      return jsonResponse({ logs: newLogs, alerts, server_time: new Date().toISOString() });
    }

    if (url.pathname === '/api/logs/kpis') {
      const includePrevious = url.searchParams.get('compare') === 'true';
      const kpis = await queryKpis(env.DB, { hours, includePrevious });
      return jsonResponse(kpis);
    }

    if (url.pathname === '/api/logs/timeseries') {
      const ts = await queryTimeseries(env.DB, {
        hours,
        granularity: url.searchParams.get('granularity') || 'hour',
        metric: url.searchParams.get('metric') || 'count',
        breakdown: url.searchParams.get('breakdown') || undefined,
      });
      return jsonResponse(ts);
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
      search: url.searchParams.get('search') || undefined,
      providerId: url.searchParams.has('provider_id') ? parseInt(url.searchParams.get('provider_id'), 10) : undefined,
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
