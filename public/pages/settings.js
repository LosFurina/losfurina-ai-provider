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
