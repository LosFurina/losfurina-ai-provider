# Phase 3: Multi-Provider Routing + Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `TARGET_URL`/`TARGET_API_KEY` env-var-based proxy with a multi-Provider routing system. Implement a Cron Trigger that probes each Provider's `/v1/models` every 5 minutes, auto-discovers models, tracks health history, and exposes a dedicated Health Dashboard page.

**Architecture:** New D1 tables `providers` and `provider_health_logs`. New route lookup in `lib/router.js` reads providers from D1 (with 30s isolate cache) and selects by `model` field. `/v1/models` aggregates from all healthy Providers. Cron Trigger (`*/5 * * * *`) calls each Provider's `/v1/models` to update status + model list. Health page polls `/api/providers` and renders cards with availability sparklines.

**Tech Stack:** Cloudflare Workers, D1, Cron Triggers, vitest, vanilla DOM, SVG sparklines.

**Spec reference:** `docs/superpowers/specs/2026-06-10-dashboard-v2-design.md` sections 3, 5.5, 6.3, 6.4, 7.5, 7.6, 9, 13 (phase 3).

**Prerequisite:** Phase 1 + Phase 2 complete (routes/, static assets, base UI components).

---

### Task 1: Add `providers` + `provider_health_logs` D1 schema

**Files:**
- Create: `migrations/0003_providers.sql`
- Modify: `schema.sql`

- [ ] **Step 1: Create migration**

```sql
-- migrations/0003_providers.sql
CREATE TABLE IF NOT EXISTS providers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL UNIQUE,
  base_url          TEXT NOT NULL,
  api_key           TEXT NOT NULL,
  priority          INTEGER NOT NULL DEFAULT 100,
  enabled           INTEGER NOT NULL DEFAULT 1,
  models            TEXT DEFAULT '[]',
  health_status     TEXT DEFAULT 'unknown',
  last_latency_ms   INTEGER,
  last_checked_at   TEXT,
  last_error        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_providers_enabled ON providers(enabled);
CREATE INDEX IF NOT EXISTS idx_providers_priority ON providers(priority);

CREATE TABLE IF NOT EXISTS provider_health_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id  INTEGER NOT NULL,
  checked_at   TEXT NOT NULL,
  status       TEXT NOT NULL,
  latency_ms   INTEGER,
  http_status  INTEGER,
  model_count  INTEGER,
  error        TEXT
);

CREATE INDEX IF NOT EXISTS idx_health_provider_time ON provider_health_logs(provider_id, checked_at);
```

- [ ] **Step 2: Append to schema.sql for fresh installs**

Add the above CREATE TABLE statements to the end of `schema.sql`.

- [ ] **Step 3: Apply migration locally**

Run: `wrangler d1 execute losfurina-logs --local --file=./migrations/0003_providers.sql`
Expected: no errors.

- [ ] **Step 4: Apply migration remotely**

Run: `wrangler d1 execute losfurina-logs --file=./migrations/0003_providers.sql`
Expected: no errors.

- [ ] **Step 5: Create seed example file**

Create `migrations/seed-providers.sql.example`:

```sql
-- Example: copy this file to seed-providers.sql, fill in real values, then run:
-- wrangler d1 execute losfurina-logs --file=./migrations/seed-providers.sql

INSERT INTO providers (name, base_url, api_key, priority, enabled, created_at, updated_at) VALUES
  ('OpenAI Official', 'https://api.openai.com/v1', 'sk-...', 10, 1, datetime('now'), datetime('now')),
  ('Anthropic Direct', 'https://api.anthropic.com/v1', 'sk-ant-...', 20, 1, datetime('now'), datetime('now'));
```

- [ ] **Step 6: Commit**

```bash
git add migrations/0003_providers.sql migrations/seed-providers.sql.example schema.sql
git commit -m "feat(db): providers + provider_health_logs tables + seed example"
```

---

### Task 2: Implement provider routing module (TDD)

**Files:**
- Create: `tests/router.test.js`
- Create: `src/lib/router.js`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/router.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { resolveProvider, aggregateModels, invalidateCache } from '../src/lib/router.js';

async function seed(db) {
  await db.exec(`DELETE FROM providers`);
  await db.prepare(
    `INSERT INTO providers (name, base_url, api_key, priority, enabled, models, health_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, 'healthy', datetime('now'), datetime('now'))`
  ).bind('A', 'https://a.test/v1', 'keyA', 10, '["gpt-4o","claude-4"]').run();
  await db.prepare(
    `INSERT INTO providers (name, base_url, api_key, priority, enabled, models, health_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, 'healthy', datetime('now'), datetime('now'))`
  ).bind('B', 'https://b.test/v1', 'keyB', 5, '["gpt-4o","deepseek-v3"]').run();
  await db.prepare(
    `INSERT INTO providers (name, base_url, api_key, priority, enabled, models, health_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, 'healthy', datetime('now'), datetime('now'))`
  ).bind('C-disabled', 'https://c.test/v1', 'keyC', 1, '["o1-preview"]').run();
}

describe('resolveProvider', () => {
  beforeEach(async () => { await seed(env.DB); invalidateCache(); });

  it('returns the higher-priority (lower number) Provider on conflict', async () => {
    const p = await resolveProvider(env.DB, 'gpt-4o');
    expect(p).not.toBeNull();
    expect(p.name).toBe('B');
  });

  it('returns the only Provider that owns a unique model', async () => {
    const p = await resolveProvider(env.DB, 'claude-4');
    expect(p.name).toBe('A');
  });

  it('skips disabled Providers', async () => {
    const p = await resolveProvider(env.DB, 'o1-preview');
    expect(p).toBeNull();
  });

  it('returns null for unknown model', async () => {
    const p = await resolveProvider(env.DB, 'unknown-model');
    expect(p).toBeNull();
  });
});

describe('aggregateModels', () => {
  beforeEach(async () => { await seed(env.DB); invalidateCache(); });

  it('returns deduplicated model list with owner', async () => {
    const list = await aggregateModels(env.DB);
    const ids = list.map(m => m.id);
    expect(ids).toContain('gpt-4o');
    expect(ids).toContain('claude-4');
    expect(ids).toContain('deepseek-v3');
    expect(ids).not.toContain('o1-preview');
    const gpt = list.find(m => m.id === 'gpt-4o');
    expect(gpt.owned_by).toBe('B'); // higher priority wins
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npm test -- router`
Expected: module not found.

- [ ] **Step 3: Implement src/lib/router.js**

```javascript
// src/lib/router.js
let cache = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 30 * 1000;

export function invalidateCache() {
  cache = null;
  cacheExpiry = 0;
}

async function getProviders(db) {
  const now = Date.now();
  if (cache && now < cacheExpiry) return cache;
  const { results } = await db.prepare(
    `SELECT id, name, base_url, api_key, priority, enabled, models, health_status
     FROM providers
     WHERE enabled = 1
     ORDER BY priority ASC`
  ).all();
  cache = results.map(r => ({ ...r, models: safeParse(r.models) }));
  cacheExpiry = now + CACHE_TTL_MS;
  return cache;
}

function safeParse(s) {
  try { return JSON.parse(s || '[]'); } catch { return []; }
}

export async function resolveProvider(db, model) {
  if (!model) return null;
  const providers = await getProviders(db);
  for (const p of providers) {
    if (p.health_status === 'unhealthy') continue;
    if (Array.isArray(p.models) && p.models.includes(model)) return p;
  }
  return null;
}

export async function aggregateModels(db) {
  const providers = await getProviders(db);
  const seen = new Set();
  const result = [];
  for (const p of providers) {
    if (p.health_status === 'unhealthy') continue;
    for (const m of (p.models || [])) {
      if (seen.has(m)) continue;
      seen.add(m);
      result.push({ id: m, object: 'model', owned_by: p.name });
    }
  }
  return result;
}

export async function listProviders(db, { includeDisabled = false } = {}) {
  const where = includeDisabled ? '' : 'WHERE enabled = 1';
  const { results } = await db.prepare(
    `SELECT * FROM providers ${where} ORDER BY priority ASC`
  ).all();
  return results.map(r => ({ ...r, models: safeParse(r.models) }));
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm test -- router`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/router.test.js src/lib/router.js
git commit -m "feat(routing): model→provider lookup + aggregation with isolate cache"
```

---

### Task 3: Rewrite proxy to use router

**Files:**
- Modify: `src/routes/proxy.js`
- Modify: `src/db.js`

- [ ] **Step 1: Update insertLog to accept provider_id**

In `src/db.js`, modify `insertLog`:

```javascript
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
```

- [ ] **Step 2: Rewrite src/routes/proxy.js to route by model**

```javascript
// src/routes/proxy.js
import { resolveProvider } from '../lib/router.js';
import { insertLog } from '../db.js';
import { formatBatchLog } from '../logger.js';
import { sendTelegramMessage } from '../telegram.js';
import { LogBuffer } from '../buffer.js';

const logBuffer = new LogBuffer();

export async function handleProxy(request, config, env, ctx) {
  const startTime = Date.now();
  const requestBody = await request.clone().text();

  let model = null;
  try {
    if (requestBody) {
      const parsed = JSON.parse(requestBody);
      model = parsed.model || null;
    }
  } catch {}

  if (!model) {
    return jsonError(400, 'missing_model', 'model field is required in request body');
  }

  const provider = await resolveProvider(env.DB, model);
  if (!provider) {
    // Distinguish "no providers configured at all" vs "model not found"
    const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM providers WHERE enabled = 1').all();
    if (!results[0].n) {
      return jsonError(503, 'no_providers', 'no providers configured; insert into providers table to start routing');
    }
    return jsonError(404, 'model_not_found', `no enabled healthy provider owns model "${model}"`);
  }

  try {
    const pathname = new URL(request.url).pathname;
    const targetUrl = joinUrl(provider.base_url, pathname);
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${provider.api_key}`);
    headers.delete('Host');

    const targetResponse = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method === 'GET' ? undefined : requestBody,
    });

    const responseBody = await targetResponse.clone().text();
    const durationMs = Date.now() - startTime;

    let promptTokens = 0, completionTokens = 0, totalTokens = 0;
    try {
      const parsed = JSON.parse(responseBody);
      if (parsed.usage) {
        promptTokens = parsed.usage.prompt_tokens || 0;
        completionTokens = parsed.usage.completion_tokens || 0;
        totalTokens = parsed.usage.total_tokens || 0;
      }
    } catch {}

    const logEntry = {
      timestamp: new Date().toISOString(),
      model,
      method: request.method,
      path: pathname,
      status: targetResponse.status,
      durationMs,
      promptTokens,
      completionTokens,
      totalTokens,
      requestBody,
      responseBody,
      costUsd: 0, // pricing wired up in Phase 4
      source: 'proxy',
      providerId: provider.id,
    };

    ctx.waitUntil(insertLog(env.DB, logEntry).catch(err => {
      console.error('D1 insert error:', err.message);
    }));

    const flushFn = async (entries) => {
      try { await sendTelegramMessage(config, formatBatchLog(entries)); }
      catch (err) { console.error('Telegram flush error:', err.message); }
    };
    logBuffer.push(logEntry, flushFn, ctx);

    return new Response(responseBody, {
      status: targetResponse.status,
      statusText: targetResponse.statusText,
      headers: targetResponse.headers,
    });
  } catch (err) {
    console.error('Proxy error:', err.message);
    return jsonError(502, 'proxy_error', err.message);
  }
}

function joinUrl(base, pathname) {
  const trimmedBase = base.replace(/\/$/, '');
  // Strip leading /v1 from pathname if base already ends with /v1
  let path = pathname;
  if (trimmedBase.endsWith('/v1') && path.startsWith('/v1/')) {
    path = path.slice(3);
  }
  return trimmedBase + path;
}

function jsonError(status, type, message) {
  return new Response(JSON.stringify({ error: { type, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 3: Manual smoke test (no automated test for full proxy yet)**

Run: `npm test`
Expected: all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/routes/proxy.js src/db.js
git commit -m "feat(routing): proxy resolves backend by model field from providers table"
```

---

### Task 4: Add /v1/models aggregation endpoint

**Files:**
- Create: `src/routes/models.js`
- Modify: `src/index.js`

- [ ] **Step 1: Create src/routes/models.js**

```javascript
// src/routes/models.js
import { aggregateModels } from '../lib/router.js';

export async function handleModelsList(request, env) {
  const data = await aggregateModels(env.DB);
  return new Response(JSON.stringify({ object: 'list', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 2: Wire up in src/index.js — add before generic /v1/ proxy handler**

```javascript
import { handleModelsList } from './routes/models.js';

// inside fetch(), after auth check, before handleProxy dispatch:
if (url.pathname === '/v1/models' && request.method === 'GET') {
  return handleModelsList(request, env);
}
```

- [ ] **Step 3: Remove TARGET_URL / TARGET_API_KEY reads from src/config.js**

Update `src/config.js`:

```javascript
export function getConfig(env) {
  return {
    workerApiKey: env.WORKER_API_KEY || '',
    telegramBotToken: env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: env.TELEGRAM_CHAT_ID || '',
  };
}
```

- [ ] **Step 4: Remove TARGET_URL check from src/index.js**

The old block that returned 500 when `!config.targetUrl` is no longer needed — the proxy now reports its own no-providers error.

- [ ] **Step 5: Manual smoke test**

Seed a Provider via D1 console with a real key + models like `["gpt-4o"]`:

```bash
wrangler d1 execute losfurina-logs --local --command "
INSERT INTO providers (name, base_url, api_key, priority, enabled, models, health_status, created_at, updated_at)
VALUES ('test', 'https://api.openai.com/v1', 'sk-...', 10, 1, '[\"gpt-4o\"]', 'healthy', datetime('now'), datetime('now'))"
```

Then:
```bash
curl http://localhost:8787/v1/models -H "Authorization: Bearer <WORKER_API_KEY>"
# Expected: {"object":"list","data":[{"id":"gpt-4o","object":"model","owned_by":"test"}]}
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/models.js src/index.js src/config.js
git commit -m "feat(routing): /v1/models aggregation + remove TARGET_URL env vars"
```

---

### Task 5: Implement health check probe (TDD pure logic)

**Files:**
- Create: `tests/healthcheck.test.js`
- Create: `src/lib/healthcheck.js`

- [ ] **Step 1: Write failing test for status judgement**

```javascript
// tests/healthcheck.test.js
import { describe, it, expect } from 'vitest';
import { judgeStatus, parseModelsResponse } from '../src/lib/healthcheck.js';

describe('judgeStatus', () => {
  it('returns healthy on 200 with non-empty model list', () => {
    expect(judgeStatus(200, ['gpt-4o', 'gpt-3.5'])).toBe('healthy');
  });
  it('returns degraded on 200 with empty list', () => {
    expect(judgeStatus(200, [])).toBe('degraded');
  });
  it('returns unhealthy on non-200', () => {
    expect(judgeStatus(500, null)).toBe('unhealthy');
    expect(judgeStatus(429, null)).toBe('unhealthy');
  });
  it('returns unhealthy on network error (status 0)', () => {
    expect(judgeStatus(0, null)).toBe('unhealthy');
  });
});

describe('parseModelsResponse', () => {
  it('parses OpenAI-style response', () => {
    const json = '{"object":"list","data":[{"id":"gpt-4o"},{"id":"gpt-3.5"}]}';
    expect(parseModelsResponse(json)).toEqual(['gpt-4o', 'gpt-3.5']);
  });
  it('returns [] on invalid JSON', () => {
    expect(parseModelsResponse('not-json')).toEqual([]);
  });
  it('returns [] on missing data array', () => {
    expect(parseModelsResponse('{"object":"list"}')).toEqual([]);
  });
});
```

- [ ] **Step 2: Confirm failure**

Run: `npm test -- healthcheck`
Expected: module not found.

- [ ] **Step 3: Create src/lib/healthcheck.js**

```javascript
// src/lib/healthcheck.js
import { invalidateCache } from './router.js';

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
    `SELECT id, name, base_url, api_key FROM providers WHERE enabled = 1`
  ).all();
  if (!providers.length) return;

  const results = await Promise.all(providers.map(async p => {
    const probe = await probeOne(p);
    return { provider: p, probe };
  }));

  // Persist results
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
}

export async function purgeOldHealthLogs(env, daysToKeep = 7) {
  const cutoff = new Date(Date.now() - daysToKeep * 86400 * 1000).toISOString();
  await env.DB.prepare(`DELETE FROM provider_health_logs WHERE checked_at < ?`).bind(cutoff).run();
}
```

- [ ] **Step 4: Verify pure-logic tests pass**

Run: `npm test -- healthcheck`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/healthcheck.test.js src/lib/healthcheck.js
git commit -m "feat(health): provider probe + persistence + log purge"
```

---

### Task 6: Wire up Cron Trigger + scheduled handler

**Files:**
- Modify: `wrangler.toml`
- Modify: `src/index.js`

- [ ] **Step 1: Add Cron trigger to wrangler.toml**

```toml
[triggers]
crons = ["*/5 * * * *"]
```

- [ ] **Step 2: Export scheduled handler in src/index.js**

At the bottom of `src/index.js`, modify the default export:

```javascript
import { probeAllProviders, purgeOldHealthLogs } from './lib/healthcheck.js';

export default {
  async fetch(request, env, ctx) {
    // ... existing fetch handler unchanged ...
  },
  async scheduled(event, env, ctx) {
    await probeAllProviders(env, ctx);
    // Purge once per hour (cron fires every 5 min)
    const minutes = new Date().getUTCMinutes();
    if (minutes < 5) {
      await purgeOldHealthLogs(env, 7);
    }
  },
};
```

- [ ] **Step 3: Test cron locally**

Run: `wrangler dev --test-scheduled`
In another shell: `curl http://localhost:8787/cdn-cgi/handler/scheduled`
Expected: returns 200, no errors. Check D1 for updated providers.

- [ ] **Step 4: Commit**

```bash
git add wrangler.toml src/index.js
git commit -m "feat(health): cron trigger probes all providers every 5 minutes"
```

---

### Task 7: Build /api/providers + /api/providers/probe endpoints

**Files:**
- Create: `src/routes/api-providers.js`
- Modify: `src/index.js`

- [ ] **Step 1: Create src/routes/api-providers.js**

```javascript
// src/routes/api-providers.js
import { listProviders } from '../lib/router.js';
import { probeAllProviders } from '../lib/healthcheck.js';

export async function handleProvidersApi(request, env, ctx) {
  const url = new URL(request.url);

  // POST /api/providers/probe — manual trigger
  if (url.pathname === '/api/providers/probe' && request.method === 'POST') {
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
```

- [ ] **Step 2: Wire up in src/index.js**

Add after the `/api/logs` dispatch:

```javascript
import { handleProvidersApi } from './routes/api-providers.js';

// ...
if (url.pathname.startsWith('/api/providers')) {
  return handleProvidersApi(request, env, ctx);
}
```

- [ ] **Step 3: Smoke test**

```bash
curl http://localhost:8787/api/providers -H "Authorization: Bearer <key>"
# Expected: JSON list (possibly empty)

curl -X POST http://localhost:8787/api/providers/probe -H "Authorization: Bearer <key>"
# Expected: {"ok":true}
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/api-providers.js src/index.js
git commit -m "feat(api): /api/providers list + health history + manual probe"
```

---

### Task 8: Build sparkline component

**Files:**
- Create: `public/components/sparkline.js`

- [ ] **Step 1: Hand-rolled SVG sparkline (status timeline)**

```javascript
// public/components/sparkline.js
// Renders a 24-hour status sparkline: 24 cells, each colored by hourly worst status.
export function renderStatusSparkline({ healthLogs, hours = 24 }) {
  const buckets = [];
  const now = Date.now();
  for (let i = hours - 1; i >= 0; i--) {
    const start = now - (i + 1) * 3600 * 1000;
    const end = now - i * 3600 * 1000;
    const inBucket = healthLogs.filter(h => {
      const t = new Date(h.ts).getTime();
      return t >= start && t < end;
    });
    let status = 'none';
    if (inBucket.length) {
      if (inBucket.some(h => h.status === 'unhealthy')) status = 'unhealthy';
      else if (inBucket.some(h => h.status === 'degraded')) status = 'degraded';
      else status = 'healthy';
    }
    buckets.push(status);
  }
  const colorOf = (s) => ({
    healthy: '#4ade80',
    degraded: '#fbbf24',
    unhealthy: '#ef4444',
    none: '#334155',
  })[s];
  const cellW = 6, gap = 2, h = 16;
  const totalW = hours * (cellW + gap);
  const cells = buckets.map((s, i) => `
    <rect x="${i * (cellW + gap)}" y="0" width="${cellW}" height="${h}" rx="1" fill="${colorOf(s)}"/>
  `).join('');
  return `<svg width="${totalW}" height="${h}" viewBox="0 0 ${totalW} ${h}">${cells}</svg>`;
}

export function renderLatencyLineSparkline({ healthLogs, hours = 24 }) {
  const points = healthLogs
    .filter(h => h.status !== 'unhealthy' && typeof h.latency_ms === 'number')
    .map(h => ({ t: new Date(h.ts).getTime(), v: h.latency_ms }));
  if (!points.length) return '<div style="color:var(--text-tertiary);font-size:11px">无数据</div>';
  const w = 240, h = 40;
  const minT = points[0].t;
  const maxT = points[points.length - 1].t;
  const maxV = Math.max(...points.map(p => p.v), 1);
  const path = points.map((p, i) => {
    const x = ((p.t - minT) / Math.max(maxT - minT, 1)) * w;
    const y = h - (p.v / maxV) * h;
    return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <path d="${path}" fill="none" stroke="#3b82f6" stroke-width="1.5"/>
  </svg>`;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/components/sparkline.js
git commit -m "feat(ui): SVG sparkline components for provider health timeline"
```

---

### Task 9: Build Health page

**Files:**
- Create: `public/pages/health.js`
- Modify: `public/app.js`
- Modify: `public/components/sidebar.js`

- [ ] **Step 1: Write public/pages/health.js**

```javascript
// public/pages/health.js
import { api } from '/lib/api.js';
import { renderStatusSparkline, renderLatencyLineSparkline } from '/components/sparkline.js';
import { openSidePanel } from '/components/side-panel.js';

export function renderHealth(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Health</div>
        <div class="page-subtitle">Provider 后端可用性监控</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="filter-chip" id="manual-probe">立即探测</button>
        <span style="font-size:11px;color:var(--text-tertiary);align-self:center" id="status-summary"></span>
      </div>
    </div>
    <div class="page-body" id="health-body">
      <div style="padding:40px;text-align:center;color:var(--text-tertiary)">加载中...</div>
    </div>
  `;

  container.querySelector('#manual-probe').onclick = async () => {
    const btn = container.querySelector('#manual-probe');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>探测中...';
    try {
      await api('/api/providers/probe', { method: 'POST' });
      await load();
    } catch (e) {
      alert('探测失败：' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  };

  load();
}

async function load() {
  const providers = await api('/api/providers');
  const summary = computeSummary(providers);
  document.getElementById('status-summary').textContent = summary;
  await renderCards(providers);
}

function computeSummary(providers) {
  const enabled = providers.filter(p => p.enabled);
  const healthy = enabled.filter(p => p.health_status === 'healthy').length;
  const totalModels = enabled.filter(p => p.health_status === 'healthy')
    .reduce((s, p) => s + (p.model_count || 0), 0);
  return `${healthy}/${enabled.length} Healthy · ${totalModels} Models`;
}

async function renderCards(providers) {
  const body = document.getElementById('health-body');
  if (!providers.length) {
    body.innerHTML = emptyState();
    return;
  }

  // Fetch 24h history for each enabled provider in parallel
  const histories = await Promise.all(providers.map(async p => {
    if (!p.enabled) return { id: p.id, buckets: [] };
    try {
      const r = await api(`/api/providers/${p.id}/health?hours=24`);
      return { id: p.id, buckets: r.buckets || [] };
    } catch {
      return { id: p.id, buckets: [] };
    }
  }));
  const histMap = new Map(histories.map(h => [h.id, h.buckets]));

  body.innerHTML = providers.map(p => providerCard(p, histMap.get(p.id) || [])).join('');

  body.querySelectorAll('[data-provider]').forEach(card => {
    card.onclick = (e) => {
      if (e.target.closest('button')) return;
      openProviderDetail(parseInt(card.dataset.provider, 10), providers, histMap);
    };
  });
}

function providerCard(p, healthLogs) {
  const statusIcon = ({
    healthy: '🟢', degraded: '🟡', unhealthy: '🔴', unknown: '⚪',
  })[p.health_status] || '⚪';
  const disabled = !p.enabled;
  const latencyStr = p.last_latency_ms != null ? `${p.last_latency_ms}ms` : '—';
  const checkedStr = p.last_checked_at ? timeAgo(p.last_checked_at) : '—';
  const uptimeStr = p.uptime_24h != null ? (p.uptime_24h * 100).toFixed(1) + '%' : '—';

  return `
    <div class="card" data-provider="${p.id}" style="margin-bottom:12px;cursor:pointer;${disabled ? 'opacity:0.5' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:start">
        <div>
          <div style="font-size:14px;font-weight:600">
            ${statusIcon} ${escape(p.name)}
            <span style="color:var(--text-tertiary);font-size:11px;font-weight:400;margin-left:8px">priority: ${p.priority}${disabled ? ' · disabled' : ''}</span>
          </div>
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary);margin-top:4px">${escape(p.base_url)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--text-secondary)">上次探测 ${checkedStr}</div>
          <div style="font-size:11px;color:var(--text-secondary)">延迟 <span style="color:var(--text-primary)">${latencyStr}</span></div>
        </div>
      </div>
      <div style="border-top:1px solid var(--border-subtle);margin:12px 0;padding-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase">模型数</div>
          <div style="font-size:13px;margin-top:2px">${p.model_count || 0}</div>
          ${p.last_error ? `<div style="font-size:10px;color:var(--accent-red);margin-top:4px">最近错误: ${escape(p.last_error)}</div>` : ''}
        </div>
        <div>
          <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase">24h 可用性 ${uptimeStr}</div>
          <div style="margin-top:6px">${renderStatusSparkline({ healthLogs, hours: 24 })}</div>
        </div>
      </div>
    </div>
  `;
}

function openProviderDetail(id, providers, histMap) {
  const p = providers.find(x => x.id === id);
  if (!p) return;
  const history = histMap.get(id) || [];
  openSidePanel({
    title: `${p.name} 详细`,
    bodyHtml: `
      <div class="card" style="margin-bottom:12px">
        <div class="label">base_url</div>
        <div style="font-family:var(--font-mono);font-size:11px;margin-top:4px;word-break:break-all">${escape(p.base_url)}</div>
        <div class="label" style="margin-top:8px">api_key</div>
        <div style="font-family:var(--font-mono);font-size:11px;margin-top:4px">${escape(p.api_key)}</div>
      </div>
      <div class="card" style="margin-bottom:12px">
        <div class="label">支持的模型 (${p.model_count})</div>
        <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">
          ${(p.models || []).map(m => `<span class="tag tag-model-default">${escape(m)}</span>`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="label">24h 延迟趋势</div>
        <div style="margin-top:8px">${renderLatencyLineSparkline({ healthLogs: history, hours: 24 })}</div>
      </div>
    `,
  });
}

function emptyState() {
  return `
    <div style="text-align:center;padding:60px 20px;color:var(--text-secondary)">
      <div style="font-size:32px;margin-bottom:12px">📭</div>
      <div style="font-size:14px;margin-bottom:8px">还没有任何 Provider</div>
      <div style="font-size:12px;color:var(--text-tertiary);max-width:480px;margin:0 auto;line-height:1.7">
        直接在 D1 中插入 <code>providers</code> 表数据。<br>
        参考 <code>migrations/seed-providers.sql.example</code>，<br>
        或运行：<br>
        <code style="background:var(--bg-elevated);padding:8px;display:inline-block;margin-top:8px;border-radius:4px">wrangler d1 execute losfurina-logs --command "INSERT INTO providers ..."</code>
      </div>
    </div>
  `;
}

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return diff + '秒前';
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
  return Math.floor(diff / 86400) + '天前';
}

function escape(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 2: Register Health route in app.js**

```javascript
import { renderHealth } from '/pages/health.js';

registerRoute('/health', (c) => renderHealth(c));
```

- [ ] **Step 3: Enable Health in sidebar (remove disabled flag)**

In `public/components/sidebar.js`, change the Health entry:
```javascript
{ path: '/health', icon: '💚', label: 'Health' },
```

- [ ] **Step 4: Manual verification**

Run: `npm run dev`
1. Seed at least one provider via D1 console
2. Visit Health page — verify card renders
3. Click "立即探测" — verify status updates
4. Click on a card — side panel opens with details
5. Verify empty state when providers table is cleared

- [ ] **Step 5: Commit**

```bash
git add public/pages/health.js public/app.js public/components/sidebar.js
git commit -m "feat(ui): Health page with provider cards, sparklines, manual probe"
```

---

### Task 10: Provider status badge in sidebar

**Files:**
- Modify: `public/components/sidebar.js`

- [ ] **Step 1: Add unhealthy indicator dot next to Health nav item**

Update `renderSidebar` to fetch `/api/providers` and color the Health icon dot:

```javascript
// in sidebar.js, replace the existing renderSidebar with:
import { clearToken, api } from '/lib/api.js';
import { getCurrentPath } from '/lib/router.js';

const NAV = [
  { path: '/overview', icon: '📊', label: 'Overview' },
  { path: '/logs', icon: '📋', label: 'Logs' },
  { path: '/analytics', icon: '📈', label: 'Analytics' },
  { path: '/playground', icon: '🧪', label: 'Playground', disabled: true },
  { path: '/health', icon: '💚', label: 'Health' },
];

let healthBadgeRefreshTimer = null;

export function renderSidebar(container) {
  const current = getCurrentPath();
  container.className = 'sidebar';
  container.innerHTML = `
    <div class="sidebar-brand">⚡ LosFurina</div>
    <div class="sidebar-search" id="search-trigger">
      <span>搜索...</span>
      <span class="kbd">⌘K</span>
    </div>
    <nav class="sidebar-nav">
      ${NAV.map(item => `
        <a href="${item.disabled ? '#' : '#' + item.path}"
           class="${current === item.path ? 'active' : ''}"
           data-path="${item.path}"
           style="${item.disabled ? 'opacity:0.4;cursor:not-allowed' : ''}">
          <span>${item.icon}</span>
          <span>${item.label}</span>
          ${item.path === '/health' ? '<span id="health-badge" style="margin-left:auto;width:6px;height:6px;border-radius:50%;background:var(--text-tertiary)"></span>' : ''}
        </a>
      `).join('')}
    </nav>
    <div class="sidebar-footer">
      <a href="#/settings" style="opacity:0.6;color:var(--text-tertiary);padding:8px 10px;font-size:13px;">⚙ Settings</a>
      <a id="logout-btn" style="cursor:pointer;color:var(--text-tertiary);padding:8px 10px;font-size:12px;">退出登录</a>
    </div>
  `;
  container.querySelector('#logout-btn').onclick = () => {
    clearToken();
    window.location.href = '/login.html';
  };
  container.querySelector('#search-trigger').onclick = () => alert('⌘K 在 Phase 5 实现');
  window.addEventListener('hashchange', () => renderSidebar(container));

  refreshHealthBadge();
  if (healthBadgeRefreshTimer) clearInterval(healthBadgeRefreshTimer);
  healthBadgeRefreshTimer = setInterval(refreshHealthBadge, 60000);
}

async function refreshHealthBadge() {
  const badge = document.getElementById('health-badge');
  if (!badge) return;
  try {
    const list = await api('/api/providers');
    const enabled = list.filter(p => p.enabled);
    const hasUnhealthy = enabled.some(p => p.health_status === 'unhealthy');
    const hasDegraded = enabled.some(p => p.health_status === 'degraded');
    badge.style.background = hasUnhealthy ? 'var(--accent-red)' : hasDegraded ? 'var(--accent-yellow)' : 'var(--accent-green)';
  } catch {
    badge.style.background = 'var(--text-tertiary)';
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add public/components/sidebar.js
git commit -m "feat(ui): live provider health indicator dot in sidebar"
```

---

### Task 11: Update Playground page invocation (forward declare for Phase 4)

This task touches Playground only minimally — actual page is built in Phase 4. We need to update the proxy contract so the Playground API uses the new router.

**Files:**
- (No changes needed)

- [ ] **Step 1: Verify existing `/v1/*` proxy handles `model`-routed requests without changes**

This already works after Task 3. Playground will reuse `/api/playground` which Phase 4 will route through the same proxy. No action needed here, just confirm.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: all tests pass (router + healthcheck + api-logs + kpis + timeseries).

---

### Task 12: Deploy + production smoke test

- [ ] **Step 1: Deploy**

Run: `npm run deploy`
Expected: success.

- [ ] **Step 2: Seed providers on production D1**

```bash
wrangler d1 execute losfurina-logs --command "
INSERT INTO providers (name, base_url, api_key, priority, enabled, models, health_status, created_at, updated_at)
VALUES ('OpenAI', 'https://api.openai.com/v1', 'sk-...', 10, 1, '[]', 'unknown', datetime('now'), datetime('now'))"
```

- [ ] **Step 3: Wait or trigger probe manually**

```bash
curl -X POST https://<your-worker>.workers.dev/api/providers/probe \
  -H "Authorization: Bearer <WORKER_API_KEY>"
```

- [ ] **Step 4: Verify on Dashboard**

- Visit Health page → Provider card shows healthy + populated model count
- Visit `/v1/models` endpoint:
  ```bash
  curl https://<worker>/v1/models -H "Authorization: Bearer <WORKER_API_KEY>"
  ```
- Make a `/v1/chat/completions` request with one of the discovered models → should succeed and log entry should appear with `provider_id` set

- [ ] **Step 5: Verify Cron**

After 5 minutes, check Cloudflare dashboard for Cron Trigger execution log. Verify `provider_health_logs` has new rows.

---

## Self-Review Checklist

Against spec sections 5.5, 6.3, 6.4, 7.5, 7.6, 9:

- [ ] `providers` table created with all 12 fields (spec 7.5)
- [ ] `provider_health_logs` table created (spec 7.6)
- [ ] `logs.provider_id` column added (spec 7.1)
- [ ] Routing: by model → highest-priority Provider that owns it (spec 6.3)
- [ ] Returns 503 when providers table empty (spec 6.3)
- [ ] Returns 404 when model not found (spec 6.3)
- [ ] `/v1/models` aggregates from healthy enabled Providers, dedupes by priority (spec 6.4)
- [ ] Cron Trigger configured `*/5 * * * *` (spec 9.1)
- [ ] Health probe calls `/v1/models` on each Provider (spec 9.2)
- [ ] Status judgment: healthy / degraded / unhealthy (spec 9.3)
- [ ] Manual probe endpoint `POST /api/providers/probe` (spec 9.4)
- [ ] Health page: cards, sparkline, model count, last_error, manual probe button (spec 5.5)
- [ ] Empty state with seed instructions (spec 5.5)
- [ ] Sidebar badge for overall provider health
- [ ] `TARGET_URL` / `TARGET_API_KEY` env vars removed (spec 11)
- [ ] All tests pass

Items deferred:
- Provider unhealthy alert rule (Phase 4 — alert system)
- Click-to-jump to filtered Logs when clicking a provider's request count (Phase 5 polish)
- `provider_id` filter on Logs page (Phase 5 polish)
