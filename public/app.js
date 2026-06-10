import { startRouter, registerRoute } from '/lib/router.js';
import { getToken } from '/lib/api.js';
import { renderSidebar } from '/components/sidebar.js';
import { renderLogs } from '/pages/logs.js';

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

// Phase 1: only Logs route; other routes added in later phases
registerRoute('/', (container) => renderLogs(container));
registerRoute('/logs', (container) => renderLogs(container));

startRouter(document.getElementById('main'));
