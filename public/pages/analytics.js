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
