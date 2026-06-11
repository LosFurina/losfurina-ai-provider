// public/pages/analytics.js
import { api } from '/lib/api.js';
import { renderLineChart, renderDonut } from '/components/chart.js';

const state = { hours: 168 };

export function renderAnalytics(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Analytics</div>
        <div class="page-subtitle">Token 用量分析</div>
      </div>
      <div class="filter-bar">
        <button class="filter-chip" data-hours="24">24h</button>
        <button class="filter-chip active" data-hours="168">7d</button>
        <button class="filter-chip" data-hours="720">30d</button>
      </div>
    </div>
    <div class="page-body">
      <div id="token-summary" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
        ${Array(3).fill('<div class="skeleton" style="height:90px"></div>').join('')}
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:20px">
        <div class="card" style="height:240px">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px">
            <span style="font-size:11px;color:var(--text-secondary)">Token 趋势</span>
          </div>
          <div id="token-chart" style="height:200px"><div class="skeleton" style="height:200px"></div></div>
        </div>
        <div class="card">
          <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px">模型 Token 占比</div>
          <div id="model-donut"><div class="skeleton" style="height:160px;border-radius:50%;width:160px;margin:0 auto"></div></div>
        </div>
      </div>
      <div class="card">
        <div style="font-size:11px;color:var(--text-secondary);margin-bottom:12px">模型用量明细</div>
        <div id="breakdown-table"><div class="skeleton" style="height:32px;margin:6px 0"></div><div class="skeleton" style="height:32px;margin:6px 0"></div><div class="skeleton" style="height:32px;margin:6px 0"></div></div>
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
  await Promise.all([loadTokenSummary(), loadTokenChart(), loadModelDonut(), loadBreakdown()]);
}

async function loadTokenSummary() {
  const k = await api(`/api/logs/kpis?hours=${state.hours}&compare=true`);
  const stats = await api(`/api/logs/stats?hours=${state.hours}`);
  const totalTokens = k.total_tokens || 0;
  const totalRequests = k.request_count || 0;
  const avgPerReq = totalRequests > 0 ? Math.round(totalTokens / totalRequests) : 0;

  // Cache hit rate estimate: total - prompt - completion = inferred cache tokens
  const promptSum = stats.reduce((s, r) => s + (r.prompt_tokens || 0), 0);
  const completionSum = stats.reduce((s, r) => s + (r.completion_tokens || 0), 0);
  const inferredCache = Math.max(0, totalTokens - promptSum - completionSum);
  const inputTotal = promptSum + inferredCache;
  const cacheRate = inputTotal > 0 ? inferredCache / inputTotal : 0;

  const el = document.getElementById('token-summary');
  el.innerHTML = `
    ${tokenCard('总 Token', formatNum(totalTokens),
      k.previous ? deltaPctText(totalTokens, k.previous.total_tokens) : '—')}
    ${tokenCard('单次平均', formatNum(avgPerReq), `基于 ${totalRequests} 次请求`)}
    ${tokenCard('缓存占比', (cacheRate * 100).toFixed(1) + '%', '估算（含 cache write/read）')}
  `;
}

function tokenCard(label, value, sub) {
  return `<div class="card stat-card">
    <div class="label">${label}</div>
    <div class="value" style="color:var(--accent-blue)">${value}</div>
    <div class="delta down">${sub}</div>
  </div>`;
}

function deltaPctText(curr, prev) {
  if (!prev) return '—';
  const diff = ((curr - prev) / prev) * 100;
  const sign = diff > 0 ? '↑' : '↓';
  return `${sign} ${Math.abs(diff).toFixed(1)}% vs 上期`;
}

async function loadTokenChart() {
  const granularity = state.hours <= 168 ? 'hour' : 'day';
  const data = await api(`/api/logs/timeseries?hours=${state.hours}&granularity=${granularity}&metric=tokens&breakdown=model`);
  renderLineChart(document.getElementById('token-chart'), {
    buckets: data.buckets,
    series: [{ label: 'Tokens', extract: b => b.value }],
    height: 200,
    formatY: v => formatNum(v || 0),
  });
}

async function loadModelDonut() {
  const stats = await api(`/api/logs/stats?hours=${state.hours}`);
  const slices = stats.map(s => ({
    label: s.model,
    value: s.total_tokens || 0,
    display: formatNum(s.total_tokens || 0),
  }));
  const total = slices.reduce((s, x) => s + x.value, 0);
  renderDonut(document.getElementById('model-donut'), {
    slices,
    total,
    totalLabel: formatNum(total),
  });
}

async function loadBreakdown() {
  const stats = await api(`/api/logs/stats?hours=${state.hours}`);
  const el = document.getElementById('breakdown-table');
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 80px 100px 100px 100px;padding:8px 0;border-bottom:1px solid var(--border-subtle);font-size:10px;color:var(--text-tertiary);text-transform:uppercase">
      <span>模型</span><span>请求数</span><span>Prompt</span><span>Completion</span><span>总 Tokens</span>
    </div>
    ${stats.map(s => `
      <div style="display:grid;grid-template-columns:1fr 80px 100px 100px 100px;padding:10px 0;border-bottom:1px solid var(--border-subtle);font-size:12px;align-items:center">
        <span>${s.model}</span>
        <span>${s.request_count}</span>
        <span>${formatNum(s.prompt_tokens || 0)}</span>
        <span>${formatNum(s.completion_tokens || 0)}</span>
        <span style="color:var(--accent-blue)">${formatNum(s.total_tokens || 0)}</span>
      </div>
    `).join('')}
  `;
}

function formatNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}
