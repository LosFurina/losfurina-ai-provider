import { sendTelegramMessage } from '../telegram.js';

const DEDUP_WINDOW_MS = 5 * 60 * 1000;

export function evaluateRule(rule, { logEntry = {}, snapshot = {} }) {
  if (!rule.enabled) return { triggered: false };

  let actualValue = null;
  let context = {};

  switch (rule.metric) {
    case 'request_cost':
      actualValue = logEntry.costUsd ?? 0;
      context = { model: logEntry.model, path: logEntry.path };
      break;
    case 'latency_ms':
      actualValue = logEntry.durationMs ?? 0;
      context = { model: logEntry.model };
      break;
    case 'error_rate':
      actualValue = snapshot.errorRate ?? 0;
      context = { window_min: rule.window_min };
      break;
    case 'daily_cost':
      actualValue = snapshot.dailyCost ?? 0;
      break;
    case 'provider_unhealthy':
      if (snapshot.providerUnhealthyName) {
        return { triggered: true, actualValue: 1, context: { provider: snapshot.providerUnhealthyName } };
      }
      return { triggered: false };
    default:
      return { triggered: false };
  }

  const cmp = rule.operator === 'gt' ? actualValue > rule.threshold : actualValue < rule.threshold;
  return cmp ? { triggered: true, actualValue, context } : { triggered: false };
}

export async function buildSnapshot(db, rule, now = Date.now()) {
  if (rule.metric === 'error_rate') {
    const cutoff = new Date(now - (rule.window_min || 10) * 60 * 1000).toISOString();
    const row = await db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors
       FROM logs WHERE timestamp >= ?`
    ).bind(cutoff).first();
    const total = row?.total || 0;
    return { errorRate: total > 0 ? (row.errors || 0) / total : 0 };
  }
  if (rule.metric === 'daily_cost') {
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const row = await db.prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS dailyCost FROM logs WHERE timestamp >= ?`
    ).bind(dayStart.toISOString()).first();
    return { dailyCost: row?.dailyCost || 0 };
  }
  return {};
}

export async function processLogForAlerts(db, config, logEntry) {
  const { results: rules } = await db.prepare(
    'SELECT * FROM alert_rules WHERE enabled = 1'
  ).all();
  if (!rules.length) return;

  for (const rule of rules) {
    const snapshot = await buildSnapshot(db, rule);
    const verdict = evaluateRule(rule, { logEntry, snapshot });
    if (!verdict.triggered) continue;
    await triggerAlert(db, config, rule, verdict);
  }
}

export async function processProviderHealthForAlerts(db, config, { providerName, status }) {
  if (status !== 'unhealthy') return;
  const { results: rules } = await db.prepare(
    `SELECT * FROM alert_rules WHERE enabled = 1 AND metric = 'provider_unhealthy'`
  ).all();
  for (const rule of rules) {
    const verdict = evaluateRule(rule, { snapshot: { providerUnhealthyName: providerName } });
    if (verdict.triggered) {
      await triggerAlert(db, config, rule, verdict);
    }
  }
}

async function triggerAlert(db, config, rule, verdict) {
  const dedupCutoff = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
  const recent = await db.prepare(
    `SELECT id FROM alert_triggers WHERE rule_id = ? AND triggered_at >= ? LIMIT 1`
  ).bind(rule.id, dedupCutoff).first();
  if (recent) return;

  const triggeredAt = new Date().toISOString();
  const contextJson = JSON.stringify(verdict.context || {});

  await db.prepare(
    `INSERT INTO alert_triggers (rule_id, triggered_at, actual_value, context, acknowledged)
     VALUES (?, ?, ?, ?, 0)`
  ).bind(rule.id, triggeredAt, verdict.actualValue, contextJson).run();

  if (rule.action === 'telegram' || rule.action === 'both') {
    const msg = formatAlertMessage(rule, verdict, triggeredAt);
    try { await sendTelegramMessage(config, msg); } catch (e) { console.error('telegram alert failed', e.message); }
  }
}

function formatAlertMessage(rule, verdict, triggeredAt) {
  return `🚨 *Alert: ${rule.name}*
metric: \`${rule.metric}\` ${rule.operator} ${rule.threshold}
actual: \`${verdict.actualValue}\`
time: ${triggeredAt}
context: \`${JSON.stringify(verdict.context || {})}\``;
}
