# Phase 4: Playground + Settings + Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Playground page (in-browser request tester routed via existing proxy), the Settings page (model pricing + alert rules), and the alerting system (evaluation hooks after every log write, Telegram + page-banner delivery, dedup throttle, `provider_unhealthy` alert type).

**Architecture:** Playground reuses the proxy by calling a new `/api/playground` endpoint that delegates to the same `resolveProvider` lookup; results are logged with `source='playground'`. Settings reads/writes new `pricing` and `alert_rules` tables. Alerts evaluator runs in `ctx.waitUntil` after every `insertLog`; the new `/api/poll` endpoint returns new logs + unacknowledged alerts so the SPA can update both with one request.

**Tech Stack:** Cloudflare Workers, D1, vitest, vanilla DOM.

**Spec reference:** `docs/superpowers/specs/2026-06-10-dashboard-v2-design.md` sections 5.4, 5.6, 6.1, 7.2, 7.3, 7.4, 8, 9.5, 10.

**Prerequisite:** Phases 1-3 complete (router, providers, all base pages except Playground/Settings).

---

### Task 1: Add pricing + alert_rules + alert_triggers schema

**Files:**
- Create: `migrations/0004_pricing_alerts.sql`
- Modify: `schema.sql`

- [ ] **Step 1: Create migration**

```sql
-- migrations/0004_pricing_alerts.sql
CREATE TABLE IF NOT EXISTS pricing (
  model              TEXT PRIMARY KEY,
  prompt_per_1k      REAL NOT NULL,
  completion_per_1k  REAL NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  metric       TEXT NOT NULL,
  operator     TEXT NOT NULL,
  threshold    REAL NOT NULL,
  window_min   INTEGER DEFAULT 10,
  action       TEXT NOT NULL,
  enabled      INTEGER DEFAULT 1,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_triggers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id      INTEGER NOT NULL,
  triggered_at TEXT NOT NULL,
  actual_value REAL NOT NULL,
  context      TEXT,
  acknowledged INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_alert_triggers_unack
  ON alert_triggers(acknowledged, triggered_at);

-- Default pricing for common models (USD per 1K tokens, OpenRouter reference)
INSERT OR IGNORE INTO pricing (model, prompt_per_1k, completion_per_1k, updated_at) VALUES
  ('gpt-4o',                0.0025,  0.010, datetime('now')),
  ('gpt-4o-mini',           0.00015, 0.0006, datetime('now')),
  ('claude-4',              0.003,   0.015,  datetime('now')),
  ('claude-3-5-sonnet',     0.003,   0.015,  datetime('now')),
  ('deepseek-v3',           0.00027, 0.0011, datetime('now'));
```

- [ ] **Step 2: Append to schema.sql for fresh installs**

Add the same CREATE TABLE / INSERT statements to the end of `schema.sql`.

- [ ] **Step 3: Apply migration**

Run:
```bash
wrangler d1 execute losfurina-logs --local --file=./migrations/0004_pricing_alerts.sql
wrangler d1 execute losfurina-logs --file=./migrations/0004_pricing_alerts.sql
```

- [ ] **Step 4: Commit**

```bash
git add migrations/0004_pricing_alerts.sql schema.sql
git commit -m "feat(db): pricing + alert_rules + alert_triggers tables with seed pricing"
```

---

### Task 2: Implement pricing calculation (TDD)

**Files:**
- Create: `tests/pricing.test.js`
- Create: `src/lib/pricing.js`
- Modify: `src/routes/proxy.js`

- [ ] **Step 1: Write failing test**

```javascript
// tests/pricing.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { calculateCost, getPricing } from '../src/lib/pricing.js';

async function seedPricing(db) {
  await db.exec('DELETE FROM pricing');
  await db.prepare(
    'INSERT INTO pricing (model, prompt_per_1k, completion_per_1k, updated_at) VALUES (?, ?, ?, datetime("now"))'
  ).bind('gpt-4o', 0.0025, 0.010).run();
}

describe('calculateCost', () => {
  beforeEach(async () => { await seedPricing(env.DB); });

  it('returns 0 for unknown model', async () => {
    const cost = await calculateCost(env.DB, 'unknown-model', 1000, 500);
    expect(cost).toBe(0);
  });

  it('calculates cost correctly for known model', async () => {
    const cost = await calculateCost(env.DB, 'gpt-4o', 1000, 500);
    // 1000/1000 * 0.0025 + 500/1000 * 0.010 = 0.0025 + 0.005 = 0.0075
    expect(cost).toBeCloseTo(0.0075, 6);
  });

  it('returns 0 when token counts are 0', async () => {
    const cost = await calculateCost(env.DB, 'gpt-4o', 0, 0);
    expect(cost).toBe(0);
  });
});
```

- [ ] **Step 2: Confirm failure**

Run: `npm test -- pricing`

- [ ] **Step 3: Implement src/lib/pricing.js**

```javascript
// src/lib/pricing.js
let pricingCache = null;
let pricingCacheExpiry = 0;
const CACHE_TTL_MS = 60 * 1000;

export function invalidatePricingCache() {
  pricingCache = null;
  pricingCacheExpiry = 0;
}

export async function getPricing(db) {
  const now = Date.now();
  if (pricingCache && now < pricingCacheExpiry) return pricingCache;
  const { results } = await db.prepare('SELECT * FROM pricing').all();
  pricingCache = new Map(results.map(r => [r.model, r]));
  pricingCacheExpiry = now + CACHE_TTL_MS;
  return pricingCache;
}

export async function calculateCost(db, model, promptTokens, completionTokens) {
  const pricing = await getPricing(db);
  const p = pricing.get(model);
  if (!p) return 0;
  return (promptTokens / 1000) * p.prompt_per_1k + (completionTokens / 1000) * p.completion_per_1k;
}
```

- [ ] **Step 4: Wire calculation into src/routes/proxy.js**

Inside `handleProxy`, before building `logEntry`:

```javascript
import { calculateCost } from '../lib/pricing.js';

// after extracting promptTokens / completionTokens / totalTokens:
const costUsd = await calculateCost(env.DB, model, promptTokens, completionTokens);
```

And in the logEntry object, replace `costUsd: 0,` with `costUsd,`.

- [ ] **Step 5: Verify tests pass**

Run: `npm test -- pricing`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/pricing.test.js src/lib/pricing.js src/routes/proxy.js
git commit -m "feat(pricing): per-model cost calculation with 60s cache"
```

---

### Task 3: Implement alert evaluator (TDD pure logic)

**Files:**
- Create: `tests/alerts.test.js`
- Create: `src/lib/alerts.js`

- [ ] **Step 1: Write failing test for rule matching logic**

```javascript
// tests/alerts.test.js
import { describe, it, expect } from 'vitest';
import { evaluateRule } from '../src/lib/alerts.js';

describe('evaluateRule', () => {
  const baseRule = (overrides) => ({
    id: 1, name: 'test', metric: 'request_cost', operator: 'gt',
    threshold: 0.5, window_min: 10, action: 'telegram', enabled: 1,
    ...overrides,
  });

  it('triggers when request_cost > threshold', () => {
    const r = evaluateRule(baseRule({ metric: 'request_cost', threshold: 0.10 }), {
      logEntry: { costUsd: 0.15 }, snapshot: {},
    });
    expect(r.triggered).toBe(true);
    expect(r.actualValue).toBe(0.15);
  });

  it('does not trigger when below threshold', () => {
    const r = evaluateRule(baseRule({ metric: 'request_cost', threshold: 0.10 }), {
      logEntry: { costUsd: 0.05 }, snapshot: {},
    });
    expect(r.triggered).toBe(false);
  });

  it('triggers latency_ms based on logEntry.durationMs', () => {
    const r = evaluateRule(baseRule({ metric: 'latency_ms', threshold: 5000 }), {
      logEntry: { durationMs: 7000 }, snapshot: {},
    });
    expect(r.triggered).toBe(true);
  });

  it('uses snapshot.errorRate for error_rate metric', () => {
    const r = evaluateRule(baseRule({ metric: 'error_rate', threshold: 0.05 }), {
      logEntry: {}, snapshot: { errorRate: 0.12 },
    });
    expect(r.triggered).toBe(true);
    expect(r.actualValue).toBeCloseTo(0.12);
  });

  it('uses snapshot.dailyCost for daily_cost metric', () => {
    const r = evaluateRule(baseRule({ metric: 'daily_cost', threshold: 10 }), {
      logEntry: {}, snapshot: { dailyCost: 12.34 },
    });
    expect(r.triggered).toBe(true);
  });

  it('uses snapshot.providerUnhealthyName for provider_unhealthy', () => {
    const r = evaluateRule(baseRule({ metric: 'provider_unhealthy', operator: 'gt', threshold: 0 }), {
      logEntry: {}, snapshot: { providerUnhealthyName: 'OpenAI' },
    });
    expect(r.triggered).toBe(true);
    expect(r.context.provider).toBe('OpenAI');
  });

  it('returns triggered=false when rule is disabled', () => {
    const r = evaluateRule(baseRule({ enabled: 0 }), {
      logEntry: { costUsd: 100 }, snapshot: {},
    });
    expect(r.triggered).toBe(false);
  });
});
```

- [ ] **Step 2: Confirm failure**

Run: `npm test -- alerts`

- [ ] **Step 3: Create src/lib/alerts.js**

```javascript
// src/lib/alerts.js
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
  // Dedup: skip if same rule triggered in last 5 min
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
  // 'banner' action is purely a flag for the frontend (read via /api/poll)
}

function formatAlertMessage(rule, verdict, triggeredAt) {
  return `🚨 *Alert: ${rule.name}*
metric: \`${rule.metric}\` ${rule.operator} ${rule.threshold}
actual: \`${verdict.actualValue}\`
time: ${triggeredAt}
context: \`${JSON.stringify(verdict.context || {})}\``;
}
```

- [ ] **Step 4: Verify pure-logic tests pass**

Run: `npm test -- alerts`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/alerts.test.js src/lib/alerts.js
git commit -m "feat(alerts): rule evaluator + dedup-throttled trigger + telegram delivery"
```

---

### Task 4: Wire alerts into proxy + healthcheck

**Files:**
- Modify: `src/routes/proxy.js`
- Modify: `src/lib/healthcheck.js`

- [ ] **Step 1: Call processLogForAlerts in proxy.js**

Modify the `ctx.waitUntil` block to also process alerts:

```javascript
import { processLogForAlerts } from '../lib/alerts.js';

// existing waitUntil block, expand to:
ctx.waitUntil(
  insertLog(env.DB, logEntry)
    .then(() => processLogForAlerts(env.DB, config, logEntry))
    .catch(err => console.error('alert chain error:', err.message))
);
```

- [ ] **Step 2: Call processProviderHealthForAlerts after each probe transition**

In `src/lib/healthcheck.js`, modify `probeAllProviders`:

```javascript
import { getConfig } from '../config.js';
import { processProviderHealthForAlerts } from './alerts.js';

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
    stmts.push(/* UPDATE statement, same as before */);
    stmts.push(/* INSERT into provider_health_logs, same as before */);
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
```

(Keep the existing UPDATE / INSERT statement bodies; only restructure as shown.)

- [ ] **Step 3: Verify nothing breaks**

Run: `npm test`
Expected: all tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/routes/proxy.js src/lib/healthcheck.js
git commit -m "feat(alerts): wire evaluator into proxy + provider unhealthy transitions"
```

---

### Task 5: Add /api/admin/* admin endpoints

**Files:**
- Create: `src/routes/api-admin.js`
- Modify: `src/index.js`

- [ ] **Step 1: Create src/routes/api-admin.js**

```javascript
// src/routes/api-admin.js
import { invalidatePricingCache } from '../lib/pricing.js';

export async function handleAdminApi(request, env) {
  const url = new URL(request.url);
  const method = request.method;

  // /api/admin/pricing
  if (url.pathname === '/api/admin/pricing' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM pricing ORDER BY model').all();
    return json(results);
  }
  if (url.pathname === '/api/admin/pricing' && method === 'PUT') {
    const body = await request.json();
    const { model, prompt_per_1k, completion_per_1k } = body;
    if (!model || typeof prompt_per_1k !== 'number' || typeof completion_per_1k !== 'number') {
      return json({ error: 'invalid_body' }, 400);
    }
    await env.DB.prepare(
      `INSERT INTO pricing (model, prompt_per_1k, completion_per_1k, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(model) DO UPDATE SET
         prompt_per_1k = excluded.prompt_per_1k,
         completion_per_1k = excluded.completion_per_1k,
         updated_at = excluded.updated_at`
    ).bind(model, prompt_per_1k, completion_per_1k).run();
    invalidatePricingCache();
    return json({ ok: true });
  }
  if (url.pathname.match(/^\/api\/admin\/pricing\/[^/]+$/) && method === 'DELETE') {
    const model = decodeURIComponent(url.pathname.split('/').pop());
    await env.DB.prepare('DELETE FROM pricing WHERE model = ?').bind(model).run();
    invalidatePricingCache();
    return json({ ok: true });
  }

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
```

- [ ] **Step 2: Wire up in src/index.js**

Add before the providers dispatch:

```javascript
import { handleAdminApi } from './routes/api-admin.js';

if (url.pathname.startsWith('/api/admin/')) {
  return handleAdminApi(request, env);
}
```

- [ ] **Step 3: Smoke test**

```bash
curl http://localhost:8787/api/admin/pricing -H "Authorization: Bearer <key>"
# Expected: pricing list

curl -X PUT http://localhost:8787/api/admin/pricing -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d '{"model":"test-model","prompt_per_1k":0.001,"completion_per_1k":0.002}'
# Expected: {"ok":true}
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/api-admin.js src/index.js
git commit -m "feat(api): /api/admin/pricing + /api/admin/alerts CRUD"
```

---

### Task 6: Add /api/poll combined polling endpoint

**Files:**
- Modify: `src/routes/api-logs.js`

- [ ] **Step 1: Add /api/poll handler in api-logs.js**

Add at top of `handleLogsApi`:

```javascript
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
```

- [ ] **Step 2: Update Logs page polling to use /api/poll**

Modify `public/pages/logs.js` polling block:

```javascript
state.pollTimer = setInterval(async () => {
  try {
    const data = await api('/api/poll' + (state.lastFetch ? `?since=${encodeURIComponent(new Date(state.lastFetch).toISOString())}` : ''));
    if (data.logs && data.logs.length) {
      // Re-fetch full filtered list to apply user's filters consistently
      doFetch();
    }
    renderAlertBanner(data.alerts);
  } catch (e) { /* silent */ }
}, 30000);

// (Add renderAlertBanner stub — full implementation in Task 9)
function renderAlertBanner(alerts) { /* implemented in Task 9 */ }
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/api-logs.js public/pages/logs.js
git commit -m "feat(api): /api/poll returns new logs + unacknowledged alerts in one call"
```

---

### Task 7: Build Playground page

**Files:**
- Create: `public/pages/playground.js`
- Create: `src/routes/api-playground.js`
- Modify: `src/index.js`
- Modify: `public/app.js`
- Modify: `public/components/sidebar.js`

- [ ] **Step 1: Create api-playground.js**

```javascript
// src/routes/api-playground.js
import { handleProxy } from './proxy.js';

export async function handlePlayground(request, config, env, ctx) {
  // Build a fake /v1/chat/completions request from the playground payload,
  // then delegate to the standard proxy. Mark as playground source via header.
  const body = await request.text();
  const fakeUrl = new URL(request.url);
  fakeUrl.pathname = '/v1/chat/completions';
  const fakeReq = new Request(fakeUrl.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Playground': '1' },
    body,
  });
  return handleProxy(fakeReq, config, env, ctx);
}
```

Then in `proxy.js`, when building `logEntry`, set `source` based on header:

```javascript
source: request.headers.get('X-Playground') ? 'playground' : 'proxy',
```

- [ ] **Step 2: Wire /api/playground in src/index.js**

```javascript
import { handlePlayground } from './routes/api-playground.js';

if (url.pathname === '/api/playground' && request.method === 'POST') {
  return handlePlayground(request, config, env, ctx);
}
```

- [ ] **Step 3: Create public/pages/playground.js**

```javascript
// public/pages/playground.js
import { api } from '/lib/api.js';

const state = {
  model: '',
  maxTokens: 4096,
  temperature: 0.7,
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: '' },
  ],
  response: null,
  loading: false,
  showRaw: false,
};

let availableModels = [];

export function renderPlayground(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Playground</div>
        <div class="page-subtitle">通过网关测试模型（注意：真实调用，会产生费用）</div>
      </div>
    </div>
    <div style="flex:1;display:flex;overflow:hidden">
      <div style="flex:1;border-right:1px solid var(--border-subtle);display:flex;flex-direction:column">
        <div style="padding:12px 20px;border-bottom:1px solid var(--border-subtle);display:flex;gap:10px;align-items:center">
          <select class="filter-chip" id="pg-model" style="min-width:160px"></select>
          <label style="font-size:11px;color:var(--text-secondary)">max_tokens
            <input id="pg-max" type="number" value="${state.maxTokens}" style="width:80px;background:var(--bg-overlay);border:1px solid var(--border-default);color:var(--text-primary);padding:4px 6px;border-radius:4px;margin-left:4px"/>
          </label>
          <label style="font-size:11px;color:var(--text-secondary)">temp
            <input id="pg-temp" type="number" step="0.1" min="0" max="2" value="${state.temperature}" style="width:60px;background:var(--bg-overlay);border:1px solid var(--border-default);color:var(--text-primary);padding:4px 6px;border-radius:4px;margin-left:4px"/>
          </label>
          <button class="filter-chip" id="pg-send" style="margin-left:auto;background:var(--accent-blue);color:white;padding:6px 14px">▶ 发送</button>
        </div>
        <div style="flex:1;padding:16px 20px;overflow-y:auto" id="pg-messages"></div>
        <div style="padding:10px 20px;border-top:1px solid var(--border-subtle)">
          <button class="filter-chip" id="pg-add-msg">+ 添加消息</button>
        </div>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;background:#0c0e14">
        <div style="padding:12px 20px;border-bottom:1px solid var(--border-subtle);font-size:11px;color:var(--text-tertiary)" id="pg-resp-meta">尚未发送请求</div>
        <div style="flex:1;padding:16px 20px;overflow-y:auto" id="pg-response"></div>
        <div style="padding:10px 20px;border-top:1px solid var(--border-subtle);display:flex;gap:12px;font-size:11px">
          <span id="pg-toggle-rendered" style="color:var(--accent-blue);cursor:pointer;border-bottom:1px solid var(--accent-blue)">渲染</span>
          <span id="pg-toggle-raw" style="color:var(--text-tertiary);cursor:pointer">原始 JSON</span>
          <span id="pg-copy" style="margin-left:auto;color:var(--text-tertiary);cursor:pointer">复制响应</span>
        </div>
      </div>
    </div>
  `;
  loadModels(container);
  renderMessages();
  bindEvents(container);
}

async function loadModels(container) {
  try {
    const data = await api('/v1/models');
    availableModels = (data.data || []).map(m => m.id);
    const sel = container.querySelector('#pg-model');
    sel.innerHTML = availableModels.map(m => `<option value="${m}">${m}</option>`).join('');
    if (availableModels[0]) state.model = availableModels[0];
  } catch (e) {
    console.error('failed to load models', e);
  }
}

function bindEvents(container) {
  container.querySelector('#pg-model').onchange = e => state.model = e.target.value;
  container.querySelector('#pg-max').oninput = e => state.maxTokens = parseInt(e.target.value, 10) || 4096;
  container.querySelector('#pg-temp').oninput = e => state.temperature = parseFloat(e.target.value) || 0.7;
  container.querySelector('#pg-add-msg').onclick = () => {
    state.messages.push({ role: 'user', content: '' });
    renderMessages();
  };
  container.querySelector('#pg-send').onclick = () => send(container);
  container.querySelector('#pg-toggle-rendered').onclick = () => { state.showRaw = false; renderResponse(); };
  container.querySelector('#pg-toggle-raw').onclick = () => { state.showRaw = true; renderResponse(); };
  container.querySelector('#pg-copy').onclick = () => {
    navigator.clipboard.writeText(JSON.stringify(state.response, null, 2));
  };
}

function renderMessages() {
  const el = document.getElementById('pg-messages');
  el.innerHTML = state.messages.map((m, i) => `
    <div style="margin-bottom:12px">
      <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:6px;display:flex;gap:6px;align-items:center">
        <select data-i="${i}" class="msg-role" style="background:var(--bg-overlay);color:var(--text-secondary);border:1px solid var(--border-default);padding:1px 6px;border-radius:3px;font-size:10px">
          <option value="system" ${m.role === 'system' ? 'selected' : ''}>system</option>
          <option value="user" ${m.role === 'user' ? 'selected' : ''}>user</option>
          <option value="assistant" ${m.role === 'assistant' ? 'selected' : ''}>assistant</option>
        </select>
        <span style="margin-left:auto;cursor:pointer;color:var(--accent-red)" data-del="${i}">×</span>
      </div>
      <textarea data-i="${i}" class="msg-content" style="width:100%;min-height:60px;background:var(--bg-elevated);border:1px solid var(--border-subtle);color:var(--text-primary);padding:10px;border-radius:6px;font-family:var(--font-mono);font-size:11px;resize:vertical">${escapeHtml(m.content)}</textarea>
    </div>
  `).join('');
  el.querySelectorAll('.msg-role').forEach(s => s.onchange = e => state.messages[parseInt(s.dataset.i, 10)].role = e.target.value);
  el.querySelectorAll('.msg-content').forEach(t => t.oninput = e => state.messages[parseInt(t.dataset.i, 10)].content = e.target.value);
  el.querySelectorAll('[data-del]').forEach(x => x.onclick = () => {
    const i = parseInt(x.dataset.del, 10);
    state.messages.splice(i, 1);
    renderMessages();
  });
}

async function send(container) {
  if (!state.model) { alert('请选择模型'); return; }
  state.loading = true;
  document.getElementById('pg-resp-meta').textContent = '发送中...';
  document.getElementById('pg-response').innerHTML = '<div style="color:var(--text-tertiary);text-align:center;padding:40px">⏳ 等待响应...</div>';
  const t0 = Date.now();
  try {
    const data = await api('/api/playground', {
      method: 'POST',
      body: JSON.stringify({
        model: state.model,
        max_tokens: state.maxTokens,
        temperature: state.temperature,
        messages: state.messages.filter(m => m.content.trim()),
      }),
    });
    const dt = Date.now() - t0;
    const usage = data.usage || {};
    state.response = data;
    document.getElementById('pg-resp-meta').innerHTML = `
      延迟: <span style="color:var(--accent-green)">${dt}ms</span> ·
      Tokens: <span style="color:var(--text-primary)">${usage.prompt_tokens || 0} + ${usage.completion_tokens || 0} = ${usage.total_tokens || 0}</span>
    `;
    renderResponse();
  } catch (e) {
    document.getElementById('pg-response').innerHTML = `<div style="color:var(--accent-red);padding:20px">${e.message}</div>`;
  } finally {
    state.loading = false;
  }
}

function renderResponse() {
  const el = document.getElementById('pg-response');
  if (!state.response) return;
  if (state.showRaw) {
    el.innerHTML = `<pre style="margin:0;font-family:var(--font-mono);font-size:11px;color:var(--text-primary);white-space:pre-wrap;word-break:break-word">${escapeHtml(JSON.stringify(state.response, null, 2))}</pre>`;
  } else {
    const content = state.response.choices?.[0]?.message?.content || '(空响应)';
    el.innerHTML = `<div style="font-size:13px;line-height:1.7;color:var(--text-primary);white-space:pre-wrap">${escapeHtml(content)}</div>`;
  }
  // Toggle styles
  document.getElementById('pg-toggle-rendered').style.cssText = state.showRaw
    ? 'color:var(--text-tertiary);cursor:pointer'
    : 'color:var(--accent-blue);cursor:pointer;border-bottom:1px solid var(--accent-blue)';
  document.getElementById('pg-toggle-raw').style.cssText = state.showRaw
    ? 'color:var(--accent-blue);cursor:pointer;border-bottom:1px solid var(--accent-blue)'
    : 'color:var(--text-tertiary);cursor:pointer';
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 4: Register Playground route + enable sidebar entry**

In `public/app.js`:
```javascript
import { renderPlayground } from '/pages/playground.js';
registerRoute('/playground', (c) => renderPlayground(c));
```

In `public/components/sidebar.js`, change:
```javascript
{ path: '/playground', icon: '🧪', label: 'Playground' },
```

- [ ] **Step 5: Smoke test**

Run: `npm run dev`
1. Open Playground page
2. Verify model dropdown populates from `/v1/models`
3. Enter a user message, click 发送
4. Verify response renders, latency + tokens shown
5. Toggle 渲染 / 原始 JSON
6. Verify the request appears in Logs page with `source=playground`

- [ ] **Step 6: Commit**

```bash
git add src/routes/api-playground.js src/routes/proxy.js src/index.js public/pages/playground.js public/app.js public/components/sidebar.js
git commit -m "feat(ui): Playground page tests requests via /api/playground"
```

---

### Task 8: Build Settings page

**Files:**
- Create: `public/pages/settings.js`
- Modify: `public/app.js`
- Modify: `public/components/sidebar.js`

- [ ] **Step 1: Create public/pages/settings.js**

```javascript
// public/pages/settings.js
import { api } from '/lib/api.js';

const state = { tab: 'pricing' };

export function renderSettings(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Settings</div>
        <div class="page-subtitle">模型单价 · 告警规则</div>
      </div>
    </div>
    <div style="padding:16px 24px;border-bottom:1px solid var(--border-subtle);display:flex;gap:8px">
      <button class="filter-chip ${state.tab === 'pricing' ? 'active' : ''}" data-tab="pricing">模型单价</button>
      <button class="filter-chip ${state.tab === 'alerts' ? 'active' : ''}" data-tab="alerts">告警规则</button>
      <button class="filter-chip ${state.tab === 'triggered' ? 'active' : ''}" data-tab="triggered">触发记录</button>
    </div>
    <div class="page-body" id="settings-body"></div>
  `;
  container.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    state.tab = b.dataset.tab;
    renderSettings(container);
  });
  loadTab();
}

async function loadTab() {
  const body = document.getElementById('settings-body');
  if (state.tab === 'pricing') return renderPricing(body);
  if (state.tab === 'alerts') return renderAlerts(body);
  if (state.tab === 'triggered') return renderTriggered(body);
}

async function renderPricing(body) {
  const rows = await api('/api/admin/pricing');
  body.innerHTML = `
    <div class="card">
      <div style="display:grid;grid-template-columns:1fr 140px 140px 60px;padding:8px 0;font-size:10px;color:var(--text-tertiary);text-transform:uppercase;border-bottom:1px solid var(--border-subtle)">
        <span>Model</span><span>Prompt $/1K</span><span>Completion $/1K</span><span></span>
      </div>
      ${rows.map(r => `
        <div style="display:grid;grid-template-columns:1fr 140px 140px 60px;padding:10px 0;border-bottom:1px solid var(--border-subtle);align-items:center;font-size:12px">
          <span class="mono">${r.model}</span>
          <span class="mono">$${r.prompt_per_1k}</span>
          <span class="mono">$${r.completion_per_1k}</span>
          <span style="cursor:pointer;color:var(--accent-red);text-align:right" data-del="${r.model}">删除</span>
        </div>
      `).join('')}
      <div style="display:grid;grid-template-columns:1fr 140px 140px 60px;padding:10px 0;align-items:center;gap:8px">
        <input id="new-model" placeholder="模型名" style="background:var(--bg-overlay);border:1px solid var(--border-default);color:var(--text-primary);padding:6px;border-radius:4px;font-size:12px">
        <input id="new-prompt" type="number" step="0.0001" placeholder="0.0025" style="background:var(--bg-overlay);border:1px solid var(--border-default);color:var(--text-primary);padding:6px;border-radius:4px;font-size:12px">
        <input id="new-completion" type="number" step="0.0001" placeholder="0.010" style="background:var(--bg-overlay);border:1px solid var(--border-default);color:var(--text-primary);padding:6px;border-radius:4px;font-size:12px">
        <button class="filter-chip" id="add-pricing" style="background:var(--accent-blue);color:white">添加</button>
      </div>
    </div>
  `;
  body.querySelectorAll('[data-del]').forEach(el => el.onclick = async () => {
    if (!confirm(`删除 ${el.dataset.del}?`)) return;
    await api('/api/admin/pricing/' + encodeURIComponent(el.dataset.del), { method: 'DELETE' });
    renderPricing(body);
  });
  document.getElementById('add-pricing').onclick = async () => {
    const model = document.getElementById('new-model').value.trim();
    const p = parseFloat(document.getElementById('new-prompt').value);
    const c = parseFloat(document.getElementById('new-completion').value);
    if (!model || isNaN(p) || isNaN(c)) { alert('请填写完整'); return; }
    await api('/api/admin/pricing', { method: 'PUT', body: JSON.stringify({ model, prompt_per_1k: p, completion_per_1k: c }) });
    renderPricing(body);
  };
}

async function renderAlerts(body) {
  const rules = await api('/api/admin/alerts');
  body.innerHTML = `
    <div class="card">
      <div style="font-size:11px;color:var(--text-secondary);margin-bottom:12px">告警规则列表</div>
      ${rules.length === 0 ? '<div style="color:var(--text-tertiary);padding:20px;text-align:center">暂无告警规则</div>' : rules.map(r => `
        <div style="padding:10px 0;border-bottom:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;font-size:12px">
          <div>
            <div><input type="checkbox" data-toggle="${r.id}" ${r.enabled ? 'checked' : ''}> ${r.name}</div>
            <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;font-family:var(--font-mono)">${r.metric} ${r.operator} ${r.threshold}${r.metric === 'error_rate' ? ' (window: ' + r.window_min + 'min)' : ''} → ${r.action}</div>
          </div>
          <span style="cursor:pointer;color:var(--accent-red)" data-del-rule="${r.id}">删除</span>
        </div>
      `).join('')}
    </div>
    <div class="card" style="margin-top:12px">
      <div style="font-size:11px;color:var(--text-secondary);margin-bottom:12px">添加规则</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <input id="ar-name" placeholder="规则名（如 单次费用过高）" class="login-input" style="margin:0;padding:6px 8px;font-size:12px">
        <select id="ar-metric" class="login-input" style="margin:0;padding:6px 8px;font-size:12px">
          <option value="request_cost">单次请求费用</option>
          <option value="latency_ms">单次延迟 (ms)</option>
          <option value="error_rate">错误率 (0-1)</option>
          <option value="daily_cost">日累计费用 ($)</option>
          <option value="provider_unhealthy">Provider 不健康</option>
        </select>
        <select id="ar-operator" class="login-input" style="margin:0;padding:6px 8px;font-size:12px">
          <option value="gt">大于</option>
          <option value="lt">小于</option>
        </select>
        <input id="ar-threshold" type="number" step="0.001" placeholder="阈值" class="login-input" style="margin:0;padding:6px 8px;font-size:12px">
        <input id="ar-window" type="number" placeholder="窗口分钟(error_rate)" value="10" class="login-input" style="margin:0;padding:6px 8px;font-size:12px">
        <select id="ar-action" class="login-input" style="margin:0;padding:6px 8px;font-size:12px">
          <option value="telegram">Telegram</option>
          <option value="banner">页面 Banner</option>
          <option value="both">两者都用</option>
        </select>
      </div>
      <button class="filter-chip" id="ar-add" style="background:var(--accent-blue);color:white;margin-top:12px">添加规则</button>
    </div>
  `;
  body.querySelectorAll('[data-toggle]').forEach(cb => cb.onchange = async () => {
    await api('/api/admin/alerts/' + cb.dataset.toggle, { method: 'PUT', body: JSON.stringify({ enabled: cb.checked ? 1 : 0 }) });
  });
  body.querySelectorAll('[data-del-rule]').forEach(el => el.onclick = async () => {
    if (!confirm('删除该规则?')) return;
    await api('/api/admin/alerts/' + el.dataset.delRule, { method: 'DELETE' });
    renderAlerts(body);
  });
  document.getElementById('ar-add').onclick = async () => {
    const payload = {
      name: document.getElementById('ar-name').value.trim(),
      metric: document.getElementById('ar-metric').value,
      operator: document.getElementById('ar-operator').value,
      threshold: parseFloat(document.getElementById('ar-threshold').value),
      window_min: parseInt(document.getElementById('ar-window').value, 10) || 10,
      action: document.getElementById('ar-action').value,
      enabled: 1,
    };
    if (!payload.name || isNaN(payload.threshold)) { alert('请填写完整'); return; }
    await api('/api/admin/alerts', { method: 'POST', body: JSON.stringify(payload) });
    renderAlerts(body);
  };
}

async function renderTriggered(body) {
  const rows = await api('/api/admin/alerts/triggered');
  body.innerHTML = `
    <div class="card">
      <div style="font-size:11px;color:var(--text-secondary);margin-bottom:12px">最近告警触发记录</div>
      ${rows.length === 0 ? '<div style="color:var(--text-tertiary);padding:20px;text-align:center">无触发记录</div>' : rows.map(r => `
        <div style="padding:10px 0;border-bottom:1px solid var(--border-subtle);font-size:12px">
          <div style="display:flex;justify-content:space-between">
            <span><span style="color:${r.acknowledged ? 'var(--text-tertiary)' : 'var(--accent-red)'}">${r.acknowledged ? '✓' : '●'}</span> ${r.rule_name || '(rule deleted)'}</span>
            <span style="color:var(--text-tertiary);font-size:11px">${new Date(r.triggered_at).toLocaleString('zh-CN')}</span>
          </div>
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary);margin-top:4px">${r.rule_metric || '?'} = ${r.actual_value}; ${r.context || '{}'}</div>
          ${r.acknowledged ? '' : `<button class="filter-chip" data-ack="${r.id}" style="margin-top:6px;font-size:10px">标记已读</button>`}
        </div>
      `).join('')}
    </div>
  `;
  body.querySelectorAll('[data-ack]').forEach(b => b.onclick = async () => {
    await api(`/api/admin/alerts/triggered/${b.dataset.ack}/ack`, { method: 'PUT' });
    renderTriggered(body);
  });
}
```

- [ ] **Step 2: Register Settings route + sidebar link**

In `public/app.js`:
```javascript
import { renderSettings } from '/pages/settings.js';
registerRoute('/settings', (c) => renderSettings(c));
```

In `public/components/sidebar.js`, update the Settings footer link's onclick to navigate via hash (it already uses `#/settings`, just verify it renders).

- [ ] **Step 3: Smoke test**

Run: `npm run dev`
1. Navigate to Settings → 模型单价 — verify list loads, add a model
2. 告警规则 tab — add a rule (e.g. request_cost > 0.10, action=banner), toggle enabled
3. Make a request that triggers the rule (or wait for one)
4. 触发记录 tab — verify triggered alert appears, click 标记已读

- [ ] **Step 4: Commit**

```bash
git add public/pages/settings.js public/app.js public/components/sidebar.js
git commit -m "feat(ui): Settings page with pricing + alert rules + triggered list"
```

---

### Task 9: Global alert banner

**Files:**
- Create: `public/components/alert-banner.js`
- Modify: `public/app.js`
- Modify: `public/pages/logs.js`

- [ ] **Step 1: Create alert banner component**

```javascript
// public/components/alert-banner.js
import { api } from '/lib/api.js';

export function mountAlertBanner() {
  let bannerEl = document.getElementById('alert-banner');
  if (!bannerEl) {
    bannerEl = document.createElement('div');
    bannerEl.id = 'alert-banner';
    bannerEl.style.cssText = 'display:none;position:sticky;top:0;z-index:30;background:#7f1d1d;border-bottom:1px solid #ef4444;color:#fecaca;padding:8px 16px;font-size:12px;';
    document.body.insertBefore(bannerEl, document.body.firstChild);
  }
  refresh();
  setInterval(refresh, 30000);
}

async function refresh() {
  const el = document.getElementById('alert-banner');
  try {
    const rows = await api('/api/admin/alerts/triggered?unack=true');
    const bannerable = rows.filter(r => r.metric); // skip orphaned
    if (!bannerable.length) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    const r = bannerable[0];
    const extra = bannerable.length > 1 ? ` (还有 ${bannerable.length - 1} 个)` : '';
    el.innerHTML = `
      🚨 <strong>${r.rule_name}</strong> 触发: ${r.rule_metric} = ${r.actual_value}${extra}
      <a href="#/settings" style="color:#fecaca;text-decoration:underline;margin-left:8px">查看</a>
      <button id="ack-banner" style="float:right;background:transparent;border:1px solid #fca5a5;color:#fca5a5;padding:1px 8px;border-radius:3px;cursor:pointer">已知悉</button>
    `;
    document.getElementById('ack-banner').onclick = async () => {
      await api(`/api/admin/alerts/triggered/${r.id}/ack`, { method: 'PUT' });
      refresh();
    };
  } catch (e) {
    el.style.display = 'none';
  }
}
```

- [ ] **Step 2: Mount in app.js**

```javascript
import { mountAlertBanner } from '/components/alert-banner.js';

// at the end of app.js, after startRouter:
mountAlertBanner();
```

- [ ] **Step 3: Replace stub in logs.js with real call**

Remove the stub `function renderAlertBanner` from logs.js — the global banner from app.js handles it now. Update logs.js polling to drop the unused `data.alerts` handling.

- [ ] **Step 4: Commit**

```bash
git add public/components/alert-banner.js public/app.js public/pages/logs.js
git commit -m "feat(ui): global alert banner with ack button, 30s refresh"
```

---

### Task 10: Backfill cost_usd for existing logs (optional)

**Files:**
- Create: `migrations/0005_backfill_costs.sql`

- [ ] **Step 1: Create backfill SQL**

```sql
-- migrations/0005_backfill_costs.sql
-- Recalculate cost_usd for existing logs using current pricing table
UPDATE logs
SET cost_usd = COALESCE(
  (SELECT (logs.prompt_tokens / 1000.0) * p.prompt_per_1k +
          (logs.completion_tokens / 1000.0) * p.completion_per_1k
   FROM pricing p WHERE p.model = logs.model),
  0
)
WHERE cost_usd = 0 OR cost_usd IS NULL;
```

- [ ] **Step 2: Apply (optional)**

Run only if you want historic logs to show cost:
```bash
wrangler d1 execute losfurina-logs --file=./migrations/0005_backfill_costs.sql
```

- [ ] **Step 3: Commit**

```bash
git add migrations/0005_backfill_costs.sql
git commit -m "feat(db): backfill cost_usd from pricing table (optional one-off)"
```

---

### Task 11: Deploy + production verification

- [ ] **Step 1: Deploy**

Run: `npm run deploy`
Expected: success.

- [ ] **Step 2: Apply migration on production**

```bash
wrangler d1 execute losfurina-logs --file=./migrations/0004_pricing_alerts.sql
```

- [ ] **Step 3: Verify**

- Settings → 模型单价 loads with seeded prices
- Settings → 告警规则: add a `provider_unhealthy` rule with telegram action
- Toggle one Provider to a bad api_key to force unhealthy, trigger probe, verify Telegram message arrives
- Playground: send a request, verify response renders + log appears with cost calculated
- Logs page: confirm new entries have cost_usd > 0
- Banner appears when an unacknowledged alert exists

---

## Self-Review Checklist

Against spec sections 5.4, 5.6, 6.1, 7.2-7.4, 8, 9.5, 10:

- [ ] `pricing` table created with seeded models (spec 7.2)
- [ ] `alert_rules` + `alert_triggers` tables created (spec 7.3, 7.4)
- [ ] `calculateCost(db, model, prompt, completion)` returns correct value (spec 10.2)
- [ ] Proxy now writes `cost_usd` to logs (spec 10.1)
- [ ] Alert evaluator supports request_cost / latency_ms / error_rate / daily_cost / provider_unhealthy (spec 8.1)
- [ ] Dedup window: 5 minutes per rule (spec 8.2)
- [ ] `/api/admin/pricing` GET/PUT/DELETE (spec 6.1)
- [ ] `/api/admin/alerts` GET/POST/PUT/DELETE (spec 6.1)
- [ ] `/api/admin/alerts/triggered` GET + ack (spec 6.1)
- [ ] `/api/poll` combines new logs + unacknowledged alerts (spec 11.2)
- [ ] Playground reuses proxy via /api/playground (spec 5.4)
- [ ] Playground logs are marked source='playground' (spec 7.1)
- [ ] Settings page with 3 tabs: pricing / alerts / triggered (spec 5.6)
- [ ] Global red alert banner with ack button (spec 8.3)
- [ ] All tests pass

Items deferred:
- ⌘K command palette (Phase 5)
- Saved playground sessions (Phase 5 polish)
