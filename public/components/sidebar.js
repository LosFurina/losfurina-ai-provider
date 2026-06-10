// public/components/sidebar.js
import { clearToken, api } from '/lib/api.js';
import { getCurrentPath } from '/lib/router.js';

const NAV = [
  { path: '/overview', icon: '📊', label: 'Overview' },
  { path: '/logs', icon: '📋', label: 'Logs' },
  { path: '/analytics', icon: '📈', label: 'Analytics' },
  { path: '/playground', icon: '🧪', label: 'Playground' },
  { path: '/health', icon: '💚', label: 'Health' },
];

let healthBadgeRefreshTimer = null;

export function renderSidebar(container) {
  const current = getCurrentPath();
  container.className = 'sidebar';
  container.innerHTML = `
    <div class="sidebar-brand">⚡ LosFurina</div>
    <div class="sidebar-search" id="search-trigger">
      <span>搜索...</span>
      <span class="kbd">⌘K</span>
    </div>
    <nav class="sidebar-nav">
      ${NAV.map(item => `
        <a href="${item.disabled ? '#' : '#' + item.path}"
           class="${current === item.path ? 'active' : ''}"
           data-path="${item.path}"
           style="${item.disabled ? 'opacity:0.4;cursor:not-allowed' : ''}">
          <span>${item.icon}</span>
          <span>${item.label}</span>
          ${item.path === '/health' ? '<span id="health-badge" style="margin-left:auto;width:6px;height:6px;border-radius:50%;background:var(--text-tertiary)"></span>' : ''}
        </a>
      `).join('')}
    </nav>
    <div class="sidebar-footer">
      <a href="#/settings" style="opacity:0.6;color:var(--text-tertiary);padding:8px 10px;font-size:13px;">⚙ Settings</a>
      <a id="logout-btn" style="cursor:pointer;color:var(--text-tertiary);padding:8px 10px;font-size:12px;">退出登录</a>
    </div>
  `;
  container.querySelector('#logout-btn').onclick = () => {
    clearToken();
    window.location.href = '/login.html';
  };
  container.querySelector('#search-trigger').onclick = () => {
    window.__openPalette && window.__openPalette();
  };
  window.addEventListener('hashchange', () => renderSidebar(container));

  refreshHealthBadge();
  if (healthBadgeRefreshTimer) clearInterval(healthBadgeRefreshTimer);
  healthBadgeRefreshTimer = setInterval(refreshHealthBadge, 60000);
}

async function refreshHealthBadge() {
  const badge = document.getElementById('health-badge');
  if (!badge) return;
  try {
    const list = await api('/api/providers');
    const enabled = list.filter(p => p.enabled);
    const hasUnhealthy = enabled.some(p => p.health_status === 'unhealthy');
    const hasDegraded = enabled.some(p => p.health_status === 'degraded');
    badge.style.background = hasUnhealthy ? 'var(--accent-red)' : hasDegraded ? 'var(--accent-yellow)' : 'var(--accent-green)';
  } catch {
    badge.style.background = 'var(--text-tertiary)';
  }
}
