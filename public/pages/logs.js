// public/pages/logs.js
import { api } from '/lib/api.js';
import { renderJsonViewer } from '/components/json-viewer.js';
import { openSidePanel } from '/components/side-panel.js';

const state = {
  filters: { hours: 24, search: '', models: [], status: '', minDuration: null, maxDuration: null, minCost: null, maxCost: null, providerId: null },
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
      <div id="logs-list">
        <div class="skeleton" style="height:48px;margin:8px 0"></div>
        <div class="skeleton" style="height:48px;margin:8px 0"></div>
        <div class="skeleton" style="height:48px;margin:8px 0"></div>
        <div class="skeleton" style="height:48px;margin:8px 0"></div>
        <div class="skeleton" style="height:48px;margin:8px 0"></div>
      </div>
    </div>
  `;

  renderFilterBar(container.querySelector('#filter-bar'));
  fetchAndRender(container.querySelector('#logs-list'), container.querySelector('#last-update'));

  if (!state._cmdkListenerAttached) {
    window.addEventListener('cmdk:apply-filter', (e) => {
      Object.assign(state.filters, e.detail);
      const searchInput = document.getElementById('search');
      const hoursSel = document.getElementById('hours');
      const statusSel = document.getElementById('status');
      if (searchInput && 'search' in e.detail) searchInput.value = state.filters.search;
      if (hoursSel && 'hours' in e.detail) hoursSel.value = state.filters.hours;
      if (statusSel && 'status' in e.detail) statusSel.value = state.filters.status;
      doFetch();
    });
    state._cmdkListenerAttached = true;
  }

  // Polling every 30s
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    try {
      const sinceIso = state.lastFetch ? new Date(state.lastFetch).toISOString() : '';
      const qs = sinceIso ? `?since=${encodeURIComponent(sinceIso)}` : '';
      const data = await api('/api/poll' + qs);
      if (data.logs && data.logs.length) {
        // New logs since last fetch — re-fetch full filtered list so user's filters stay consistent
        doFetch();
      }
    } catch (e) { /* silent */ }
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
    <select class="filter-chip" id="provider-filter"><option value="">所有 Provider</option></select>
    <button class="filter-chip" id="save-view">⭐ 保存视图</button>
    <div id="saved-views" style="display:flex;gap:6px;flex-wrap:wrap"></div>
  `;
  el.querySelector('#search').oninput = (e) => { state.filters.search = e.target.value; debounceFetch(); };
  el.querySelector('#hours').onchange = (e) => { state.filters.hours = parseInt(e.target.value, 10); doFetch(); };
  el.querySelector('#status').onchange = (e) => { state.filters.status = e.target.value; doFetch(); };
  const provSel = el.querySelector('#provider-filter');
  import('/lib/api.js').then(({ api }) => api('/api/providers')).then(list => {
    provSel.innerHTML = '<option value="">所有 Provider</option>' + list.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (state.filters.providerId != null) provSel.value = String(state.filters.providerId);
  }).catch(() => {});
  provSel.onchange = (e) => {
    state.filters.providerId = e.target.value ? parseInt(e.target.value, 10) : null;
    doFetch();
  };
  el.querySelector('#save-view').onclick = saveCurrentView;
  renderSavedViews(el);
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
  if (f.providerId != null) params.set('provider_id', f.providerId);

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
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="icon">📭</div>
        <div class="title">暂无数据</div>
        <div class="desc">满足过滤条件的日志为空。调整时间范围或过滤条件试试。</div>
      </div>
    `;
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
  renderSavedViews(document.getElementById('filter-bar'));
  alert('已保存：' + name);
}

function renderSavedViews(container) {
  const saved = JSON.parse(localStorage.getItem(VIEWS_KEY) || '{}');
  const el = container.querySelector('#saved-views');
  if (!el) return;
  const names = Object.keys(saved);
  if (!names.length) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = names.map(name => `
    <span class="filter-chip" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer" data-view-name="${escapeHtml(name)}">
      ${escapeHtml(name)}
      <span style="opacity:0.5;cursor:pointer" data-del-view="${escapeHtml(name)}">×</span>
    </span>
  `).join('');
  el.querySelectorAll('[data-view-name]').forEach(chip => {
    chip.onclick = (e) => {
      if (e.target.dataset.delView) return;
      loadSavedView(chip.dataset.viewName);
    };
  });
  el.querySelectorAll('[data-del-view]').forEach(x => {
    x.onclick = (e) => {
      e.stopPropagation();
      const name = x.dataset.delView;
      if (!confirm(`删除视图 "${name}"?`)) return;
      const saved = JSON.parse(localStorage.getItem(VIEWS_KEY) || '{}');
      delete saved[name];
      localStorage.setItem(VIEWS_KEY, JSON.stringify(saved));
      renderSavedViews(container);
    };
  });
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

