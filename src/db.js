/**
 * D1 database operations for log persistence.
 */
export async function insertLog(db, logEntry) {
  const { timestamp, model, method, path, status, durationMs, promptTokens, completionTokens, totalTokens, requestSummary, responseSummary } = logEntry;
  await db.prepare(
    `INSERT INTO logs (timestamp, model, method, path, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, request_summary, response_summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(timestamp, model, method, path, status, durationMs, promptTokens, completionTokens, totalTokens, requestSummary, responseSummary).run();
}

export async function queryLogs(db, { hours = 24, limit = 50, offset = 0 } = {}) {
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { results } = await db.prepare(
    `SELECT * FROM logs WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`
  ).bind(cutoff, limit, offset).all();
  return results;
}

export async function queryStats(db, { hours = 24 } = {}) {
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { results } = await db.prepare(
    `SELECT
       model,
       COUNT(*) as request_count,
       SUM(total_tokens) as total_tokens,
       SUM(prompt_tokens) as prompt_tokens,
       SUM(completion_tokens) as completion_tokens,
       ROUND(AVG(duration_ms), 1) as avg_duration_ms
     FROM logs
     WHERE timestamp >= ?
     GROUP BY model
     ORDER BY request_count DESC`
  ).bind(cutoff).all();
  return results;
}
