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
        ${Array(4).fill('<div class="skeleton" style="height:80px"></div>').join('')}
      </div>
      <div class="card" style="height:200px;margin-bottom:20px">
        <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px">请求量趋势</div>
        <div id="trend-chart" style="height:160px"><div class="skeleton" style="height:160px"></div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="card">
          <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px">最近活跃模型</div>
          <div id="active-models"><div class="skeleton" style="height:24px;margin:6px 0"></div><div class="skeleton" style="height:24px;margin:6px 0"></div><div class="skeleton" style="height:24px;margin:6px 0"></div></div>
        </div>
        <div class="card">
          <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px">最近错误</div>
          <div id="recent-errors"><div class="skeleton" style="height:24px;margin:6px 0"></div><div class="skeleton" style="height:24px;margin:6px 0"></div><div class="skeleton" style="height:24px;margin:6px 0"></div></div>
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
  if (!stats.length) {
    el.innerHTML = `<div class="empty-state" style="padding:20px"><div class="icon">📭</div><div class="title">暂无数据</div><div class="desc">所选时间窗口内没有模型调用记录。</div></div>`;
    return;
  }
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
