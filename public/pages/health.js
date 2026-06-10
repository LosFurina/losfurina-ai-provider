// public/pages/health.js
import { api } from '/lib/api.js';
import { renderStatusSparkline, renderLatencyLineSparkline } from '/components/sparkline.js';
import { openSidePanel } from '/components/side-panel.js';

export function renderHealth(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Health</div>
        <div class="page-subtitle">Provider 后端可用性监控</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="filter-chip" id="manual-probe">立即探测</button>
        <span style="font-size:11px;color:var(--text-tertiary);align-self:center" id="status-summary"></span>
      </div>
    </div>
    <div class="page-body" id="health-body">
      <div class="skeleton" style="height:120px;margin:12px 0"></div>
      <div class="skeleton" style="height:120px;margin:12px 0"></div>
    </div>
  `;

  container.querySelector('#manual-probe').onclick = async () => {
    const btn = container.querySelector('#manual-probe');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>探测中...';
    try {
      await api('/api/providers/probe', { method: 'POST' });
      await load();
    } catch (e) {
      alert('探测失败：' + e.message);
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
    return;
  }

  // Fetch 24h history for each enabled provider in parallel
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
    card.onclick = (e) => {
      if (e.target.closest('button')) return;
      openProviderDetail(parseInt(card.dataset.provider, 10), providers, histMap);
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
        <div style="text-align:right">
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
          ${(p.models || []).map(m => `<span class="tag tag-model-default">${escape(m)}</span>`).join('')}
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
        直接在 D1 中插入 <code>providers</code> 表数据。<br>
        参考 <code>migrations/seed-providers.sql.example</code>，<br>
        或运行：<br>
        <code style="background:var(--bg-elevated);padding:8px;display:inline-block;margin-top:8px;border-radius:4px">wrangler d1 execute losfurina-logs --command "INSERT INTO providers ..."</code>
      </div>
    </div>
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
