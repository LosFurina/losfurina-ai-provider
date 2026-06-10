# LosFurina AI Provider Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Cloudflare Worker that acts as a transparent AI API gateway with D1 logging and Telegram notifications.

**Architecture:** Single Worker with modular internal structure. Requests come in OpenAI format, get authenticated, transparently forwarded to a custom target endpoint, logged to D1, and optionally notified via Telegram. A built-in dashboard at `/` provides log viewing.

**Tech Stack:** Cloudflare Workers, D1 (SQLite), Telegram Bot API, native Web APIs only (no npm dependencies)

---

### Task 1: Project Scaffolding

**Files:**
- Create: `wrangler.toml`
- Create: `package.json`
- Create: `src/index.js` (minimal stub)

- [ ] **Step 1: Create wrangler.toml**

```toml
name = "losfurina-ai-provider"
main = "src/index.js"
compatibility_date = "2026-06-10"

# D1 Database binding
[[d1_databases]]
binding = "DB"
database_name = "losfurina-logs"
database_id = "local-dev"

# Environment variables (secrets managed via `wrangler secret put`)
[vars]
# TELEGRAM_BOT_TOKEN = ""    # set via wrangler secret
# TELEGRAM_CHAT_ID = ""      # set via wrangler secret
# WORKER_API_KEY = ""        # set via wrangler secret
# TARGET_URL = ""            # set via wrangler secret
# TARGET_API_KEY = ""        # set via wrangler secret
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "losfurina-ai-provider",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "db:create": "wrangler d1 create losfurina-logs",
    "db:migrate": "wrangler d1 execute losfurina-logs --file=./schema.sql",
    "db:local": "wrangler d1 execute losfurina-logs --local --file=./schema.sql"
  },
  "devDependencies": {
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 3: Create schema.sql**

```sql
CREATE TABLE IF NOT EXISTS logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp      TEXT NOT NULL,
  model          TEXT NOT NULL,
  method         TEXT NOT NULL,
  path           TEXT NOT NULL,
  status         INTEGER NOT NULL,
  duration_ms    INTEGER NOT NULL,
  prompt_tokens      INTEGER DEFAULT 0,
  completion_tokens  INTEGER DEFAULT 0,
  total_tokens       INTEGER DEFAULT 0,
  request_summary    TEXT,
  response_summary   TEXT
);

CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_model ON logs(model);
```

- [ ] **Step 4: Create src/index.js stub**

```js
export default {
  async fetch(request, env, ctx) {
    return new Response('Hello from LosFurina AI Provider Proxy', { status: 200 });
  }
};
```

- [ ] **Step 5: Verify wrangler can parse config**

Run: `cd /Users/wayne/Desktop/workspace/repos/losfurina-ai-provider && npx wrangler --version`
Expected: wrangler version printed without errors

- [ ] **Step 6: Commit**

```bash
git add wrangler.toml package.json schema.sql src/index.js
git commit -m "chore: project scaffolding"
```

---

### Task 2: Config Module

**Files:**
- Create: `src/config.js`

- [ ] **Step 1: Create src/config.js**

```js
/**
 * Centralized configuration reader.
 * All env vars accessed through this module.
 */
export function getConfig(env) {
  return {
    workerApiKey: env.WORKER_API_KEY || '',
    targetUrl: env.TARGET_URL || '',
    targetApiKey: env.TARGET_API_KEY || '',
    telegramBotToken: env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: env.TELEGRAM_CHAT_ID || '',
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/config.js
git commit -m "feat: add config module"
```

---

### Task 3: Auth Module

**Files:**
- Create: `src/auth.js`

- [ ] **Step 1: Create src/auth.js**

```js
/**
 * Authentication module.
 * Validates Bearer token against WORKER_API_KEY.
 */
export function authenticate(request, config) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, body: { error: { message: 'Missing or invalid Authorization header', type: 'auth_error' } } };
  }
  const token = authHeader.slice(7);
  if (token !== config.workerApiKey) {
    return { ok: false, status: 401, body: { error: { message: 'Invalid API key', type: 'auth_error' } } };
  }
  return { ok: true };
}

export function unauthorizedResponse() {
  return new Response(
    JSON.stringify({ error: { message: 'Unauthorized', type: 'auth_error' } }),
    { status: 401, headers: { 'Content-Type': 'application/json' } }
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/auth.js
git commit -m "feat: add auth module"
```

---

### Task 4: DB Module

**Files:**
- Create: `src/db.js`

- [ ] **Step 1: Create src/db.js**

```js
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
```

- [ ] **Step 2: Commit**

```bash
git add src/db.js
git commit -m "feat: add D1 database module"
```

---

### Task 5: Telegram Module

**Files:**
- Create: `src/telegram.js`

- [ ] **Step 1: Create src/telegram.js**

```js
/**
 * Telegram Bot API notification sender.
 */
export async function sendTelegramMessage(config, text) {
  if (!config.telegramBotToken || !config.telegramChatId) {
    return; // Telegram not configured, silently skip
  }
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text: text,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
      }),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Telegram send failed:', response.status, errorBody);
    }
  } catch (err) {
    console.error('Telegram send error:', err.message);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/telegram.js
git commit -m "feat: add Telegram notification module"
```

---

### Task 6: Buffer Module

**Files:**
- Create: `src/buffer.js`

- [ ] **Step 1: Create src/buffer.js**

```js
/**
 * In-memory log buffer queue.
 * Accumulates log entries and flushes to Telegram on:
 * - Queue reaches MAX_SIZE (5 entries)
 * - FLUSH_INTERVAL (30 seconds) elapsed since first entry
 * Does nothing when queue is empty.
 *
 * Note: Workers can be evicted at any time, so buffered logs may be lost.
 * This is acceptable for low-traffic personal use.
 */
const MAX_SIZE = 5;
const FLUSH_INTERVAL_MS = 30_000;

export class LogBuffer {
  constructor() {
    this.queue = [];
    this.timer = null;
  }

  push(logEntry, flushFn) {
    this.queue.push(logEntry);

    // If queue was empty, start the flush timer
    if (this.queue.length === 1) {
      this.timer = setTimeout(() => this.flush(flushFn), FLUSH_INTERVAL_MS);
    }

    // Queue is full, flush immediately
    if (this.queue.length >= MAX_SIZE) {
      this.flush(flushFn);
    }
  }

  flush(flushFn) {
    if (this.queue.length === 0) return;

    clearTimeout(this.timer);
    this.timer = null;

    const entries = this.queue;
    this.queue = [];

    flushFn(entries);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/buffer.js
git commit -m "feat: add log buffer module"
```

---

### Task 7: Logger Module

**Files:**
- Create: `src/logger.js`

- [ ] **Step 1: Create src/logger.js**

```js
/**
 * Formats log entries into Markdown for Telegram.
 */

function escapeMarkdownV2(text) {
  // MarkdownV2 requires escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

export function formatLogEntry(logEntry) {
  const { model, method, path, status, durationMs, promptTokens, completionTokens, totalTokens, requestSummary, responseSummary } = logEntry;
  const statusIcon = status >= 200 && status < 300 ? '✅' : status >= 400 ? '❌' : '⚠️';
  const time = new Date(logEntry.timestamp).toLocaleTimeString('zh-CN', { hour12: false });

  const lines = [
    `*${escapeMarkdownV2(time)}* ${statusIcon}`,
    `**模型:** \`${escapeMarkdownV2(model)}\``,
    `**路径:** \`${escapeMarkdownV2(method)} ${escapeMarkdownV2(path)}\``,
    '',
    '**📊 Token 用量**',
    `| 类型 | 数量 |`,
    `|------|------|`,
    `| 🆔 Prompt | ${promptTokens} |`,
    `| 💡 Completion | ${completionTokens} |`,
    `| 📦 总计 | ${totalTokens} |`,
    '',
    `**⏱ 性能**`,
    `- **耗时:** ${durationMs}ms`,
    `- **状态码:** ${status} ${statusIcon}`,
  ];

  if (requestSummary) {
    lines.push('', '**📥 请求摘要**', '```', escapeMarkdownV2(requestSummary), '```');
  }

  if (responseSummary) {
    lines.push('', '**📤 响应摘要**', '```', escapeMarkdownV2(responseSummary), '```');
  }

  return lines.join('\n');
}

export function formatBatchLog(entries) {
  return entries.map(entry => formatLogEntry(entry)).join('\n\n---\n\n');
}

export function summarizeBody(text, maxLen = 300) {
  if (!text) return '';
  // Try to parse as JSON and extract content / messages for a meaningful summary
  try {
    const parsed = JSON.parse(text);
    if (parsed.messages && Array.isArray(parsed.messages)) {
      const lastUserMsg = parsed.messages.filter(m => m.role === 'user').pop();
      if (lastUserMsg?.content) {
        const content = typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content);
        return content.slice(0, maxLen);
      }
    }
    if (parsed.content) {
      const content = typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content);
      return content.slice(0, maxLen);
    }
  } catch {}
  return text.slice(0, maxLen);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/logger.js
git commit -m "feat: add logger module for Markdown formatting"
```

---

### Task 8: Main Entry Point (index.js)

**Files:**
- Create: `src/index.js` (overwrite stub)
- These modules are already created: config.js, auth.js, db.js, telegram.js, buffer.js, logger.js

- [ ] **Step 1: Create src/index.js**

```js
import { getConfig } from './config.js';
import { authenticate, unauthorizedResponse } from './auth.js';
import { insertLog, queryLogs, queryStats } from './db.js';
import { sendTelegramMessage } from './telegram.js';
import { LogBuffer } from './buffer.js';
import { formatBatchLog, summarizeBody } from './logger.js';

// Global buffer instance per isolate
const logBuffer = new LogBuffer();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const config = getConfig(env);

    // Health check — no auth required
    if (url.pathname === '/health' && request.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Auth check for all other routes
    const auth = authenticate(request, config);
    if (!auth.ok) {
      return unauthorizedResponse();
    }

    // Route handling
    if (url.pathname === '/' || url.pathname === '/dashboard') {
      return serveDashboard(env);
    }

    if (url.pathname === '/api/logs') {
      return serveLogsApi(request, env);
    }

    // OpenAI proxy endpoints — must have a target configured
    if (!config.targetUrl) {
      return new Response(JSON.stringify({ error: { message: 'Target URL not configured', type: 'config_error' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'POST' && ['/v1/chat/completions', '/v1/completions', '/v1/embeddings'].includes(url.pathname)) {
      return proxyRequest(request, config, env, ctx);
    }

    if (request.method === 'GET' && url.pathname === '/v1/models') {
      return proxyRequest(request, config, env, ctx);
    }

    // 404 for everything else
    return new Response(JSON.stringify({ error: { message: 'Not Found', type: 'not_found' } }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

async function proxyRequest(request, config, env, ctx) {
  const startTime = Date.now();
  const requestBody = await request.clone().text();

  // Read model from request body (for POST requests)
  let model = 'unknown';
  try {
    if (requestBody) {
      const parsed = JSON.parse(requestBody);
      model = parsed.model || 'unknown';
    }
  } catch {}

  // Forward the request to target
  try {
    const targetResponse = await fetch(config.targetUrl + new URL(request.url).pathname, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.targetApiKey}`,
      },
      body: request.method === 'GET' ? undefined : requestBody,
    });

    // Clone response to read body for logging
    const responseClone = targetResponse.clone();
    const responseBody = await responseClone.text();
    const durationMs = Date.now() - startTime;

    // Extract token usage
    let promptTokens = 0, completionTokens = 0, totalTokens = 0;
    try {
      const parsed = JSON.parse(responseBody);
      if (parsed.usage) {
        promptTokens = parsed.usage.prompt_tokens || 0;
        completionTokens = parsed.usage.completion_tokens || 0;
        totalTokens = parsed.usage.total_tokens || 0;
      }
    } catch {}

    // Build log entry
    const logEntry = {
      timestamp: new Date().toISOString(),
      model,
      method: request.method,
      path: new URL(request.url).pathname,
      status: targetResponse.status,
      durationMs,
      promptTokens,
      completionTokens,
      totalTokens,
      requestSummary: summarizeBody(requestBody),
      responseSummary: summarizeBody(responseBody),
    };

    // Write to D1
    ctx.waitUntil(insertLog(env.DB, logEntry).catch(err => {
      console.error('D1 insert error:', err.message);
    }));

    // Buffer for Telegram notification
    const flushFn = async (entries) => {
      const message = formatBatchLog(entries);
      await sendTelegramMessage(config, message);
    };
    logBuffer.push({ timestamp: logEntry.timestamp, ...logEntry }, flushFn);

    // Return response to client
    return new Response(responseBody, {
      status: targetResponse.status,
      statusText: targetResponse.statusText,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error('Proxy error:', err.message);

    return new Response(JSON.stringify({ error: { message: 'Upstream request failed', detail: err.message, type: 'proxy_error' } }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function serveDashboard(env) {
  // Inline the HTML for zero-dependency deployment
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LosFurina AI Provider - 日志看板</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 20px; color: #38bdf8; }
    .filters { margin-bottom: 20px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .filters label { font-size: 0.875rem; color: #94a3b8; }
    .filters select, .filters button { padding: 6px 12px; border-radius: 6px; border: 1px solid #334155; background: #1e293b; color: #e2e8f0; font-size: 0.875rem; }
    .filters button { background: #2563eb; border-color: #2563eb; cursor: pointer; }
    .filters button:hover { background: #1d4ed8; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .stat-card { background: #1e293b; border-radius: 8px; padding: 16px; border: 1px solid #334155; }
    .stat-card .label { font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; }
    .stat-card .value { font-size: 1.5rem; font-weight: 600; color: #38bdf8; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th { text-align: left; padding: 10px 8px; border-bottom: 2px solid #334155; color: #94a3b8; font-weight: 600; }
    td { padding: 10px 8px; border-bottom: 1px solid #1e293b; }
    tr:hover { background: #1e293b; }
    .status-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; }
    .status-ok { background: #065f46; color: #6ee7b7; }
    .status-err { background: #7f1d1d; color: #fca5a5; }
    .model-tag { background: #1e3a5f; color: #93c5fd; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; }
    .loading { text-align: center; padding: 40px; color: #64748b; }
    .error { color: #fca5a5; padding: 20px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 LosFurina AI Provider 日志看板</h1>

    <div class="filters">
      <label for="hours">时间范围:</label>
      <select id="hours">
        <option value="1">最近 1 小时</option>
        <option value="6">最近 6 小时</option>
        <option value="24" selected>最近 24 小时</option>
        <option value="168">最近 7 天</option>
      </select>
      <button onclick="refresh()">刷新</button>
      <span id="refresh-time" style="font-size:0.75rem;color:#64748b;"></span>
    </div>

    <div class="stats-grid" id="stats"></div>
    <table id="logs-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>模型</th>
          <th>方法</th>
          <th>路径</th>
          <th>状态</th>
          <th>耗时</th>
          <th>Prompt</th>
          <th>Completion</th>
          <th>总计 Tokens</th>
        </tr>
      </thead>
      <tbody id="logs-body">
        <tr><td colspan="9" class="loading">加载中...</td></tr>
      </tbody>
    </table>
  </div>
  <script>
    async function refresh() {
      const hours = document.getElementById('hours').value;
      document.getElementById('refresh-time').textContent = '刷新中...';

      try {
        // Fetch stats
        const statsRes = await fetch('/api/logs/stats?hours=' + hours);
        const stats = await statsRes.json();

        const statsGrid = document.getElementById('stats');
        statsGrid.innerHTML = '';
        for (const row of stats) {
          const card = document.createElement('div');
          card.className = 'stat-card';
          card.innerHTML = \`
            <div class="label">\${row.model}</div>
            <div class="value">\${row.request_count}</div>
            <div style="font-size:0.75rem;color:#94a3b8;">\${row.total_tokens} tokens · \${row.avg_duration_ms}ms</div>
          \`;
          statsGrid.appendChild(card);
        }

        // Fetch logs
        const logsRes = await fetch('/api/logs?hours=' + hours);
        const logs = await logsRes.json();

        const tbody = document.getElementById('logs-body');
        tbody.innerHTML = '';

        if (logs.length === 0) {
          tbody.innerHTML = '<tr><td colspan="9" class="loading">暂无数据</td></tr>';
          return;
        }

        for (const row of logs) {
          const tr = document.createElement('tr');
          const time = new Date(row.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
          const statusClass = row.status >= 200 && row.status < 300 ? 'status-ok' : 'status-err';
          tr.innerHTML = \`
            <td>\${time}</td>
            <td><span class="model-tag">\${row.model}</span></td>
            <td>\${row.method}</td>
            <td>\${row.path}</td>
            <td><span class="status-badge \${statusClass}">\${row.status}</span></td>
            <td>\${row.duration_ms}ms</td>
            <td>\${row.prompt_tokens}</td>
            <td>\${row.completion_tokens}</td>
            <td>\${row.total_tokens}</td>
          \`;
          tbody.appendChild(tr);
        }

        document.getElementById('refresh-time').textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN');
      } catch (err) {
        document.getElementById('logs-body').innerHTML = '<tr><td colspan="9" class="error">加载失败: ' + err.message + '</td></tr>';
      }
    }

    // Auto-refresh every 30 seconds
    refresh();
    setInterval(refresh, 30000);
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function serveLogsApi(request, env) {
  const url = new URL(request.url);
  const hours = parseInt(url.searchParams.get('hours') || '24', 10);

  try {
    // /api/logs/stats — aggregated stats
    if (url.pathname === '/api/logs/stats') {
      const stats = await queryStats(env.DB, { hours });
      return new Response(JSON.stringify(stats), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // /api/logs — raw log entries
    const logs = await queryLogs(env.DB, { hours });
    return new Response(JSON.stringify(logs), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
```

- [ ] **Step 2: Remove old stub and verify**

```bash
# The file has been rewritten above, no additional step needed
```

- [ ] **Step 3: Commit**

```bash
git add src/index.js
git commit -m "feat: main entry point with proxy, dashboard, and logging"
```

---

### Task 9: Final Verification

- [ ] **Step 1: Verify all files exist**

Run: `cd /Users/wayne/Desktop/workspace/repos/losfurina-ai-provider && ls -la src/`
Expected:
```
auth.js
buffer.js
config.js
db.js
index.js
logger.js
telegram.js
```

- [ ] **Step 2: Verify wrangler config validity**

Run: `cd /Users/wayne/Desktop/workspace/repos/losfurina-ai-provider && npx wrangler deploy --dry-run`
Expected: No errors, shows deployment plan

- [ ] **Step 3: Final commit summary**

```bash
git add -A
git commit -m "chore: final verification and cleanup"
```
