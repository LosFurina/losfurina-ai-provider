import { startRouter, registerRoute } from '/lib/router.js';
import { getToken } from '/lib/api.js';
import { renderSidebar } from '/components/sidebar.js';
import { mountAlertBanner } from '/components/alert-banner.js';
import { mountCommandPalette, openPalette } from '/components/command-palette.js';
import { renderLogs } from '/pages/logs.js';
import { renderOverview } from '/pages/overview.js';
import { renderAnalytics } from '/pages/analytics.js';
import { renderHealth } from '/pages/health.js';
import { renderPlayground } from '/pages/playground.js';
import { renderSettings } from '/pages/settings.js';

if (!getToken()) {
  window.location.href = '/login.html';
}

const app = document.getElementById('app');
app.innerHTML = `
  <div class="app-shell">
    <aside id="sidebar"></aside>
    <main class="main" id="main"></main>
  </div>
`;

renderSidebar(document.getElementById('sidebar'));

registerRoute('/', (container) => renderOverview(container));
registerRoute('/overview', (container) => renderOverview(container));
registerRoute('/logs', (container) => renderLogs(container));
registerRoute('/analytics', (container) => renderAnalytics(container));
registerRoute('/health', (container) => renderHealth(container));
registerRoute('/playground', (container) => renderPlayground(container));
registerRoute('/settings', (container) => renderSettings(container));

startRouter(document.getElementById('main'));

mountAlertBanner();

mountCommandPalette();
window.__openPalette = openPalette;
