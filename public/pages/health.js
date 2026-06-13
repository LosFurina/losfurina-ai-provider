// public/pages/health.js
import { api } from '/lib/api.js';
import { renderStatusSparkline, renderLatencyLineSparkline } from '/components/sparkline.js';
import { openSidePanel } from '/components/side-panel.js';
import { showToast } from '/components/toast.js';

export function renderHealth(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Health</div>
        <div class="page-subtitle">Provider 后端可用性监控</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="filter-chip" id="new-provider">+ 新建 Provider</button>
        <button class="filter-chip" id="manual-probe">立即探测</button>
        <span style="font-size:11px;color:var(--text-tertiary);align-self:center" id="status-summary"></span>
      </div>
    </div>
    <div class="page-body" id="health-body">
      <div class="skeleton" style="height:120px;margin:12px 0"></div>
      <div class="skeleton" style="height:120px;margin:12px 0"></div>
    </div>
  `;

  container.querySelector('#new-provider').onclick = () => openProviderForm(null);

  container.querySelector('#manual-probe').onclick = async () => {
    const btn = container.querySelector('#manual-probe');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>探测中...';
    try {
      await api('/api/providers/probe', { method: 'POST' });
      await load();
    } catch (e) {
      showToast('探测失败：' + e.message, { type: 'error' });
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
    body.querySelector('#empty-new')?.addEventListener('click', () => openProviderForm(null));
    return;
  }

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
    const id = parseInt(card.dataset.provider, 10);
    card.querySelector('[data-action="edit"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = providers.find(x => x.id === id);
      openProviderForm(p);
    });
    card.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const p = providers.find(x => x.id === id);
      if (!confirm(`删除 provider "${p.name}"？此操作不可恢复。`)) return;
      try {
        await api(`/api/providers/${id}`, { method: 'DELETE' });
        showToast('已删除');
        await load();
      } catch (err) {
        showToast('删除失败：' + err.message, { type: 'error' });
      }
    });
    card.onclick = (e) => {
      if (e.target.closest('button')) return;
      openProviderDetail(id, providers, histMap);
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
        <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <div style="display:flex;gap:6px">
            <button class="filter-chip" data-action="edit" style="padding:2px 8px;font-size:11px">编辑</button>
            <button class="filter-chip" data-action="delete" style="padding:2px 8px;font-size:11px;color:var(--accent-red)">删除</button>
          </div>
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
          ${(p.prefixed_models || p.models || []).map(m => `<span class="tag tag-model-default">${escape(m)}</span>`).join('')}
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
        点击下方按钮新建一个，或在右上角点 "+ 新建 Provider"。
      </div>
      <button class="filter-chip" id="empty-new" style="margin-top:16px">+ 新建 Provider</button>
    </div>
  `;
}

function openProviderForm(existing) {
  const isEdit = !!existing;
  const title = isEdit ? `编辑 Provider: ${existing.name}` : '新建 Provider';
  const modelsStr = isEdit ? (existing.models || []).join(', ') : '';
  const panel = openSidePanel({
    title,
    bodyHtml: providerFormHtml({ isEdit, existing, modelsStr }),
  });

  const form = panel.body.querySelector('#provider-form');
  panel.body.querySelector('#f-cancel').onclick = panel.close;

  form.onsubmit = async (e) => {
    e.preventDefault();
    const errEl = panel.body.querySelector('#form-error');
    errEl.textContent = '';
    const submitBtn = panel.body.querySelector('#f-submit');
    submitBtn.disabled = true;

    const payload = {
      name: panel.body.querySelector('#f-name').value.trim(),
      base_url: panel.body.querySelector('#f-base-url').value.trim(),
      priority: parseInt(panel.body.querySelector('#f-priority').value, 10) || 100,
      enabled: panel.body.querySelector('#f-enabled').checked,
      models: panel.body.querySelector('#f-models').value,
    };
    const keyValue = panel.body.querySelector('#f-api-key').value.trim();
    if (keyValue) payload.api_key = keyValue;
    else if (!isEdit) payload.api_key = '';

    try {
      if (isEdit) {
        await api(`/api/providers/${existing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        showToast('已保存');
      } else {
        await api('/api/providers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        showToast('已创建');
      }
      panel.close();
      await load();
    } catch (err) {
      errEl.textContent = err.message;
      submitBtn.disabled = false;
    }
  };
}

function providerFormHtml({ isEdit, existing, modelsStr }) {
  const inputStyle = 'width:100%;margin-top:4px;padding:6px 8px;background:var(--bg-elevated);border:1px solid var(--border-subtle);color:var(--text-primary);font-family:var(--font-mono);font-size:12px';
  const keyLabel = isEdit
    ? 'API Key <span style="color:var(--text-tertiary);font-weight:400">（留空则不修改，当前已设置）</span>'
    : 'API Key <span style="color:var(--accent-red)">*</span>';
  const keyPlaceholder = isEdit ? `${existing.api_key} (mask)` : 'sk-...';
  return `
    <form id="provider-form" style="display:flex;flex-direction:column;gap:12px">
      <div>
        <div class="label">Name <span style="color:var(--accent-red)">*</span></div>
        <input id="f-name" type="text" required value="${escape(existing?.name || '')}" style="${inputStyle}">
      </div>
      <div>
        <div class="label">Base URL <span style="color:var(--accent-red)">*</span></div>
        <input id="f-base-url" type="url" required placeholder="https://api.deepseek.com" value="${escape(existing?.base_url || '')}" style="${inputStyle}">
      </div>
      <div>
        <div class="label">${keyLabel}</div>
        <input id="f-api-key" type="password" ${isEdit ? '' : 'required'} placeholder="${keyPlaceholder}" style="${inputStyle}">
        <div style="font-size:10px;color:var(--text-tertiary);margin-top:4px">永远不会回显已存储的明文 key</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <div class="label">Priority</div>
          <input id="f-priority" type="number" min="0" value="${existing?.priority ?? 100}" style="${inputStyle.replace('font-family:var(--font-mono);', '')}">
        </div>
        <div>
          <div class="label">Enabled</div>
          <label style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12px">
            <input id="f-enabled" type="checkbox" ${existing == null || existing.enabled ? 'checked' : ''}>
            <span>启用</span>
          </label>
        </div>
      </div>
      <div>
        <div class="label">Models <span style="color:var(--text-tertiary);font-weight:400">（逗号分隔）</span></div>
        <textarea id="f-models" rows="3" placeholder="deepseek-chat, deepseek-reasoner" style="${inputStyle};resize:vertical">${escape(modelsStr)}</textarea>
        <div style="font-size:10px;color:var(--text-tertiary);margin-top:4px">手动列出 provider 支持的模型；下次健康探测会更新 model_map</div>
      </div>
      <div id="form-error" style="font-size:11px;color:var(--accent-red);min-height:14px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button type="button" class="filter-chip" id="f-cancel">取消</button>
        <button type="submit" class="filter-chip" style="background:var(--accent-blue);color:white;border-color:var(--accent-blue)" id="f-submit">${isEdit ? '保存' : '创建'}</button>
      </div>
    </form>
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
