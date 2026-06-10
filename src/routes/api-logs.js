import { queryLogs, queryStats } from '../db.js';

export async function handleLogsApi(request, env) {
  const url = new URL(request.url);
  const hours = parseInt(url.searchParams.get('hours') || '24', 10);

  try {
    if (url.pathname === '/api/logs/stats') {
      const stats = await queryStats(env.DB, { hours });
      return jsonResponse(stats);
    }
    const logs = await queryLogs(env.DB, { hours });
    return jsonResponse(logs);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
