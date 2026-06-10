export async function insertLog(db, logEntry) {
  const {
    timestamp, model, method, path, status, durationMs,
    promptTokens, completionTokens, totalTokens,
    requestBody, responseBody,
    costUsd = 0, source = 'proxy', providerId = null,
  } = logEntry;
  await db.prepare(
    `INSERT INTO logs (timestamp, model, method, path, status, duration_ms,
                       prompt_tokens, completion_tokens, total_tokens,
                       request_body, response_body, cost_usd, source, provider_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    timestamp, model, method, path, status, durationMs,
    promptTokens, completionTokens, totalTokens,
    requestBody, responseBody, costUsd, source, providerId
  ).run();
}

export async function queryLogs(db, opts = {}) {
  const {
    hours = 24,
    limit = 100,
    cursor,
    models,
    statusBucket,
    minDuration,
    maxDuration,
    minCost,
    maxCost,
    search,
    providerId,
  } = opts;

  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const where = ['timestamp >= ?'];
  const args = [cutoff];

  if (Array.isArray(models) && models.length) {
    where.push(`model IN (${models.map(() => '?').join(',')})`);
    args.push(...models);
  }
  if (statusBucket === '2xx') { where.push('status BETWEEN 200 AND 299'); }
  if (statusBucket === '4xx') { where.push('status BETWEEN 400 AND 499'); }
  if (statusBucket === '5xx') { where.push('status BETWEEN 500 AND 599'); }
  if (typeof minDuration === 'number') { where.push('duration_ms >= ?'); args.push(minDuration); }
  if (typeof maxDuration === 'number') { where.push('duration_ms <= ?'); args.push(maxDuration); }
  if (typeof minCost === 'number') { where.push('cost_usd >= ?'); args.push(minCost); }
  if (typeof maxCost === 'number') { where.push('cost_usd <= ?'); args.push(maxCost); }
  if (search) {
    where.push('(request_body LIKE ? OR response_body LIKE ?)');
    const pat = `%${search.replace(/[%_]/g, '\\$&')}%`;
    args.push(pat, pat);
  }
  if (providerId != null) {
    where.push('provider_id = ?');
    args.push(providerId);
  }
  if (cursor) { where.push('id < ?'); args.push(cursor); }

  const sql = `SELECT * FROM logs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`;
  args.push(limit);
  const { results } = await db.prepare(sql).bind(...args).all();
  return results;
}

export async function queryLogById(db, id) {
  const row = await db.prepare('SELECT * FROM logs WHERE id = ?').bind(id).first();
  return row || null;
}

export async function queryKpis(db, { hours = 24, includePrevious = false } = {}) {
  const now = Date.now();
  const cutoff = new Date(now - hours * 3600 * 1000).toISOString();
  const current = await aggregateWindow(db, cutoff, new Date(now).toISOString());

  if (!includePrevious) return current;

  const prevStart = new Date(now - hours * 2 * 3600 * 1000).toISOString();
  const prevEnd = cutoff;
  const previous = await aggregateWindow(db, prevStart, prevEnd);
  return { ...current, previous };
}

async function aggregateWindow(db, startIso, endIso) {
  const row = await db.prepare(
    `SELECT
       COUNT(*)                                  AS request_count,
       SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS error_count,
       COALESCE(SUM(total_tokens), 0)            AS total_tokens,
       COALESCE(SUM(cost_usd), 0)                AS total_cost,
       COALESCE(AVG(duration_ms), 0)             AS avg_latency
     FROM logs
     WHERE timestamp >= ? AND timestamp < ?`
  ).bind(startIso, endIso).first();

  const rc = row.request_count || 0;
  const success_rate = rc > 0 ? (rc - (row.error_count || 0)) / rc : 0;
  return {
    request_count: rc,
    error_count: row.error_count || 0,
    success_rate,
    total_tokens: row.total_tokens || 0,
    total_cost: row.total_cost || 0,
    avg_latency: Math.round(row.avg_latency || 0),
  };
}

export async function queryStats(db, { hours = 24 } = {}) {
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { results } = await db.prepare(
    `SELECT
       model,
       COUNT(*) AS request_count,
       SUM(total_tokens) AS total_tokens,
       SUM(prompt_tokens) AS prompt_tokens,
       SUM(completion_tokens) AS completion_tokens,
       SUM(cost_usd) AS cost_usd,
       ROUND(AVG(duration_ms), 1) AS avg_duration_ms
     FROM logs
     WHERE timestamp >= ?
     GROUP BY model
     ORDER BY request_count DESC`
  ).bind(cutoff).all();
  return results;
}

export async function queryTimeseries(db, { hours = 24, granularity = 'hour', metric = 'count', breakdown } = {}) {
  const now = Date.now();
  const cutoff = new Date(now - hours * 3600 * 1000).toISOString();
  const bucketSeconds = granularity === 'hour' ? 3600 : 86400;
  const bucketFmt = granularity === 'hour' ? '%Y-%m-%dT%H:00:00Z' : '%Y-%m-%dT00:00:00Z';

  const metricSql = {
    count: 'COUNT(*)',
    cost: 'COALESCE(SUM(cost_usd), 0)',
    tokens: 'COALESCE(SUM(total_tokens), 0)',
    latency_avg: 'COALESCE(AVG(duration_ms), 0)',
  }[metric] || 'COUNT(*)';

  const groupCol = breakdown === 'model' ? ', model' : '';
  const selectCols = breakdown === 'model' ? ', model' : '';

  const { results } = await db.prepare(
    `SELECT strftime(?, timestamp) AS ts, ${metricSql} AS value${selectCols}
     FROM logs
     WHERE timestamp >= ?
     GROUP BY ts${groupCol}
     ORDER BY ts ASC`
  ).bind(bucketFmt, cutoff).all();

  // Build full bucket list (fill missing with 0)
  const bucketsMap = new Map();
  const bucketCount = Math.ceil(hours / (bucketSeconds / 3600));
  for (let i = bucketCount - 1; i >= 0; i--) {
    const t = new Date(now - i * bucketSeconds * 1000);
    if (granularity === 'hour') t.setMinutes(0, 0, 0);
    else t.setHours(0, 0, 0, 0);
    const key = t.toISOString().replace(/\.\d{3}Z$/, 'Z');
    bucketsMap.set(key, { ts: key, value: 0, breakdown: breakdown ? {} : undefined });
  }

  for (const row of results) {
    const key = row.ts;
    if (!bucketsMap.has(key)) bucketsMap.set(key, { ts: key, value: 0, breakdown: breakdown ? {} : undefined });
    const b = bucketsMap.get(key);
    b.value += row.value;
    if (breakdown === 'model' && row.model) {
      b.breakdown[row.model] = (b.breakdown[row.model] || 0) + row.value;
    }
  }

  return { buckets: [...bucketsMap.values()].sort((a, b) => a.ts.localeCompare(b.ts)) };
}
