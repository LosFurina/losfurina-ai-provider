import { getConfig } from './config.js';
import { authenticate, unauthorizedResponse } from './auth.js';
import { insertLog, queryLogs, queryStats } from './db.js';
import { sendTelegramMessage } from './telegram.js';
import { LogBuffer } from './buffer.js';
import { formatBatchLog } from './logger.js';

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

    // Login page — no auth required
    if (url.pathname === '/login') {
      return serveLoginPage();
    }

    // Dashboard page — no auth required (JS handles auth via sessionStorage)
    if (url.pathname === '/' || url.pathname === '/dashboard') {
      return serveDashboard();
    }

    // Auth check for all other routes (API, proxy, etc.)
    const auth = authenticate(request, config);
    if (!auth.ok) {
      return unauthorizedResponse();
    }

    // API routes
    if (url.pathname === '/api/logs' || url.pathname === '/api/logs/stats') {
      return serveLogsApi(request, env);
    }

    // OpenAI proxy endpoints — must have a target configured
    if (!config.targetUrl) {
      return new Response(JSON.stringify({ error: { message: 'Target URL not configured', type: 'config_error' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname.startsWith('/v1/')) {
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

  let model = 'unknown';
  try {
    if (requestBody) {
      const parsed = JSON.parse(requestBody);
      model = parsed.model || 'unknown';
    }
  } catch {}

  try {
    const targetUrl = new URL(request.url).pathname;
    const targetResponse = await fetch(new URL(targetUrl, config.targetUrl).toString(), {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.targetApiKey}`,
      },
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
      headers: { 'Content-Type': 'application/json' },
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

function serveLoginPage() {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LosFurina - 登录</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .login-box { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 40px; width: 360px; }
    h1 { font-size: 1.25rem; color: #38bdf8; margin-bottom: 8px; text-align: center; }
    p { font-size: 0.875rem; color: #94a3b8; margin-bottom: 24px; text-align: center; }
    input { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0; font-size: 1rem; margin-bottom: 16px; }
    input:focus { outline: none; border-color: #38bdf8; }
    button { width: 100%; padding: 12px; border-radius: 8px; border: none; background: #2563eb; color: white; font-size: 1rem; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    .error { color: #fca5a5; font-size: 0.875rem; text-align: center; margin-top: 12px; display: none; }
  </style>
</head>
<body>
  <div class="login-box">
    <h1>📊 LosFurina AI Provider</h1>
    <p>请输入 API Key 登录查看日志</p>
    <input type="password" id="password" placeholder="API Key" autofocus>
    <button onclick="login()">登录</button>
    <div class="error" id="error">密钥错误，请重试</div>
  </div>
  <script>
    async function login() {
      const pwd = document.getElementById('password').value;
      if (!pwd) return;
      try {
        const res = await fetch('/api/logs?hours=1', {
          headers: { 'Authorization': 'Bearer ' + pwd }
        });
        if (!res.ok) throw new Error('Unauthorized');
        sessionStorage.setItem('api_token', pwd);
        window.location.href = '/';
      } catch (e) {
        document.getElementById('error').style.display = 'block';
      }
    }
    document.getElementById('password').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function serveDashboard() {
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
    .logout-btn { font-size: 0.75rem; color: #94a3b8; cursor: pointer; margin-left: auto; }
    .logout-btn:hover { color: #fca5a5; }
    .header-bar { display: flex; align-items: center; margin-bottom: 20px; }
    .header-bar h1 { margin-bottom: 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-bar">
      <h1>📊 LosFurina AI Provider 日志看板</h1>
      <span class="logout-btn" onclick="logout()" style="margin-left:auto;">退出登录</span>
    </div>

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
          <th>状态</th>
          <th>耗时</th>
          <th>Prompt</th>
          <th>Completion</th>
          <th>总计 Tokens</th>
          <th>内容</th>
        </tr>
      </thead>
      <tbody id="logs-body">
        <tr><td colspan="8" class="loading">加载中...</td></tr>
      </tbody>
    </table>
  </div>
  <script>
    const API_TOKEN = sessionStorage.getItem('api_token');
    if (!API_TOKEN) {
      window.location.href = '/login';
    }

    async function refresh() {
      const hours = document.getElementById('hours').value;
      document.getElementById('refresh-time').textContent = '刷新中...';

      const headers = { 'Authorization': 'Bearer ' + API_TOKEN };

      try {
        const statsRes = await fetch('/api/logs/stats?hours=' + hours, { headers });
        if (!statsRes.ok) { sessionStorage.removeItem('api_token'); window.location.href = '/login'; return; }
        const stats = await statsRes.json();

        const statsGrid = document.getElementById('stats');
        statsGrid.innerHTML = '';
        for (const row of stats) {
          const card = document.createElement('div');
          card.className = 'stat-card';
          card.innerHTML = \`<div class="label">\${row.model}</div><div class="value">\${row.request_count}</div><div style="font-size:0.75rem;color:#94a3b8;">\${row.total_tokens} tokens · \${row.avg_duration_ms}ms</div>\`;
          statsGrid.appendChild(card);
        }

        const logsRes = await fetch('/api/logs?hours=' + hours, { headers });
        const logs = await logsRes.json();

        const tbody = document.getElementById('logs-body');
        tbody.innerHTML = '';

        if (logs.length === 0) {
          tbody.innerHTML = '<tr><td colspan="8" class="loading">暂无数据</td></tr>';
          return;
        }

        for (const row of logs) {
          const tr = document.createElement('tr');
          tr.style.cursor = 'pointer';
          const time = new Date(row.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
          const statusClass = row.status >= 200 && row.status < 300 ? 'status-ok' : 'status-err';
          tr.innerHTML = \`<td>\${time}</td><td><span class="model-tag">\${row.model}</span></td><td><span class="status-badge \${statusClass}">\${row.status}</span></td><td>\${row.duration_ms}ms</td><td>\${row.prompt_tokens}</td><td>\${row.completion_tokens}</td><td>\${row.total_tokens}</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">\${escHtml((row.request_body||'').slice(0,80))}</td>\`;

          const detailRow = document.createElement('tr');
          detailRow.style.display = 'none';
          detailRow.innerHTML = \`<td colspan="8" style="background:#0f172a;padding:16px;"><div style="border:1px solid #334155;border-radius:8px;padding:12px;margin-bottom:8px;"><div style="color:#94a3b8;font-size:0.75rem;margin-bottom:4px;">📥 请求 (Request)</div><pre style="white-space:pre-wrap;word-break:break-word;margin:0;font-size:0.8rem;color:#e2e8f0;">\${prettyPrint(row.request_body)}</pre></div><div style="border:1px solid #334155;border-radius:8px;padding:12px;"><div style="color:#94a3b8;font-size:0.75rem;margin-bottom:4px;">📤 响应 (Response)</div><pre style="white-space:pre-wrap;word-break:break-word;margin:0;font-size:0.8rem;color:#e2e8f0;">\${prettyPrint(row.response_body)}</pre></div></td>\`;

          tr.addEventListener('click', () => {
            detailRow.style.display = detailRow.style.display === 'none' ? 'table-row' : 'none';
          });

          tbody.appendChild(tr);
          tbody.appendChild(detailRow);
        }

        document.getElementById('refresh-time').textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN');
      } catch (err) {
        document.getElementById('logs-body').innerHTML = '<tr><td colspan="8" class="error">加载失败: ' + err.message + '</td></tr>';
      }
    }

    function prettyPrint(str) {
      if (!str) return escHtml('(空)');
      try {
        const parsed = JSON.parse(str);
        const formatted = JSON.stringify(parsed, null, 2);
        // Syntax highlight: keys (blue), strings (green), numbers (orange), booleans/null (purple)
        const highlighted = formatted
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/("(?:[^"\\\\]|\\.)*")\\s*:/g, '<span style="color:#93c5fd">$1</span>:')
          .replace(/:\\s*("(?:[^"\\\\]|\\.)*")/g, ': <span style="color:#6ee7b7">$1</span>')
          .replace(/:\\s*(-?\\d+\\.?\\d*)/g, ': <span style="color:#fbbf24">$1</span>')
          .replace(/:\\s*(true|false|null)/g, ': <span style="color:#c084fc">$1</span>');
        return highlighted;
      } catch {}
      return escHtml(str);
    }

    function escHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    function logout() {
      sessionStorage.removeItem('api_token');
      window.location.href = '/login';
    }

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
    if (url.pathname === '/api/logs/stats') {
      const stats = await queryStats(env.DB, { hours });
      return new Response(JSON.stringify(stats), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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
