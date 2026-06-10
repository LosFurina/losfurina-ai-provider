import { startRouter, registerRoute } from '/lib/router.js';
import { getToken } from '/lib/api.js';
import { renderSidebar } from '/components/sidebar.js';
import { renderLogs } from '/pages/logs.js';
import { renderOverview } from '/pages/overview.js';
import { renderAnalytics } from '/pages/analytics.js';

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

startRouter(document.getElementById('main'));
