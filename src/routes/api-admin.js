// src/routes/api-admin.js

export async function handleAdminApi(request, env) {
  const url = new URL(request.url);
  const method = request.method;

  // /api/admin/alerts
  if (url.pathname === '/api/admin/alerts' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM alert_rules ORDER BY id').all();
    return json(results);
  }
  if (url.pathname === '/api/admin/alerts' && method === 'POST') {
    const body = await request.json();
    const { name, metric, operator, threshold, window_min = 10, action, enabled = 1 } = body;
    const result = await env.DB.prepare(
      `INSERT INTO alert_rules (name, metric, operator, threshold, window_min, action, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(name, metric, operator, threshold, window_min, action, enabled ? 1 : 0).run();
    return json({ id: result.meta.last_row_id });
  }
  if (url.pathname.match(/^\/api\/admin\/alerts\/\d+$/) && method === 'PUT') {
    const id = parseInt(url.pathname.split('/').pop(), 10);
    const body = await request.json();
    const fields = ['name','metric','operator','threshold','window_min','action','enabled'];
    const updates = fields.filter(f => f in body);
    const sql = `UPDATE alert_rules SET ${updates.map(f => f + ' = ?').join(', ')} WHERE id = ?`;
    await env.DB.prepare(sql).bind(...updates.map(f => body[f]), id).run();
    return json({ ok: true });
  }
  if (url.pathname.match(/^\/api\/admin\/alerts\/\d+$/) && method === 'DELETE') {
    const id = parseInt(url.pathname.split('/').pop(), 10);
    await env.DB.prepare('DELETE FROM alert_rules WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  // /api/admin/alerts/triggered
  if (url.pathname === '/api/admin/alerts/triggered' && method === 'GET') {
    const onlyUnack = url.searchParams.get('unack') === 'true';
    const sql = onlyUnack
      ? `SELECT t.*, r.name AS rule_name, r.metric AS rule_metric
         FROM alert_triggers t LEFT JOIN alert_rules r ON r.id = t.rule_id
         WHERE t.acknowledged = 0 ORDER BY t.triggered_at DESC LIMIT 50`
      : `SELECT t.*, r.name AS rule_name, r.metric AS rule_metric
         FROM alert_triggers t LEFT JOIN alert_rules r ON r.id = t.rule_id
         ORDER BY t.triggered_at DESC LIMIT 50`;
    const { results } = await env.DB.prepare(sql).all();
    return json(results);
  }
  if (url.pathname.match(/^\/api\/admin\/alerts\/triggered\/\d+\/ack$/) && method === 'PUT') {
    const id = parseInt(url.pathname.split('/').slice(-2, -1)[0], 10);
    await env.DB.prepare('UPDATE alert_triggers SET acknowledged = 1 WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  return json({ error: 'not_found' }, 404);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
