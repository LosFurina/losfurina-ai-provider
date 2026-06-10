# Phase 1: Static Assets + Logs Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate from inline HTML in Worker to Static Assets, build the new SPA shell (sidebar + hash router + Linear-style theme), and ship the enhanced Logs page with multi-dimensional filters, side-panel details, real-time polling, and saved views.

**Architecture:** Static SPA served via Cloudflare Workers Assets binding. Worker handles `/v1/*` proxy and `/api/*` JSON. Frontend uses zero-build native ES Modules. Hash routing keeps SPA infrastructure server-agnostic. Logs API extended with filter params.

**Tech Stack:** Cloudflare Workers, D1, Wrangler 4.x Static Assets, vitest + @cloudflare/vitest-pool-workers, native ES Modules, vanilla DOM.

**Spec reference:** `docs/superpowers/specs/2026-06-10-dashboard-v2-design.md` sections 3, 4, 5.2, 6.1, 6.2, 11.

---

### Task 1: Add testing infrastructure

**Files:**
- Modify: `package.json`
- Create: `vitest.config.js`
- Create: `tests/.gitkeep`

- [ ] **Step 1: Update package.json scripts and devDependencies**

```json
{
  "name": "losfurina-ai-provider",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:create": "wrangler d1 create losfurina-logs",
    "db:migrate": "wrangler d1 execute losfurina-logs --file=./schema.sql",
    "db:local": "wrangler d1 execute losfurina-logs --local --file=./schema.sql"
  },
  "devDependencies": {
    "wrangler": "^4.0.0",
    "vitest": "^2.0.0",
    "@cloudflare/vitest-pool-workers": "^0.5.0"
  }
}
```

- [ ] **Step 2: Create vitest.config.js**

```javascript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' }
      }
    }
  }
});
```

- [ ] **Step 3: Create tests directory placeholder**

```bash
mkdir -p tests
touch tests/.gitkeep
```

- [ ] **Step 4: Install dependencies and verify**

Run: `npm install && npm test`
Expected: `No test files found` (passes with no tests)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.js tests/.gitkeep
git commit -m "chore: add vitest + workers pool test infrastructure"
```

---

### Task 2: Configure Static Assets binding

**Files:**
- Modify: `wrangler.toml`
- Create: `public/index.html`
- Create: `public/login.html`

- [ ] **Step 1: Add Static Assets binding to wrangler.toml**

```toml
name = "losfurina-ai-provider"
main = "src/index.js"
compatibility_date = "2026-06-10"

[assets]
directory = "./public"
binding = "ASSETS"
not_found_handling = "single-page-application"

[[d1_databases]]
binding = "DB"
database_name = "losfurina-logs"
database_id = "c8ca6c63-accb-44af-ba07-42dd9e15a107"
```

- [ ] **Step 2: Create minimal public/index.html shell**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LosFurina AI Provider</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create public/login.html (placeholder, full version in Task 11)**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Login - LosFurina</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div id="login"></div>
  <script type="module" src="/login.js"></script>
</body>
</html>
```

- [ ] **Step 4: Commit**

```bash
git add wrangler.toml public/index.html public/login.html
git commit -m "feat: configure static assets binding + shell HTML"
```

---

### Task 3: Refactor Worker entry — split into routes/

**Files:**
- Modify: `src/index.js`
- Create: `src/routes/proxy.js`
- Create: `src/routes/api-logs.js`
- Create: `src/routes/login.js` (login API for now until SPA login)

- [ ] **Step 1: Create src/routes/proxy.js (extract existing proxyRequest)**

```javascript
import { insertLog } from '../db.js';
import { formatBatchLog } from '../logger.js';
import { sendTelegramMessage } from '../telegram.js';
import { LogBuffer } from '../buffer.js';

const logBuffer = new LogBuffer();

export async function handleProxy(request, config, env, ctx) {
  const startTime = Date.now();
  const requestBody = await request.clone().text();

  let model = 'unknown';
  try {
    if (requestBody) {
      const parsed = JSON.parse(requestBody);
      model = parsed.model || 'unknown';
    }
  } catch {}

  try {
    const targetUrl = new URL(request.url).pathname;
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${config.targetApiKey}`);
    headers.delete('Host');

    const targetResponse = await fetch(new URL(targetUrl, config.targetUrl).toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' ? undefined : requestBody,
    });

    const responseClone = targetResponse.clone();
    const responseBody = await responseClone.text();
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
      path: targetUrl,
      status: targetResponse.status,
      durationMs,
      promptTokens,
      completionTokens,
      totalTokens,
      requestBody,
      responseBody,
    };

    ctx.waitUntil(insertLog(env.DB, logEntry).catch(err => {
      console.error('D1 insert error:', err.message);
    }));

    const flushFn = async (entries) => {
      try {
        const message = formatBatchLog(entries);
        await sendTelegramMessage(config, message);
      } catch (err) {
        console.error('Telegram flush error:', err.message);
      }
    };
    logBuffer.push(logEntry, flushFn, ctx);

    return new Response(responseBody, {
      status: targetResponse.status,
      statusText: targetResponse.statusText,
      headers: targetResponse.headers,
    });
  } catch (err) {
    console.error('Proxy error:', err.message);
    return new Response(JSON.stringify({ error: { message: 'Upstream request failed', detail: err.message, type: 'proxy_error' } }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
```

- [ ] **Step 2: Create src/routes/api-logs.js (extract existing logs API)**

```javascript
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
```

- [ ] **Step 3: Slim src/index.js down to a router**

```javascript
import { getConfig } from './config.js';
import { authenticate, unauthorizedResponse } from './auth.js';
import { handleProxy } from './routes/proxy.js';
import { handleLogsApi } from './routes/api-logs.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const config = getConfig(env);

    // Health check — no auth
    if (url.pathname === '/health' && request.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Auth for API and proxy
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/')) {
      const auth = authenticate(request, config);
      if (!auth.ok) return unauthorizedResponse();
    }

    if (url.pathname.startsWith('/api/logs')) {
      return handleLogsApi(request, env);
    }

    if (url.pathname.startsWith('/v1/')) {
      if (!config.targetUrl) {
        return new Response(JSON.stringify({ error: { message: 'Target URL not configured', type: 'config_error' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return handleProxy(request, config, env, ctx);
    }

    // All other paths fall through to Static Assets binding (handled by platform)
    return env.ASSETS.fetch(request);
  },
};
```

- [ ] **Step 4: Verify with wrangler dev**

Run: `npm run dev` in one terminal, then in another:
```bash
curl http://localhost:8787/health
# Expected: {"status":"ok"}

curl http://localhost:8787/
# Expected: HTML shell from public/index.html
```

- [ ] **Step 5: Commit**

```bash
git add src/index.js src/routes/proxy.js src/routes/api-logs.js
git commit -m "refactor: split worker into routes/ + static-assets passthrough"
```

---

### Task 4: Extend D1 schema — add cost_usd, source, provider_id columns

**Files:**
- Create: `migrations/0002_logs_v2_columns.sql`
- Modify: `schema.sql`

- [ ] **Step 1: Create migration 0002**

```sql
-- migrations/0002_logs_v2_columns.sql
ALTER TABLE logs ADD COLUMN cost_usd REAL DEFAULT 0;
ALTER TABLE logs ADD COLUMN source TEXT DEFAULT 'proxy';
ALTER TABLE logs ADD COLUMN provider_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_logs_status ON logs(status);
CREATE INDEX IF NOT EXISTS idx_logs_cost ON logs(cost_usd);
CREATE INDEX IF NOT EXISTS idx_logs_provider ON logs(provider_id);
```

- [ ] **Step 2: Update schema.sql to reflect target shape (for fresh installs)**

```sql
CREATE TABLE IF NOT EXISTS logs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp          TEXT NOT NULL,
  model              TEXT NOT NULL,
  method             TEXT NOT NULL,
  path               TEXT NOT NULL,
  status             INTEGER NOT NULL,
  duration_ms        INTEGER NOT NULL,
  prompt_tokens      INTEGER DEFAULT 0,
  completion_tokens  INTEGER DEFAULT 0,
  total_tokens       INTEGER DEFAULT 0,
  request_body       TEXT,
  response_body      TEXT,
  cost_usd           REAL DEFAULT 0,
  source             TEXT DEFAULT 'proxy',
  provider_id        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_model ON logs(model);
CREATE INDEX IF NOT EXISTS idx_logs_status ON logs(status);
CREATE INDEX IF NOT EXISTS idx_logs_cost ON logs(cost_usd);
CREATE INDEX IF NOT EXISTS idx_logs_provider ON logs(provider_id);
```

- [ ] **Step 3: Apply migration locally**

Run: `wrangler d1 execute losfurina-logs --local --file=./migrations/0002_logs_v2_columns.sql`
Expected: no error

- [ ] **Step 4: Apply migration remotely**

Run: `wrangler d1 execute losfurina-logs --file=./migrations/0002_logs_v2_columns.sql`
Expected: no error

- [ ] **Step 5: Commit**

```bash
git add migrations/0002_logs_v2_columns.sql schema.sql
git commit -m "feat(db): add cost_usd / source / provider_id columns to logs"
```

---

### Task 5: Extend /api/logs with filter params (TDD)

**Files:**
- Create: `tests/api-logs.test.js`
- Modify: `src/db.js`
- Modify: `src/routes/api-logs.js`

- [ ] **Step 1: Write failing test for queryLogs filter params**

```javascript
// tests/api-logs.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { queryLogs } from '../src/db.js';

async function seed(db) {
  await db.exec(`DELETE FROM logs`);
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO logs (timestamp, model, method, path, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, request_body, response_body, cost_usd)
     VALUES (?, ?, 'POST', '/v1/chat/completions', ?, ?, 100, 200, 300, ?, ?, ?)`
  ).bind(now, 'gpt-4o', 200, 800, '{"q":"hello"}', '{"a":"world"}', 0.05).run();
  await db.prepare(
    `INSERT INTO logs (timestamp, model, method, path, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, request_body, response_body, cost_usd)
     VALUES (?, ?, 'POST', '/v1/chat/completions', ?, ?, 200, 400, 600, ?, ?, ?)`
  ).bind(now, 'claude-4', 429, 300, '{"q":"big"}', '{}', 0.0).run();
}

describe('queryLogs filters', () => {
  beforeEach(async () => { await seed(env.DB); });

  it('filters by model', async () => {
    const rows = await queryLogs(env.DB, { hours: 24, models: ['gpt-4o'] });
    expect(rows.length).toBe(1);
    expect(rows[0].model).toBe('gpt-4o');
  });

  it('filters by status range (4xx)', async () => {
    const rows = await queryLogs(env.DB, { hours: 24, statusBucket: '4xx' });
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe(429);
  });

  it('filters by full-text search on request_body', async () => {
    const rows = await queryLogs(env.DB, { hours: 24, search: 'big' });
    expect(rows.length).toBe(1);
    expect(rows[0].model).toBe('claude-4');
  });

  it('filters by min cost', async () => {
    const rows = await queryLogs(env.DB, { hours: 24, minCost: 0.01 });
    expect(rows.length).toBe(1);
    expect(rows[0].model).toBe('gpt-4o');
  });

  it('cursor-based pagination returns next page', async () => {
    const page1 = await queryLogs(env.DB, { hours: 24, limit: 1 });
    expect(page1.length).toBe(1);
    const page2 = await queryLogs(env.DB, { hours: 24, limit: 1, cursor: page1[0].id });
    expect(page2.length).toBe(1);
    expect(page2[0].id).not.toBe(page1[0].id);
  });
});
```

- [ ] **Step 2: Run the test, confirm failure**

Run: `npm test`
Expected: failures because new filter params not implemented yet

- [ ] **Step 3: Update src/db.js queryLogs**

```javascript
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
```

(Keep `insertLog`, `queryStats` as-is for now; update `insertLog` to also accept cost_usd, source, provider_id in Task 6.)

- [ ] **Step 4: Wire up new params in route handler**

```javascript
// src/routes/api-logs.js
import { queryLogs, queryStats, queryLogById } from '../db.js';

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
```

- [ ] **Step 5: Re-run tests, confirm pass**

Run: `npm test`
Expected: all 5 tests pass

- [ ] **Step 6: Commit**

```bash
git add tests/api-logs.test.js src/db.js src/routes/api-logs.js
git commit -m "feat(api): extend /api/logs with model/status/cost/search/cursor filters"
```

---

### Task 6: Build design-token styles.css

**Files:**
- Create: `public/styles.css`

- [ ] **Step 1: Write base CSS with design tokens, layout, components**

```css
/* public/styles.css */
:root {
  --bg-base: #0a0c12;
  --bg-elevated: #12151e;
  --bg-overlay: #1a1f2e;
  --bg-active: #2a2f3e;
  --border-subtle: #1e2330;
  --border-default: #2a2f3e;
  --border-strong: #3a4055;
  --text-primary: #e2e8f0;
  --text-secondary: #94a3b8;
  --text-tertiary: #64748b;
  --text-disabled: #475569;
  --accent-blue: #3b82f6;
  --accent-purple: #a78bfa;
  --accent-green: #4ade80;
  --accent-yellow: #fbbf24;
  --accent-red: #ef4444;
  --accent-pink: #f472b6;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --shadow-panel: 0 10px 40px rgba(0,0,0,0.4);
  --font-sans: -apple-system, "Inter", "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", Menlo, monospace;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  min-width: 1024px;
}

a { color: var(--accent-blue); text-decoration: none; }
button { font-family: inherit; cursor: pointer; }

/* App shell */
.app-shell { display: flex; height: 100vh; overflow: hidden; }
.sidebar {
  width: 200px;
  background: #0c0e14;
  border-right: 1px solid var(--border-subtle);
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.sidebar-brand {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 20px;
  padding: 4px 8px;
}
.sidebar-search {
  background: var(--bg-overlay);
  border-radius: var(--radius-md);
  padding: 8px 10px;
  margin-bottom: 16px;
  color: var(--text-tertiary);
  font-size: 12px;
  display: flex;
  justify-content: space-between;
  cursor: pointer;
}
.sidebar-search .kbd {
  background: var(--bg-active);
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
}
.sidebar-nav { display: flex; flex-direction: column; gap: 2px; }
.sidebar-nav a {
  padding: 8px 10px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: var(--radius-md);
  font-size: 13px;
}
.sidebar-nav a:hover { background: var(--bg-overlay); color: var(--text-primary); }
.sidebar-nav a.active {
  background: var(--bg-overlay);
  color: var(--text-primary);
}
.sidebar-footer { margin-top: auto; }

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.page-header {
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.page-title { font-size: 16px; font-weight: 600; }
.page-subtitle { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
.page-body { flex: 1; overflow-y: auto; padding: 20px 24px; }

/* Cards */
.card {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 14px;
}
.stat-card .label { font-size: 10px; color: var(--text-tertiary); text-transform: uppercase; }
.stat-card .value { font-size: 20px; font-weight: 600; color: var(--text-primary); margin-top: 4px; }
.stat-card .delta { font-size: 10px; margin-top: 4px; }
.stat-card .delta.up { color: var(--accent-red); }
.stat-card .delta.down { color: var(--accent-green); }

/* Filter bar */
.filter-bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.filter-chip {
  background: var(--bg-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 5px 10px;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}
.filter-chip.active { color: var(--text-primary); border-color: var(--accent-blue); }
.filter-search {
  flex: 1;
  min-width: 200px;
  background: var(--bg-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 6px 10px;
  color: var(--text-primary);
  font-size: 12px;
}
.filter-search:focus { outline: none; border-color: var(--accent-blue); }

/* Log list */
.log-grid {
  display: grid;
  grid-template-columns: 80px 110px 60px 70px 80px 80px 1fr;
  align-items: center;
}
.log-header {
  padding: 8px 16px;
  background: #0c0e14;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 10px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  position: sticky;
  top: 0;
  z-index: 1;
}
.log-row {
  padding: 10px 16px;
  border-bottom: 1px solid var(--bg-elevated);
  font-size: 12px;
  cursor: pointer;
}
.log-row:hover { background: var(--bg-overlay); }
.log-row.selected { background: var(--bg-overlay); border-left: 2px solid var(--accent-blue); }
.log-row.error-row { background: rgba(239,68,68,0.04); }
.log-row .mono { font-family: var(--font-mono); }

.tag { padding: 2px 6px; border-radius: 3px; font-size: 10px; font-family: var(--font-mono); width: fit-content; }
.tag-model-claude { background: #1e3a5f; color: #93c5fd; }
.tag-model-openai { background: #1a3a2f; color: #6ee7b7; }
.tag-model-deepseek { background: #2a1f3e; color: #c4b5fd; }
.tag-model-default { background: #334155; color: #cbd5e1; }
.tag-status-ok { color: var(--accent-green); }
.tag-status-err { color: var(--accent-red); }

/* Side panel */
.side-panel-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 50;
}
.side-panel {
  position: fixed;
  right: 0; top: 0;
  height: 100vh;
  width: 480px;
  background: var(--bg-base);
  border-left: 1px solid var(--border-subtle);
  z-index: 51;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-panel);
  transform: translateX(100%);
  transition: transform 0.18s ease;
}
.side-panel.open { transform: translateX(0); }
.side-panel-header {
  padding: 16px;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.side-panel-body { flex: 1; overflow-y: auto; padding: 16px; }

/* JSON viewer */
.json-viewer {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 10px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
}
.json-key { color: #93c5fd; }
.json-string { color: #6ee7b7; }
.json-number { color: #fbbf24; }
.json-bool { color: #c084fc; }

/* Realtime pulse */
.realtime-pulse {
  display: inline-block;
  width: 8px; height: 8px;
  background: var(--accent-green);
  border-radius: 50%;
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(74,222,128,0.7); }
  70% { box-shadow: 0 0 0 8px rgba(74,222,128,0); }
  100% { box-shadow: 0 0 0 0 rgba(74,222,128,0); }
}

/* Spinner (loading indicator for buttons) */
.spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--border-default);
  border-top-color: var(--accent-blue);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  vertical-align: -2px;
  margin-right: 6px;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
button:disabled, .filter-chip:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Login */
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}
.login-box {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 40px;
  width: 360px;
}
.login-input {
  width: 100%;
  padding: 12px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-default);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 14px;
  margin-bottom: 16px;
}
.login-input:focus { outline: none; border-color: var(--accent-blue); }
.login-button {
  width: 100%;
  padding: 12px;
  border-radius: var(--radius-lg);
  border: none;
  background: var(--accent-blue);
  color: white;
  font-size: 14px;
}
.login-error {
  color: var(--accent-red);
  font-size: 12px;
  text-align: center;
  margin-top: 12px;
  display: none;
}
.login-error.show { display: block; }

/* Scrollbar */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: var(--bg-base); }
::-webkit-scrollbar-thumb { background: var(--bg-active); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--border-strong); }
```

- [ ] **Step 2: Commit**

```bash
git add public/styles.css
git commit -m "feat(ui): add Linear-style design tokens and base CSS"
```

---

### Task 7: Build SPA shell + hash router

**Files:**
- Create: `public/app.js`
- Create: `public/lib/api.js`
- Create: `public/lib/router.js`

- [ ] **Step 1: Create public/lib/api.js (fetch wrapper with auth)**

```javascript
// public/lib/api.js
const TOKEN_KEY = 'api_token';

export function getToken() { return sessionStorage.getItem(TOKEN_KEY); }
export function setToken(t) { sessionStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { sessionStorage.removeItem(TOKEN_KEY); }

export async function api(path, opts = {}) {
  const token = getToken();
  if (!token) {
    window.location.href = '/login.html';
    throw new Error('no token');
  }
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    clearToken();
    window.location.href = '/login.html';
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json();
}
```

- [ ] **Step 2: Create public/lib/router.js (hash-based)**

```javascript
// public/lib/router.js
const routes = new Map();

export function registerRoute(path, handler) {
  routes.set(path, handler);
}

export function navigate(path) {
  window.location.hash = path;
}

export function getCurrentPath() {
  const h = window.location.hash.slice(1) || '/';
  return h;
}

export function startRouter(container) {
  const render = () => {
    const path = getCurrentPath();
    const handler = routes.get(path) || routes.get('/');
    if (!handler) {
      container.innerHTML = '<div class="page-body">404</div>';
      return;
    }
    container.innerHTML = '';
    handler(container);
  };
  window.addEventListener('hashchange', render);
  render();
}
```

- [ ] **Step 3: Create public/app.js entry point**

```javascript
// public/app.js
import { startRouter, registerRoute } from '/lib/router.js';
import { getToken } from '/lib/api.js';
import { renderSidebar } from '/components/sidebar.js';
import { renderLogs } from '/pages/logs.js';

if (!getToken()) {
  window.location.href = '/login.html';
}

const app = document.getElementById('app');
app.innerHTML = `
  <div class="app-shell">
    <aside id="sidebar"></aside>
    <main class="main" id="main"></main>
  </div>
`;

renderSidebar(document.getElementById('sidebar'));

// Phase 1: only Logs route; other routes added in later phases
registerRoute('/', (container) => renderLogs(container));
registerRoute('/logs', (container) => renderLogs(container));

startRouter(document.getElementById('main'));
```

- [ ] **Step 4: Commit**

```bash
git add public/lib public/app.js
git commit -m "feat(ui): SPA shell with hash router and API client"
```

---

### Task 8: Build sidebar component

**Files:**
- Create: `public/components/sidebar.js`

- [ ] **Step 1: Write sidebar with nav items (Health/Overview etc. show but only Logs active in Phase 1)**

```javascript
// public/components/sidebar.js
import { clearToken } from '/lib/api.js';
import { getCurrentPath } from '/lib/router.js';

const NAV = [
  { path: '/overview', icon: '📊', label: 'Overview', disabled: true },
  { path: '/logs', icon: '📋', label: 'Logs' },
  { path: '/analytics', icon: '📈', label: 'Analytics', disabled: true },
  { path: '/playground', icon: '🧪', label: 'Playground', disabled: true },
  { path: '/health', icon: '💚', label: 'Health', disabled: true },
];

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
           style="${item.disabled ? 'opacity:0.4;cursor:not-allowed' : ''}">
          <span>${item.icon}</span><span>${item.label}</span>
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
  // ⌘K placeholder — wired in Phase 5
  container.querySelector('#search-trigger').onclick = () => {
    alert('Command palette coming in Phase 5');
  };
  window.addEventListener('hashchange', () => renderSidebar(container));
}
```

- [ ] **Step 2: Commit**

```bash
git add public/components/sidebar.js
git commit -m "feat(ui): sidebar navigation component"
```

---

### Task 9: Build JSON viewer component

**Files:**
- Create: `public/components/json-viewer.js`

- [ ] **Step 1: Write JSON syntax-highlighted viewer**

```javascript
// public/components/json-viewer.js
export function renderJsonViewer(rawText) {
  if (!rawText) return '<div class="json-viewer">(空)</div>';
  let formatted;
  try {
    const parsed = JSON.parse(rawText);
    formatted = JSON.stringify(parsed, null, 2);
  } catch {
    return `<div class="json-viewer">${escapeHtml(rawText)}</div>`;
  }
  const highlighted = escapeHtml(formatted)
    .replace(/("(?:[^"\\]|\\.)*")(\s*:)/g, '<span class="json-key">$1</span>$2')
    .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span class="json-string">$1</span>')
    .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
    .replace(/:\s*(true|false|null)/g, ': <span class="json-bool">$1</span>');
  return `<div class="json-viewer">${highlighted}</div>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 2: Commit**

```bash
git add public/components/json-viewer.js
git commit -m "feat(ui): JSON syntax-highlighted viewer"
```

---

### Task 10: Build side-panel component

**Files:**
- Create: `public/components/side-panel.js`

- [ ] **Step 1: Write side panel with overlay + slide animation**

```javascript
// public/components/side-panel.js
export function openSidePanel({ title, bodyHtml }) {
  const existing = document.getElementById('side-panel-root');
  if (existing) existing.remove();

  const root = document.createElement('div');
  root.id = 'side-panel-root';
  root.innerHTML = `
    <div class="side-panel-overlay"></div>
    <aside class="side-panel">
      <div class="side-panel-header">
        <div style="font-weight:600">${title}</div>
        <button id="side-panel-close" style="background:none;border:none;color:var(--text-secondary);font-size:14px;">关闭</button>
      </div>
      <div class="side-panel-body" id="side-panel-body">${bodyHtml}</div>
    </aside>
  `;
  document.body.appendChild(root);

  // Trigger transition
  requestAnimationFrame(() => {
    root.querySelector('.side-panel').classList.add('open');
  });

  const close = () => {
    root.querySelector('.side-panel').classList.remove('open');
    setTimeout(() => root.remove(), 200);
  };
  root.querySelector('.side-panel-overlay').onclick = close;
  root.querySelector('#side-panel-close').onclick = close;

  return { close, body: root.querySelector('#side-panel-body') };
}
```

- [ ] **Step 2: Commit**

```bash
git add public/components/side-panel.js
git commit -m "feat(ui): generic slide-out side panel"
```

---

### Task 11: Build Logs page with filters and detail view

**Files:**
- Create: `public/pages/logs.js`

- [ ] **Step 1: Write Logs page with table, filters, detail panel, polling**

```javascript
// public/pages/logs.js
import { api } from '/lib/api.js';
import { renderJsonViewer } from '/components/json-viewer.js';
import { openSidePanel } from '/components/side-panel.js';

const state = {
  filters: { hours: 24, search: '', models: [], status: '', minDuration: null, maxDuration: null, minCost: null, maxCost: null },
  rows: [],
  lastFetch: 0,
  pollTimer: null,
};

const VIEWS_KEY = 'saved_views_v1';

export function renderLogs(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Logs</div>
        <div class="page-subtitle">实时日志浏览</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="realtime-pulse"></span>
        <span style="font-size:11px;color:var(--accent-green)">实时</span>
        <span id="last-update" style="font-size:11px;color:var(--text-tertiary);margin-left:8px"></span>
      </div>
    </div>
    <div style="padding:16px 24px;border-bottom:1px solid var(--border-subtle)" id="filter-bar"></div>
    <div class="page-body" id="logs-body">
      <div class="log-grid log-header">
        <span>时间</span><span>模型</span><span>状态</span><span>延迟</span><span>Tokens</span><span>费用</span><span>路径</span>
      </div>
      <div id="logs-list"><div style="padding:40px;text-align:center;color:var(--text-tertiary)">加载中...</div></div>
    </div>
  `;

  renderFilterBar(container.querySelector('#filter-bar'));
  fetchAndRender(container.querySelector('#logs-list'), container.querySelector('#last-update'));

  // Polling every 30s
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    fetchAndRender(container.querySelector('#logs-list'), container.querySelector('#last-update'));
  }, 30000);
}

function renderFilterBar(el) {
  el.className = 'filter-bar';
  el.innerHTML = `
    <input class="filter-search" id="search" placeholder="搜索请求 / 响应内容..." value="${state.filters.search}">
    <select class="filter-chip" id="hours">
      <option value="1">1h</option><option value="6">6h</option>
      <option value="24" selected>24h</option><option value="168">7d</option>
    </select>
    <select class="filter-chip" id="status">
      <option value="">所有状态</option>
      <option value="2xx">2xx 成功</option>
      <option value="4xx">4xx 客户端错误</option>
      <option value="5xx">5xx 服务端错误</option>
    </select>
    <button class="filter-chip" id="save-view">⭐ 保存视图</button>
    <select class="filter-chip" id="load-view">
      <option value="">已保存视图 ▾</option>
    </select>
  `;
  el.querySelector('#search').oninput = (e) => { state.filters.search = e.target.value; debounceFetch(); };
  el.querySelector('#hours').onchange = (e) => { state.filters.hours = parseInt(e.target.value, 10); doFetch(); };
  el.querySelector('#status').onchange = (e) => { state.filters.status = e.target.value; doFetch(); };
  el.querySelector('#save-view').onclick = saveCurrentView;
  populateSavedViews(el.querySelector('#load-view'));
  el.querySelector('#load-view').onchange = (e) => loadSavedView(e.target.value);
}

let debounceTimer;
function debounceFetch() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(doFetch, 300);
}

function doFetch() {
  const listEl = document.getElementById('logs-list');
  const updateEl = document.getElementById('last-update');
  if (listEl) fetchAndRender(listEl, updateEl);
}

async function fetchAndRender(listEl, updateEl) {
  const params = new URLSearchParams();
  const f = state.filters;
  params.set('hours', f.hours);
  if (f.search) params.set('search', f.search);
  if (f.status) params.set('status', f.status);
  for (const m of f.models) params.append('model', m);
  if (f.minDuration != null) params.set('min_duration', f.minDuration);
  if (f.maxDuration != null) params.set('max_duration', f.maxDuration);
  if (f.minCost != null) params.set('min_cost', f.minCost);
  if (f.maxCost != null) params.set('max_cost', f.maxCost);

  try {
    const rows = await api(`/api/logs?${params.toString()}`);
    state.rows = rows;
    state.lastFetch = Date.now();
    renderRows(listEl);
    if (updateEl) updateEl.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN');
  } catch (err) {
    listEl.innerHTML = `<div style="padding:40px;text-align:center;color:var(--accent-red)">${err.message}</div>`;
  }
}

function renderRows(listEl) {
  if (!state.rows.length) {
    listEl.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-tertiary)">暂无数据</div>';
    return;
  }
  listEl.innerHTML = state.rows.map(r => {
    const time = new Date(r.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
    const statusClass = r.status >= 200 && r.status < 300 ? 'tag-status-ok' : 'tag-status-err';
    const modelClass = modelTagClass(r.model);
    const errorRow = r.status >= 400 ? 'error-row' : '';
    return `
      <div class="log-grid log-row ${errorRow}" data-id="${r.id}">
        <span class="mono">${time}</span>
        <span><span class="tag ${modelClass}">${r.model}</span></span>
        <span class="mono ${statusClass}">${r.status}</span>
        <span class="mono">${r.duration_ms}ms</span>
        <span class="mono">${r.total_tokens || '—'}</span>
        <span class="mono" style="color:var(--accent-yellow)">${formatCost(r.cost_usd)}</span>
        <span class="mono" style="color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.path}</span>
      </div>`;
  }).join('');
  listEl.querySelectorAll('.log-row').forEach(row => {
    row.onclick = () => openDetail(parseInt(row.dataset.id, 10));
  });
}

function modelTagClass(model) {
  if (model && model.includes('claude')) return 'tag-model-claude';
  if (model && (model.includes('gpt') || model.includes('o1'))) return 'tag-model-openai';
  if (model && model.includes('deepseek')) return 'tag-model-deepseek';
  return 'tag-model-default';
}

function formatCost(cost) {
  if (!cost || cost === 0) return '—';
  if (cost < 0.001) return '<$0.001';
  return '$' + cost.toFixed(3);
}

async function openDetail(id) {
  const panel = openSidePanel({ title: `请求详情 #${id}`, bodyHtml: '<div>加载中...</div>' });
  try {
    const row = await api(`/api/logs/${id}`);
    panel.body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
        <div class="card"><div class="label">模型</div><div style="margin-top:4px;color:#93c5fd">${row.model}</div></div>
        <div class="card"><div class="label">状态</div><div style="margin-top:4px">${row.status}</div></div>
        <div class="card"><div class="label">延迟</div><div style="margin-top:4px">${row.duration_ms}ms</div></div>
        <div class="card"><div class="label">费用</div><div style="margin-top:4px;color:var(--accent-yellow)">${formatCost(row.cost_usd)}</div></div>
      </div>
      <div style="margin-bottom:12px"><div style="color:var(--text-secondary);font-size:11px;margin-bottom:6px">📥 Request</div>${renderJsonViewer(row.request_body)}</div>
      <div><div style="color:var(--text-secondary);font-size:11px;margin-bottom:6px">📤 Response</div>${renderJsonViewer(row.response_body)}</div>
    `;
  } catch (err) {
    panel.body.innerHTML = `<div style="color:var(--accent-red)">${err.message}</div>`;
  }
}

function saveCurrentView() {
  const name = prompt('视图名称：');
  if (!name) return;
  const saved = JSON.parse(localStorage.getItem(VIEWS_KEY) || '{}');
  saved[name] = { ...state.filters };
  localStorage.setItem(VIEWS_KEY, JSON.stringify(saved));
  populateSavedViews(document.getElementById('load-view'));
  alert('已保存：' + name);
}

function populateSavedViews(selectEl) {
  if (!selectEl) return;
  const saved = JSON.parse(localStorage.getItem(VIEWS_KEY) || '{}');
  selectEl.innerHTML = '<option value="">已保存视图 ▾</option>' +
    Object.keys(saved).map(k => `<option value="${k}">${k}</option>`).join('');
}

function loadSavedView(name) {
  if (!name) return;
  const saved = JSON.parse(localStorage.getItem(VIEWS_KEY) || '{}');
  if (saved[name]) {
    state.filters = { ...state.filters, ...saved[name] };
    document.getElementById('search').value = state.filters.search || '';
    document.getElementById('hours').value = state.filters.hours;
    document.getElementById('status').value = state.filters.status;
    doFetch();
  }
}
```

- [ ] **Step 2: Verify in dev**

Run: `npm run dev`
Then open http://localhost:8787, login, verify logs page loads with filters + detail panel.

- [ ] **Step 3: Commit**

```bash
git add public/pages/logs.js
git commit -m "feat(ui): Logs page with filters, side-panel detail, real-time polling, saved views"
```

---

### Task 12: Build Login page as static asset

**Files:**
- Modify: `public/login.html`
- Create: `public/login.js`

- [ ] **Step 1: Update public/login.html with login form**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登录 - LosFurina</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div class="login-container">
    <div class="login-box">
      <h1 style="font-size:1.25rem;color:var(--accent-blue);margin-bottom:8px;text-align:center">⚡ LosFurina AI Provider</h1>
      <p style="font-size:0.875rem;color:var(--text-secondary);margin-bottom:24px;text-align:center">请输入 API Key 登录</p>
      <input type="password" class="login-input" id="password" placeholder="API Key" autofocus>
      <button class="login-button" id="login-btn">登录</button>
      <div class="login-error" id="error">密钥错误，请重试</div>
    </div>
  </div>
  <script type="module" src="/login.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create public/login.js**

```javascript
// public/login.js
async function login() {
  const pwd = document.getElementById('password').value;
  if (!pwd) return;
  const err = document.getElementById('error');
  err.classList.remove('show');
  try {
    const res = await fetch('/api/logs?hours=1', {
      headers: { 'Authorization': 'Bearer ' + pwd }
    });
    if (!res.ok) throw new Error('Unauthorized');
    sessionStorage.setItem('api_token', pwd);
    window.location.href = '/';
  } catch (e) {
    err.classList.add('show');
  }
}

document.getElementById('login-btn').onclick = login;
document.getElementById('password').addEventListener('keydown', e => {
  if (e.key === 'Enter') login();
});
```

- [ ] **Step 3: Remove inline login/dashboard from src/index.js (already done in Task 3, just verify)**

Run: `grep -n "serveLoginPage\|serveDashboard" src/index.js`
Expected: no matches (was removed in Task 3 refactor)

- [ ] **Step 4: Commit**

```bash
git add public/login.html public/login.js
git commit -m "feat(ui): static login page"
```

---

### Task 13: End-to-end smoke test + deploy

- [ ] **Step 1: Run local dev and smoke test**

Run: `npm run dev`
Then in browser:
1. Visit http://localhost:8787 — should redirect to /login.html
2. Login with WORKER_API_KEY — should redirect to /
3. Logs page loads, filters work, detail panel opens, JSON renders correctly
4. Verify polling: wait 30s, check "更新于" timestamp updates

- [ ] **Step 2: Make a real proxy request to populate logs**

```bash
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer <WORKER_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}'
```

Reload Logs page, confirm row appears.

- [ ] **Step 3: Deploy to Cloudflare**

Run: `npm run deploy`
Expected: deploy succeeds, output shows URL.

- [ ] **Step 4: Verify production**

Visit deployed URL, repeat login + logs verification.

- [ ] **Step 5: Commit deployment record (if any config changed during smoke test)**

```bash
git status
# If anything changed:
git add <files>
git commit -m "chore: phase 1 deployment ready"
```

---

## Self-Review Checklist

After completing all tasks, verify against spec sections 3, 4, 5.2, 6.1, 6.2:

- [ ] Static Assets serving `index.html`, `styles.css`, `app.js` (spec 3.1)
- [ ] File structure matches spec 3.2 (public/ + routes/ split)
- [ ] Design tokens applied (spec 4.1)
- [ ] Sidebar + main layout works (spec 4.2)
- [ ] Logs page has search, model filter, status filter, cost filter (spec 5.2)
- [ ] Detail side panel with request/response JSON (spec 5.2)
- [ ] Real-time 30s polling (spec 5.2)
- [ ] Saved views via localStorage (spec 5.2)
- [ ] `/api/logs/:id` endpoint added (spec 6.1)
- [ ] Cursor pagination (spec 6.1)
- [ ] Full-text search on request/response (spec 6.1)
- [ ] All commits follow conventional commits format

Items deferred to later phases (NOT in Phase 1 scope):
- ⌘K command palette (Phase 5)
- Overview / Analytics / Playground / Health pages (Phases 2-3)
- Settings page (Phase 4)
- Alerts banner (Phase 4)
