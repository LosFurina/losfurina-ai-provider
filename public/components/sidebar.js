// public/components/sidebar.js
import { clearToken } from '/lib/api.js';
import { getCurrentPath } from '/lib/router.js';

const NAV = [
  { path: '/overview', icon: '📊', label: 'Overview' },
  { path: '/logs', icon: '📋', label: 'Logs' },
  { path: '/analytics', icon: '📈', label: 'Analytics' },
  { path: '/playground', icon: '🧪', label: 'Playground', disabled: true },
  { path: '/health', icon: '💚', label: 'Health' },
];

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
           style="${item.disabled ? 'opacity:0.4;cursor:not-allowed' : ''}">
          <span>${item.icon}</span><span>${item.label}</span>
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
  // ⌘K placeholder — wired in Phase 5
  container.querySelector('#search-trigger').onclick = () => {
    alert('Command palette coming in Phase 5');
  };
  window.addEventListener('hashchange', () => renderSidebar(container));
}
