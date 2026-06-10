// public/components/alert-banner.js
import { api } from '/lib/api.js';

export function mountAlertBanner() {
  let bannerEl = document.getElementById('alert-banner');
  if (!bannerEl) {
    bannerEl = document.createElement('div');
    bannerEl.id = 'alert-banner';
    bannerEl.style.cssText = 'display:none;position:sticky;top:0;z-index:30;background:#7f1d1d;border-bottom:1px solid #ef4444;color:#fecaca;padding:8px 16px;font-size:12px;';
    document.body.insertBefore(bannerEl, document.body.firstChild);
  }
  refresh();
  setInterval(refresh, 30000);
}

async function refresh() {
  const el = document.getElementById('alert-banner');
  try {
    const rows = await api('/api/admin/alerts/triggered?unack=true');
    const bannerable = rows.filter(r => r.metric); // skip orphaned (rule deleted)
    if (!bannerable.length) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    const r = bannerable[0];
    const extra = bannerable.length > 1 ? ` (还有 ${bannerable.length - 1} 个)` : '';
    el.innerHTML = `
      🚨 <strong>${r.rule_name}</strong> 触发: ${r.rule_metric} = ${r.actual_value}${extra}
      <a href="#/settings" style="color:#fecaca;text-decoration:underline;margin-left:8px">查看</a>
      <button id="ack-banner" style="float:right;background:transparent;border:1px solid #fca5a5;color:#fca5a5;padding:1px 8px;border-radius:3px;cursor:pointer">已知悉</button>
    `;
    document.getElementById('ack-banner').onclick = async () => {
      await api(`/api/admin/alerts/triggered/${r.id}/ack`, { method: 'PUT' });
      refresh();
    };
  } catch (e) {
    el.style.display = 'none';
  }
}
