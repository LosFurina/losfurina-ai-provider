# Phase 2: Overview + Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Overview page (4 KPI cards + 7-day trend chart + recent errors) and Analytics page (cost summary + cost trend + model donut + breakdown table), backed by a new `/api/logs/timeseries` endpoint and `/api/logs/kpis` aggregate endpoint. Integrate uPlot for charts.

**Architecture:** Two new SPA pages using uPlot for performant time-series rendering. Two new backend endpoints serving aggregated bucketed data. Bucket granularity adapts to time range (hourly for ≤7d, daily for >7d).

**Tech Stack:** Cloudflare Workers, D1, uPlot 1.6 (CDN-bundled), vanilla DOM, SQLite `strftime` for bucket aggregation.

**Spec reference:** `docs/superpowers/specs/2026-06-10-dashboard-v2-design.md` sections 5.1, 5.3, 6.1, 6.2.

**Prerequisite:** Phase 1 complete (Static Assets, routes split, base UI components exist).

---

### Task 1: Add /api/logs/kpis aggregate endpoint (TDD)

**Files:**
- Create: `tests/api-kpis.test.js`
- Modify: `src/db.js`
- Modify: `src/routes/api-logs.js`

- [ ] **Step 1: Write failing test for queryKpis**

```javascript
// tests/api-kpis.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { queryKpis } from '../src/db.js';

async function seed(db) {
  await db.exec(`DELETE FROM logs`);
  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  // 2 successes today, 1 error today, 1 success yesterday (outside 24h window)
  await db.prepare(
    `INSERT INTO logs (timestamp, model, method, path, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, cost_usd, request_body, response_body)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(now, 'gpt-4o', 'POST', '/v1/c', 200, 800, 100, 200, 300, 0.05, '{}', '{}').run();
  await db.prepare(
    `INSERT INTO logs (timestamp, model, method, path, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, cost_usd, request_body, response_body)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(now, 'gpt-4o', 'POST', '/v1/c', 200, 1200, 100, 200, 300, 0.05, '{}', '{}').run();
  await db.prepare(
    `INSERT INTO logs (timestamp, model, method, path, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, cost_usd, request_body, response_body)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(now, 'gpt-4o', 'POST', '/v1/c', 500, 200, 0, 0, 0, 0, '{}', '{}').run();
  await db.prepare(
    `INSERT INTO logs (timestamp, model, method, path, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, cost_usd, request_body, response_body)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(earlier, 'gpt-4o', 'POST', '/v1/c', 200, 500, 100, 200, 300, 0.05, '{}', '{}').run();
}

describe('queryKpis', () => {
  beforeEach(async () => { await seed(env.DB); });

  it('aggregates 24h KPIs', async () => {
    const k = await queryKpis(env.DB, { hours: 24 });
    expect(k.request_count).toBe(3);
    expect(k.error_count).toBe(1);
    expect(Math.round(k.success_rate * 1000) / 1000).toBe(0.667);
    expect(k.total_tokens).toBe(600);
    expect(Math.round(k.total_cost * 100) / 100).toBe(0.10);
    expect(k.avg_latency).toBeGreaterThan(700);
  });

  it('returns previous period for delta comparison', async () => {
    const k = await queryKpis(env.DB, { hours: 24, includePrevious: true });
    expect(k.previous).toBeDefined();
    expect(k.previous.request_count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, confirm failure**

Run: `npm test -- api-kpis`
Expected: import error or undefined `queryKpis`

- [ ] **Step 3: Implement queryKpis in src/db.js**

```javascript
// append to src/db.js
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
```

- [ ] **Step 4: Wire up endpoint in src/routes/api-logs.js**

Modify the routing in `handleLogsApi`:

```javascript
// add after the existing stats handling
if (url.pathname === '/api/logs/kpis') {
  const includePrevious = url.searchParams.get('compare') === 'true';
  const kpis = await queryKpis(env.DB, { hours, includePrevious });
  return jsonResponse(kpis);
}
```

And import `queryKpis`:

```javascript
import { queryLogs, queryStats, queryLogById, queryKpis } from '../db.js';
```

- [ ] **Step 5: Re-run tests, verify pass**

Run: `npm test -- api-kpis`
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/api-kpis.test.js src/db.js src/routes/api-logs.js
git commit -m "feat(api): /api/logs/kpis aggregate endpoint with period comparison"
```

---

### Task 2: Add /api/logs/timeseries endpoint (TDD)

**Files:**
- Create: `tests/api-timeseries.test.js`
- Modify: `src/db.js`
- Modify: `src/routes/api-logs.js`

- [ ] **Step 1: Write failing test**

```javascript
// tests/api-timeseries.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { queryTimeseries } from '../src/db.js';

async function seed(db) {
  await db.exec(`DELETE FROM logs`);
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    const ts = new Date(now - i * 3600 * 1000).toISOString();
    await db.prepare(
      `INSERT INTO logs (timestamp, model, method, path, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, cost_usd, request_body, response_body)
       VALUES (?, ?, 'POST', '/v1/c', 200, 500, 100, 200, 300, ?, '{}', '{}')`
    ).bind(ts, 'gpt-4o', 0.01).run();
  }
}

describe('queryTimeseries', () => {
  beforeEach(async () => { await seed(env.DB); });

  it('buckets by hour for last 6 hours, count metric', async () => {
    const result = await queryTimeseries(env.DB, { hours: 6, granularity: 'hour', metric: 'count' });
    expect(Array.isArray(result.buckets)).toBe(true);
    expect(result.buckets.length).toBe(6);
    const totalValue = result.buckets.reduce((s, b) => s + b.value, 0);
    expect(totalValue).toBe(5);
  });

  it('buckets cost metric and includes breakdown by model', async () => {
    const result = await queryTimeseries(env.DB, { hours: 6, granularity: 'hour', metric: 'cost', breakdown: 'model' });
    const total = result.buckets.reduce((s, b) => s + b.value, 0);
    expect(Math.round(total * 100) / 100).toBe(0.05);
    const someBucket = result.buckets.find(b => b.value > 0);
    expect(someBucket.breakdown).toBeDefined();
    expect(someBucket.breakdown['gpt-4o']).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npm test -- api-timeseries`
Expected: undefined function.

- [ ] **Step 3: Implement queryTimeseries in src/db.js**

```javascript
// append to src/db.js
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
```

- [ ] **Step 4: Wire up endpoint**

In `src/routes/api-logs.js`:

```javascript
import { queryLogs, queryStats, queryLogById, queryKpis, queryTimeseries } from '../db.js';

// inside handleLogsApi, after kpis check:
if (url.pathname === '/api/logs/timeseries') {
  const ts = await queryTimeseries(env.DB, {
    hours,
    granularity: url.searchParams.get('granularity') || 'hour',
    metric: url.searchParams.get('metric') || 'count',
    breakdown: url.searchParams.get('breakdown') || undefined,
  });
  return jsonResponse(ts);
}
```

- [ ] **Step 5: Verify tests pass**

Run: `npm test -- api-timeseries`
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/api-timeseries.test.js src/db.js src/routes/api-logs.js
git commit -m "feat(api): /api/logs/timeseries bucketed metrics with model breakdown"
```

---

### Task 3: Vendor uPlot library

**Files:**
- Create: `public/vendor/uplot.min.js`
- Create: `public/vendor/uplot.min.css`

- [ ] **Step 1: Download uPlot v1.6 distribution**

Run:
```bash
mkdir -p public/vendor
curl -L https://cdn.jsdelivr.net/npm/uplot@1.6.31/dist/uPlot.iife.min.js -o public/vendor/uplot.min.js
curl -L https://cdn.jsdelivr.net/npm/uplot@1.6.31/dist/uPlot.min.css -o public/vendor/uplot.min.css
```

- [ ] **Step 2: Verify file sizes (sanity check)**

Run: `ls -la public/vendor/`
Expected: uplot.min.js ~50KB, uplot.min.css ~3KB.

- [ ] **Step 3: Link CSS in public/index.html**

Modify head:
```html
<link rel="stylesheet" href="/vendor/uplot.min.css">
<link rel="stylesheet" href="/styles.css">
```

- [ ] **Step 4: Commit**

```bash
git add public/vendor public/index.html
git commit -m "chore: vendor uPlot 1.6 for time-series charts"
```

---

### Task 4: Build chart helper component

**Files:**
- Create: `public/components/chart.js`

- [ ] **Step 1: Wrap uPlot with theme-aware defaults**

```javascript
// public/components/chart.js
const THEME = {
  bg: 'transparent',
  axis: 'rgba(148,163,184,0.6)',
  grid: 'rgba(30,35,48,0.8)',
  text: '#94a3b8',
};

const COLORS = ['#3b82f6', '#a78bfa', '#f472b6', '#4ade80', '#fbbf24', '#06b6d4'];

export function renderLineChart(container, { buckets, series, height = 200, formatY }) {
  if (!window.uPlot) {
    container.innerHTML = '<div style="padding:20px;color:var(--accent-red)">uPlot not loaded</div>';
    return;
  }
  const xs = buckets.map(b => Math.floor(new Date(b.ts).getTime() / 1000));
  const seriesConfigs = [{}];
  const seriesData = [xs];

  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    seriesData.push(buckets.map(b => s.extract(b)));
    seriesConfigs.push({
      label: s.label,
      stroke: COLORS[i % COLORS.length],
      width: 2,
      fill: i === 0 ? hexToRgba(COLORS[0], 0.1) : undefined,
      points: { show: false },
    });
  }

  const opts = {
    width: container.clientWidth || 800,
    height,
    cursor: { drag: { x: true, y: false } },
    scales: { x: { time: true } },
    axes: [
      { stroke: THEME.text, grid: { stroke: THEME.grid } },
      { stroke: THEME.text, grid: { stroke: THEME.grid }, values: formatY ? (u, vals) => vals.map(formatY) : undefined },
    ],
    series: seriesConfigs,
    legend: { show: series.length > 1 },
  };
  container.innerHTML = '';
  new window.uPlot(opts, seriesData, container);
}

export function renderDonut(container, { slices, total, totalLabel = '' }) {
  // SVG donut — uPlot doesn't do donuts; tiny hand-rolled SVG
  const radius = 40, cx = 50, cy = 50, stroke = 12, circ = 2 * Math.PI * radius;
  let acc = 0;
  const segments = slices.map((s, i) => {
    const portion = total > 0 ? s.value / total : 0;
    const dash = portion * circ;
    const offset = -acc;
    acc += dash;
    return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none"
              stroke="${COLORS[i % COLORS.length]}" stroke-width="${stroke}"
              stroke-dasharray="${dash} ${circ}" stroke-dashoffset="${offset}"
              transform="rotate(-90 ${cx} ${cy})"/>`;
  }).join('');
  const legend = slices.map((s, i) => `
    <div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0">
      <span><span style="color:${COLORS[i % COLORS.length]}">●</span> ${s.label}</span>
      <span style="color:var(--text-secondary)">${s.display}</span>
    </div>`).join('');
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="var(--border-subtle)" stroke-width="${stroke}"/>
        ${segments}
        <text x="${cx}" y="${cy}" text-anchor="middle" dy="4" fill="var(--text-primary)" font-size="11" font-weight="600">${totalLabel}</text>
      </svg>
      <div style="width:100%">${legend}</div>
    </div>
  `;
}

function hexToRgba(hex, alpha) {
  const v = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
}
```

- [ ] **Step 2: Load uPlot script in public/index.html**

Add to body (before app.js):
```html
<script src="/vendor/uplot.min.js"></script>
<script type="module" src="/app.js"></script>
```

- [ ] **Step 3: Commit**

```bash
git add public/components/chart.js public/index.html
git commit -m "feat(ui): chart helper with line + donut variants"
```

---

### Task 5: Build Overview page

**Files:**
- Create: `public/pages/overview.js`
- Modify: `public/app.js`
- Modify: `public/components/sidebar.js`

- [ ] **Step 1: Write public/pages/overview.js**

```javascript
// public/pages/overview.js
import { api } from '/lib/api.js';
import { renderLineChart } from '/components/chart.js';
import { navigate } from '/lib/router.js';

const state = { hours: 168 };

export function renderOverview(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Overview</div>
        <div class="page-subtitle">实时监控你的 AI 网关</div>
      </div>
      <div class="filter-bar">
        <button class="filter-chip" data-hours="24">今日</button>
        <button class="filter-chip active" data-hours="168">7 天</button>
        <button class="filter-chip" data-hours="720">30 天</button>
      </div>
    </div>
    <div class="page-body">
      <div id="kpi-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
        ${Array(4).fill('<div class="card stat-card" style="height:80px"><div class="label">加载中</div></div>').join('')}
      </div>
      <div class="card" style="height:200px;margin-bottom:20px">
        <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px">请求量趋势</div>
        <div id="trend-chart" style="height:160px"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="card">
          <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px">最近活跃模型</div>
          <div id="active-models"></div>
        </div>
        <div class="card">
          <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px">最近错误</div>
          <div id="recent-errors"></div>
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll('.filter-chip[data-hours]').forEach(btn => {
    btn.onclick = () => {
      state.hours = parseInt(btn.dataset.hours, 10);
      container.querySelectorAll('.filter-chip[data-hours]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      load();
    };
  });

  load();
}

async function load() {
  await Promise.all([loadKpis(), loadTrend(), loadActiveModels(), loadRecentErrors()]);
}

async function loadKpis() {
  const data = await api(`/api/logs/kpis?hours=${state.hours}&compare=true`);
  const prev = data.previous || {};
  const grid = document.getElementById('kpi-grid');
  grid.innerHTML = `
    ${kpiCard('请求总量', data.request_count.toLocaleString(), deltaPct(data.request_count, prev.request_count))}
    ${kpiCard('Token 消耗', formatNum(data.total_tokens), '~$' + data.total_cost.toFixed(2))}
    ${kpiCard('成功率', (data.success_rate * 100).toFixed(1) + '%', data.error_count + ' 错误', data.success_rate < 0.95 ? 'up' : 'down')}
    ${kpiCard('平均延迟', data.avg_latency + 'ms', deltaPct(data.avg_latency, prev.avg_latency, true))}
  `;
  grid.querySelector('[data-go="logs-errors"]')?.addEventListener('click', () => {
    navigate('/logs');
  });
}

function kpiCard(label, value, deltaText, deltaCls = 'down') {
  return `<div class="card stat-card">
    <div class="label">${label}</div>
    <div class="value">${value}</div>
    <div class="delta ${deltaCls}">${deltaText}</div>
  </div>`;
}

function deltaPct(curr, prev, lowerIsBetter = false) {
  if (!prev || prev === 0) return '—';
  const diff = ((curr - prev) / prev) * 100;
  const sign = diff > 0 ? '↑' : '↓';
  const cls = lowerIsBetter ? (diff > 0 ? 'up' : 'down') : (diff > 0 ? 'down' : 'up');
  return `<span class="${cls}">${sign} ${Math.abs(diff).toFixed(1)}% vs 上期</span>`;
}

function formatNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

async function loadTrend() {
  const granularity = state.hours <= 168 ? 'hour' : 'day';
  const data = await api(`/api/logs/timeseries?hours=${state.hours}&granularity=${granularity}&metric=count`);
  renderLineChart(document.getElementById('trend-chart'), {
    buckets: data.buckets,
    series: [{ label: '请求量', extract: b => b.value }],
    height: 160,
  });
}

async function loadActiveModels() {
  const stats = await api(`/api/logs/stats?hours=${state.hours}`);
  const el = document.getElementById('active-models');
  if (!stats.length) { el.innerHTML = '<div style="color:var(--text-tertiary);padding:8px">暂无数据</div>'; return; }
  el.innerHTML = stats.slice(0, 6).map(s => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-subtle);font-size:12px">
      <span>${s.model}</span>
      <span style="color:var(--text-secondary)">${s.request_count} 请求</span>
    </div>
  `).join('');
}

async function loadRecentErrors() {
  const rows = await api(`/api/logs?hours=${state.hours}&status=4xx&limit=10`);
  const rows5xx = await api(`/api/logs?hours=${state.hours}&status=5xx&limit=10`);
  const all = [...rows, ...rows5xx].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 6);
  const el = document.getElementById('recent-errors');
  if (!all.length) { el.innerHTML = '<div style="color:var(--accent-green);padding:8px">无错误 🎉</div>'; return; }
  el.innerHTML = all.map(r => {
    const time = new Date(r.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
    return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-subtle);font-size:12px;cursor:pointer" onclick="window.location.hash='/logs'">
      <span class="tag-status-err mono">${r.status}</span>
      <span style="color:var(--text-secondary)">${r.model} · ${time}</span>
    </div>`;
  }).join('');
}
```

- [ ] **Step 2: Register Overview route in public/app.js**

```javascript
import { renderOverview } from '/pages/overview.js';

// add before logs registration
registerRoute('/overview', (c) => renderOverview(c));

// Update default route to overview
registerRoute('/', (c) => renderOverview(c));
```

- [ ] **Step 3: Enable Overview in sidebar (remove disabled flag)**

In `public/components/sidebar.js`, change:
```javascript
{ path: '/overview', icon: '📊', label: 'Overview', disabled: true },
```
to:
```javascript
{ path: '/overview', icon: '📊', label: 'Overview' },
```

- [ ] **Step 4: Manually verify in browser**

Run: `npm run dev`
Visit http://localhost:8787, navigate to Overview, verify KPIs / chart / lists load.

- [ ] **Step 5: Commit**

```bash
git add public/pages/overview.js public/app.js public/components/sidebar.js
git commit -m "feat(ui): Overview page with KPIs, trend chart, active models, recent errors"
```

---

### Task 6: Build Analytics page

**Files:**
- Create: `public/pages/analytics.js`
- Modify: `public/app.js`
- Modify: `public/components/sidebar.js`

- [ ] **Step 1: Write public/pages/analytics.js**

```javascript
// public/pages/analytics.js
import { api } from '/lib/api.js';
import { renderLineChart, renderDonut } from '/components/chart.js';

const state = { hours: 168 };

export function renderAnalytics(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Analytics</div>
        <div class="page-subtitle">用量分析与费用追踪</div>
      </div>
      <div class="filter-bar">
        <button class="filter-chip" data-hours="24">24h</button>
        <button class="filter-chip active" data-hours="168">7d</button>
        <button class="filter-chip" data-hours="720">30d</button>
      </div>
    </div>
    <div class="page-body">
      <div id="cost-summary" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
        ${Array(3).fill('<div class="card stat-card" style="height:90px"><div class="label">加载中</div></div>').join('')}
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:20px">
        <div class="card" style="height:240px">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px">
            <span style="font-size:11px;color:var(--text-secondary)">费用趋势</span>
            <span style="font-size:10px;color:var(--text-tertiary)" id="legend"></span>
          </div>
          <div id="cost-chart" style="height:200px"></div>
        </div>
        <div class="card">
          <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px">模型费用占比</div>
          <div id="model-donut"></div>
        </div>
      </div>
      <div class="card">
        <div style="font-size:11px;color:var(--text-secondary);margin-bottom:12px">模型用量明细</div>
        <div id="breakdown-table"></div>
      </div>
    </div>
  `;

  container.querySelectorAll('.filter-chip[data-hours]').forEach(btn => {
    btn.onclick = () => {
      state.hours = parseInt(btn.dataset.hours, 10);
      container.querySelectorAll('.filter-chip[data-hours]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      load();
    };
  });

  load();
}

async function load() {
  await Promise.all([loadCostSummary(), loadCostChart(), loadModelDonut(), loadBreakdown()]);
}

async function loadCostSummary() {
  const k7 = await api(`/api/logs/kpis?hours=${state.hours}&compare=true`);
  const k30 = await api(`/api/logs/kpis?hours=720`);
  const dailyAvg = k30.total_cost / 30;
  const projection = dailyAvg * 30;
  const el = document.getElementById('cost-summary');
  el.innerHTML = `
    ${costCard('当前周期费用', '$' + k7.total_cost.toFixed(2),
      k7.previous ? deltaPctText(k7.total_cost, k7.previous.total_cost) : '—')}
    ${costCard('30 天累计', '$' + k30.total_cost.toFixed(2), '预估月底 $' + projection.toFixed(2))}
    ${costCard('日均费用', '$' + dailyAvg.toFixed(2), '基于近 30 天')}
  `;
}

function costCard(label, value, sub) {
  return `<div class="card stat-card">
    <div class="label">${label}</div>
    <div class="value" style="color:var(--accent-yellow)">${value}</div>
    <div class="delta down">${sub}</div>
  </div>`;
}

function deltaPctText(curr, prev) {
  if (!prev) return '—';
  const diff = ((curr - prev) / prev) * 100;
  const sign = diff > 0 ? '↑' : '↓';
  return `${sign} ${Math.abs(diff).toFixed(1)}% vs 上期`;
}

async function loadCostChart() {
  const granularity = state.hours <= 168 ? 'hour' : 'day';
  const data = await api(`/api/logs/timeseries?hours=${state.hours}&granularity=${granularity}&metric=cost&breakdown=model`);
  renderLineChart(document.getElementById('cost-chart'), {
    buckets: data.buckets,
    series: [{ label: '总费用', extract: b => b.value }],
    height: 200,
    formatY: v => '$' + (v || 0).toFixed(2),
  });
}

async function loadModelDonut() {
  const stats = await api(`/api/logs/stats?hours=${state.hours}`);
  const withCost = stats.map(s => ({
    label: s.model,
    value: s.cost_usd || 0,
    display: '$' + (s.cost_usd || 0).toFixed(2),
  }));
  const total = withCost.reduce((s, x) => s + x.value, 0);
  renderDonut(document.getElementById('model-donut'), {
    slices: withCost,
    total,
    totalLabel: '$' + total.toFixed(2),
  });
}

async function loadBreakdown() {
  const stats = await api(`/api/logs/stats?hours=${state.hours}`);
  const el = document.getElementById('breakdown-table');
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 80px 100px 100px 100px 100px;padding:8px 0;border-bottom:1px solid var(--border-subtle);font-size:10px;color:var(--text-tertiary);text-transform:uppercase">
      <span>模型</span><span>请求数</span><span>Prompt</span><span>Completion</span><span>总 Tokens</span><span>费用</span>
    </div>
    ${stats.map(s => `
      <div style="display:grid;grid-template-columns:1fr 80px 100px 100px 100px 100px;padding:10px 0;border-bottom:1px solid var(--border-subtle);font-size:12px;align-items:center">
        <span>${s.model}</span>
        <span>${s.request_count}</span>
        <span>${formatNum(s.prompt_tokens || 0)}</span>
        <span>${formatNum(s.completion_tokens || 0)}</span>
        <span>${formatNum(s.total_tokens || 0)}</span>
        <span style="color:var(--accent-yellow)">$${(s.cost_usd || 0).toFixed(2)}</span>
      </div>
    `).join('')}
  `;
}

function formatNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}
```

- [ ] **Step 2: Update queryStats in src/db.js to include cost_usd**

Modify existing `queryStats`:

```javascript
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
```

- [ ] **Step 3: Register Analytics route in app.js**

```javascript
import { renderAnalytics } from '/pages/analytics.js';

registerRoute('/analytics', (c) => renderAnalytics(c));
```

- [ ] **Step 4: Enable in sidebar (remove disabled flag for analytics)**

- [ ] **Step 5: Verify in browser**

Run: `npm run dev`
Navigate to Analytics, verify cost summary / trend chart / donut / table render.

- [ ] **Step 6: Commit**

```bash
git add public/pages/analytics.js public/app.js public/components/sidebar.js src/db.js
git commit -m "feat(ui): Analytics page with cost trend, model donut, breakdown table"
```

---

### Task 7: Manual verification + deploy

- [ ] **Step 1: Generate some test data**

Run a few proxy requests to populate logs (use playground in real CLI or curl).

- [ ] **Step 2: Verify in dev**

Open `npm run dev`, check:
- Overview shows non-zero KPIs
- Analytics costs render correctly (assuming cost_usd column is populated — will be 0 until Phase 3 wires up pricing; mock data acceptable for now)
- Charts render with theme colors
- Time-range buttons (24h / 7d / 30d) refresh data
- Browser console has no JS errors

- [ ] **Step 3: Deploy to production**

Run: `npm run deploy`
Expected: deploy succeeds.

- [ ] **Step 4: Production sanity check**

Visit deployed URL → Overview → verify charts render → Analytics → verify breakdown table.

---

## Self-Review Checklist

Against spec sections 5.1, 5.3, 6.1, 6.2:

- [ ] Overview has 4 KPI cards: requests / tokens / success / latency (spec 5.1)
- [ ] Overview shows trend chart with renderLineChart (spec 5.1)
- [ ] Overview shows "最近活跃模型" + "最近错误" lists (spec 5.1)
- [ ] Time range toggle: 24h / 7d / 30d (spec 5.1)
- [ ] Analytics has 3 cost cards: current period / 30d cumulative / daily avg (spec 5.3)
- [ ] Analytics has cost trend line chart (spec 5.3)
- [ ] Analytics has model donut (spec 5.3)
- [ ] Analytics has breakdown table with Req/Prompt/Compl/Total/Cost columns (spec 5.3)
- [ ] `/api/logs/kpis?compare=true` returns previous period data (spec 6.2)
- [ ] `/api/logs/timeseries?granularity=hour|day&metric=count|cost&breakdown=model` works (spec 6.2)
- [ ] uPlot integrated and themed (spec 3.3)

Items deferred to later phases:
- Multi-provider model tag colors (Phase 3 will refine)
- Click-to-jump from KPI to filtered Logs (nice-to-have, can polish in Phase 5)
- Actual cost calculation requires pricing table from Phase 3 — Analytics shows $0 until then
