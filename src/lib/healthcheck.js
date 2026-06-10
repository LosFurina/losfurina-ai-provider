import { invalidateCache } from './router.js';
import { getConfig } from '../config.js';
import { processProviderHealthForAlerts } from './alerts.js';

export function judgeStatus(httpStatus, models) {
  if (httpStatus < 200 || httpStatus >= 300) return 'unhealthy';
  if (!Array.isArray(models) || models.length === 0) return 'degraded';
  return 'healthy';
}

export function parseModelsResponse(text) {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed?.data)) {
      return parsed.data.map(m => m.id).filter(Boolean);
    }
  } catch {}
  return [];
}

export async function probeOne(provider) {
  const start = Date.now();
  let httpStatus = 0;
  let bodyText = '';
  let error = null;

  try {
    const url = provider.base_url.replace(/\/$/, '') + '/models';
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${provider.api_key}` },
      signal: AbortSignal.timeout(10000),
    });
    httpStatus = res.status;
    bodyText = await res.text();
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = e.message || String(e);
  }

  const latency = Date.now() - start;
  const models = httpStatus === 200 ? parseModelsResponse(bodyText) : [];
  const status = judgeStatus(httpStatus, models);

  return {
    status,
    latencyMs: latency,
    httpStatus,
    models,
    error,
    checkedAt: new Date().toISOString(),
  };
}

export async function probeAllProviders(env, ctx) {
  const { results: providers } = await env.DB.prepare(
    `SELECT id, name, base_url, api_key, health_status AS previous_status FROM providers WHERE enabled = 1`
  ).all();
  if (!providers.length) return;

  const results = await Promise.all(providers.map(async p => {
    const probe = await probeOne(p);
    return { provider: p, probe };
  }));

  const stmts = [];
  for (const { provider, probe } of results) {
    stmts.push(
      env.DB.prepare(
        `UPDATE providers
         SET health_status = ?, last_latency_ms = ?, last_checked_at = ?,
             last_error = ?, models = ?, updated_at = ?
         WHERE id = ?`
      ).bind(
        probe.status,
        probe.latencyMs,
        probe.checkedAt,
        probe.error,
        JSON.stringify(probe.models),
        probe.checkedAt,
        provider.id
      )
    );
    stmts.push(
      env.DB.prepare(
        `INSERT INTO provider_health_logs
           (provider_id, checked_at, status, latency_ms, http_status, model_count, error)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        provider.id, probe.checkedAt, probe.status, probe.latencyMs,
        probe.httpStatus, probe.models.length, probe.error
      )
    );
  }
  await env.DB.batch(stmts);
  invalidateCache();

  // Fire alerts when status transitions to unhealthy
  const config = getConfig(env);
  for (const { provider, probe } of results) {
    if (provider.previous_status !== 'unhealthy' && probe.status === 'unhealthy') {
      await processProviderHealthForAlerts(env.DB, config, {
        providerName: provider.name,
        status: 'unhealthy',
      });
    }
  }
}

export async function purgeOldHealthLogs(env, daysToKeep = 7) {
  const cutoff = new Date(Date.now() - daysToKeep * 86400 * 1000).toISOString();
  await env.DB.prepare(`DELETE FROM provider_health_logs WHERE checked_at < ?`).bind(cutoff).run();
}
