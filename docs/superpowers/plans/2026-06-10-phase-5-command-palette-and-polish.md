# Phase 5: Command Palette + Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the global ⌘K command palette (page jumps, time-range switching, model filters, log search), enhance saved views and add Playground session history, add micro-animations and empty-state polish across pages, harden error paths.

**Architecture:** Single command-palette overlay mounted globally in `app.js`. Indexes navigation, common time ranges, and live log/model search results. Saved views and Playground sessions both use `localStorage` namespaces.

**Tech Stack:** Vanilla DOM, CSS transitions, no new libraries.

**Spec reference:** `docs/superpowers/specs/2026-06-10-dashboard-v2-design.md` sections 4.3, 5.2, 5.4, 11.

**Prerequisite:** Phases 1-4 complete.

---

### Task 1: Add command palette CSS

**Files:**
- Modify: `public/styles.css`

- [ ] **Step 1: Append palette styles**

```css
/* Append to public/styles.css */

/* Command Palette */
.cmdk-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(6px);
  z-index: 100;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 100px;
  animation: cmdk-fade 0.15s ease;
}
@keyframes cmdk-fade { from { opacity: 0; } to { opacity: 1; } }

.cmdk-panel {
  width: 600px;
  max-width: 90vw;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-panel);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 480px;
  animation: cmdk-slide 0.15s ease;
}
@keyframes cmdk-slide { from { transform: translateY(-8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

.cmdk-input {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 16px;
  padding: 16px 20px;
  outline: none;
  border-bottom: 1px solid var(--border-subtle);
}
.cmdk-input::placeholder { color: var(--text-tertiary); }

.cmdk-list { overflow-y: auto; flex: 1; }

.cmdk-section {
  font-size: 10px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  padding: 12px 20px 4px;
  letter-spacing: 0.5px;
}

.cmdk-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 20px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
}
.cmdk-item.selected { background: var(--bg-overlay); }
.cmdk-item .icon { width: 18px; text-align: center; opacity: 0.8; }
.cmdk-item .meta { margin-left: auto; font-size: 11px; color: var(--text-tertiary); font-family: var(--font-mono); }
.cmdk-item .kbd {
  background: var(--bg-active); padding: 1px 6px; border-radius: 3px;
  font-size: 10px; color: var(--text-secondary);
}

/* Skeleton loader */
.skeleton {
  background: linear-gradient(90deg, var(--bg-elevated) 0%, var(--bg-overlay) 50%, var(--bg-elevated) 100%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
  border-radius: var(--radius-md);
}
@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Empty state */
.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-secondary);
}
.empty-state .icon { font-size: 36px; margin-bottom: 12px; opacity: 0.6; }
.empty-state .title { font-size: 14px; margin-bottom: 6px; color: var(--text-primary); }
.empty-state .desc { font-size: 12px; color: var(--text-tertiary); max-width: 400px; margin: 0 auto; line-height: 1.7; }

/* Page transitions */
.main > * { animation: page-fade 0.15s ease; }
@keyframes page-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
```

- [ ] **Step 2: Commit**

```bash
git add public/styles.css
git commit -m "feat(ui): command palette CSS + skeleton + empty state styles"
```

---

### Task 2: Build command registry

**Files:**
- Create: `public/components/command-registry.js`

- [ ] **Step 1: Create static command registry**

```javascript
// public/components/command-registry.js
import { api } from '/lib/api.js';
import { navigate } from '/lib/router.js';

const STATIC = [
  { id: 'nav-overview', section: 'Navigate', icon: '📊', title: 'Go to Overview', action: () => navigate('/overview') },
  { id: 'nav-logs', section: 'Navigate', icon: '📋', title: 'Go to Logs', action: () => navigate('/logs') },
  { id: 'nav-analytics', section: 'Navigate', icon: '📈', title: 'Go to Analytics', action: () => navigate('/analytics') },
  { id: 'nav-playground', section: 'Navigate', icon: '🧪', title: 'Go to Playground', action: () => navigate('/playground') },
  { id: 'nav-health', section: 'Navigate', icon: '💚', title: 'Go to Health', action: () => navigate('/health') },
  { id: 'nav-settings', section: 'Navigate', icon: '⚙', title: 'Go to Settings', action: () => navigate('/settings') },

  { id: 'logs-errors', section: 'Filters', icon: '🔴', title: 'Show errors only', subtitle: 'in Logs', action: () => {
      navigate('/logs');
      setTimeout(() => { window.dispatchEvent(new CustomEvent('cmdk:apply-filter', { detail: { status: '4xx' } })); }, 50);
  }},
  { id: 'logs-1h', section: 'Filters', icon: '⏱', title: 'Last 1 hour', subtitle: 'in Logs', action: () => {
      navigate('/logs');
      setTimeout(() => { window.dispatchEvent(new CustomEvent('cmdk:apply-filter', { detail: { hours: 1 } })); }, 50);
  }},
  { id: 'logs-24h', section: 'Filters', icon: '⏱', title: 'Last 24 hours', subtitle: 'in Logs', action: () => {
      navigate('/logs');
      setTimeout(() => { window.dispatchEvent(new CustomEvent('cmdk:apply-filter', { detail: { hours: 24 } })); }, 50);
  }},

  { id: 'probe-now', section: 'Actions', icon: '🔄', title: 'Probe all providers now', action: async () => {
      try { await api('/api/providers/probe', { method: 'POST' }); }
      catch (e) { alert(e.message); }
  }},
];

export function getStaticCommands() { return STATIC; }

export async function getDynamicCommands(query) {
  if (!query || query.length < 2) return [];
  const results = [];

  // Model lookups via /v1/models
  try {
    const models = await api('/v1/models');
    const matches = (models.data || []).filter(m => m.id.toLowerCase().includes(query.toLowerCase()));
    for (const m of matches.slice(0, 5)) {
      results.push({
        id: 'model-' + m.id,
        section: 'Models',
        icon: '🤖',
        title: `Filter logs by ${m.id}`,
        subtitle: `provided by ${m.owned_by}`,
        action: () => {
          navigate('/logs');
          setTimeout(() => window.dispatchEvent(new CustomEvent('cmdk:apply-filter', { detail: { models: [m.id], search: '' } })), 50);
        },
      });
    }
  } catch {}

  // Free-text search command
  results.push({
    id: 'search-' + query,
    section: 'Search',
    icon: '🔍',
    title: `Search logs for "${query}"`,
    action: () => {
      navigate('/logs');
      setTimeout(() => window.dispatchEvent(new CustomEvent('cmdk:apply-filter', { detail: { search: query } })), 50);
    },
  });

  return results;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/components/command-registry.js
git commit -m "feat(cmdk): static + dynamic command registry"
```

---

### Task 3: Build command palette overlay

**Files:**
- Create: `public/components/command-palette.js`
- Modify: `public/app.js`
- Modify: `public/components/sidebar.js`

- [ ] **Step 1: Create palette UI**

```javascript
// public/components/command-palette.js
import { getStaticCommands, getDynamicCommands } from '/components/command-registry.js';

let openPanel = null;
let selectedIdx = 0;
let items = [];

export function mountCommandPalette() {
  document.addEventListener('keydown', (e) => {
    const isMod = e.metaKey || e.ctrlKey;
    if (isMod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
    } else if (e.key === 'Escape' && openPanel) {
      closePalette();
    }
  });
}

export function openPalette() {
  if (openPanel) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'cmdk-backdrop';
  backdrop.innerHTML = `
    <div class="cmdk-panel" role="dialog">
      <input class="cmdk-input" id="cmdk-input" placeholder="搜索命令、跳转页面、查找模型..." autocomplete="off"/>
      <div class="cmdk-list" id="cmdk-list"></div>
    </div>
  `;
  document.body.appendChild(backdrop);
  openPanel = backdrop;

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closePalette();
  });

  const input = backdrop.querySelector('#cmdk-input');
  input.focus();
  input.addEventListener('input', () => refreshList(input.value));
  input.addEventListener('keydown', handleKey);
  refreshList('');
}

export function closePalette() {
  if (!openPanel) return;
  openPanel.remove();
  openPanel = null;
  selectedIdx = 0;
  items = [];
}

function handleKey(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = Math.min(items.length - 1, selectedIdx + 1); renderList(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = Math.max(0, selectedIdx - 1); renderList(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const item = items[selectedIdx];
    if (item) {
      item.action();
      closePalette();
    }
  }
}

async function refreshList(query) {
  const stat = getStaticCommands();
  const filteredStat = query
    ? stat.filter(c => c.title.toLowerCase().includes(query.toLowerCase()))
    : stat;
  let dynamic = [];
  if (query.length >= 2) {
    dynamic = await getDynamicCommands(query);
  }
  items = [...filteredStat, ...dynamic];
  selectedIdx = 0;
  renderList();
}

function renderList() {
  const list = openPanel?.querySelector('#cmdk-list');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-tertiary);font-size:12px">无匹配命令</div>';
    return;
  }

  // Group by section
  const groups = {};
  for (const it of items) {
    const k = it.section || 'Other';
    if (!groups[k]) groups[k] = [];
    groups[k].push(it);
  }

  let html = '';
  let idx = 0;
  for (const [section, group] of Object.entries(groups)) {
    html += `<div class="cmdk-section">${section}</div>`;
    for (const it of group) {
      const cls = idx === selectedIdx ? 'cmdk-item selected' : 'cmdk-item';
      html += `<div class="${cls}" data-idx="${idx}">
        <span class="icon">${it.icon || '·'}</span>
        <span>
          <div>${it.title}</div>
          ${it.subtitle ? `<div style="font-size:10px;color:var(--text-tertiary);margin-top:2px">${it.subtitle}</div>` : ''}
        </span>
      </div>`;
      idx++;
    }
  }
  list.innerHTML = html;

  list.querySelectorAll('.cmdk-item').forEach(el => {
    el.onclick = () => {
      const i = parseInt(el.dataset.idx, 10);
      items[i].action();
      closePalette();
    };
    el.onmouseenter = () => {
      selectedIdx = parseInt(el.dataset.idx, 10);
      renderList();
    };
  });

  const selectedEl = list.querySelector('.cmdk-item.selected');
  if (selectedEl) selectedEl.scrollIntoView({ block: 'nearest' });
}
```

- [ ] **Step 2: Mount in app.js**

```javascript
import { mountCommandPalette, openPalette } from '/components/command-palette.js';

// At end of app.js:
mountCommandPalette();

// Expose for sidebar trigger
window.__openPalette = openPalette;
```

- [ ] **Step 3: Update sidebar to open palette on click**

In `public/components/sidebar.js`, replace the `search-trigger` click handler:

```javascript
container.querySelector('#search-trigger').onclick = () => {
  window.__openPalette && window.__openPalette();
};
```

- [ ] **Step 4: Smoke test**

Run: `npm run dev`
1. Press ⌘K (or Ctrl+K) — palette opens
2. Type "logs" — see filtered nav items
3. Arrow keys move selection, Enter activates
4. Type "gpt" — see model commands (if a Provider has gpt-* models)
5. Click backdrop to close

- [ ] **Step 5: Commit**

```bash
git add public/components/command-palette.js public/app.js public/components/sidebar.js
git commit -m "feat(cmdk): global command palette with ⌘K shortcut"
```

---

### Task 4: Wire cmdk:apply-filter event in Logs page

**Files:**
- Modify: `public/pages/logs.js`

- [ ] **Step 1: Listen for filter events**

In `renderLogs`, after the filter bar setup, add:

```javascript
window.addEventListener('cmdk:apply-filter', (e) => {
  Object.assign(state.filters, e.detail);
  // Update UI controls to reflect new state
  const searchInput = document.getElementById('search');
  const hoursSel = document.getElementById('hours');
  const statusSel = document.getElementById('status');
  if (searchInput && 'search' in e.detail) searchInput.value = state.filters.search;
  if (hoursSel && 'hours' in e.detail) hoursSel.value = state.filters.hours;
  if (statusSel && 'status' in e.detail) statusSel.value = state.filters.status;
  doFetch();
});
```

- [ ] **Step 2: Smoke test**

Open palette → "Show errors only" → verify Logs page jumps + filter applied.

- [ ] **Step 3: Commit**

```bash
git add public/pages/logs.js
git commit -m "feat(logs): consume cmdk:apply-filter event for cross-page filter sync"
```

---

### Task 5: Add Playground session history (localStorage)

**Files:**
- Modify: `public/pages/playground.js`

- [ ] **Step 1: Save successful sessions and add history selector**

In `playground.js`, add at top:

```javascript
const HISTORY_KEY = 'playground_history_v1';
const HISTORY_LIMIT = 10;

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function saveHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT)));
}
function pushHistory(entry) {
  const items = loadHistory();
  items.unshift(entry);
  saveHistory(items);
}
```

In `send`, after successful response, push to history:

```javascript
pushHistory({
  ts: Date.now(),
  model: state.model,
  messages: state.messages.filter(m => m.content.trim()),
  response: data,
});
```

Add history dropdown into the config bar (in the `renderPlayground` template, after the send button):

```javascript
<select class="filter-chip" id="pg-history" style="margin-left:8px">
  <option value="">历史 ▾</option>
</select>
```

In `bindEvents`, populate and handle history:

```javascript
const histSel = container.querySelector('#pg-history');
const items = loadHistory();
histSel.innerHTML = '<option value="">历史 ▾</option>' + items.map((h, i) =>
  `<option value="${i}">${h.model} · ${new Date(h.ts).toLocaleTimeString('zh-CN', { hour12: false })}</option>`
).join('');
histSel.onchange = () => {
  const items = loadHistory();
  const h = items[parseInt(histSel.value, 10)];
  if (!h) return;
  state.model = h.model;
  state.messages = JSON.parse(JSON.stringify(h.messages));
  state.response = h.response;
  container.querySelector('#pg-model').value = h.model;
  renderMessages();
  renderResponse();
};
```

- [ ] **Step 2: Smoke test**

Run a few playground requests → reload page → check history dropdown → load a session → verify state restored.

- [ ] **Step 3: Commit**

```bash
git add public/pages/playground.js
git commit -m "feat(playground): localStorage session history with 10-item rolling cap"
```

---

### Task 6: Add provider_id filter on Logs page

**Files:**
- Modify: `src/db.js`
- Modify: `src/routes/api-logs.js`
- Modify: `public/pages/logs.js`

- [ ] **Step 1: Extend queryLogs to accept providerId**

In `src/db.js`, add to options:

```javascript
const { providerId } = opts;
// ... add to where clause:
if (providerId != null) { where.push('provider_id = ?'); args.push(providerId); }
```

- [ ] **Step 2: Wire param in api-logs.js**

```javascript
providerId: url.searchParams.has('provider_id') ? parseInt(url.searchParams.get('provider_id'), 10) : undefined,
```

- [ ] **Step 3: Add Provider filter dropdown in Logs filter bar**

In `renderFilterBar`, fetch `/api/providers` and add a select. Compact version:

```javascript
// After other filter elements:
<select class="filter-chip" id="provider-filter"><option value="">所有 Provider</option></select>

// In bindings:
const provSel = el.querySelector('#provider-filter');
import('/lib/api.js').then(({ api }) => api('/api/providers')).then(list => {
  provSel.innerHTML = '<option value="">所有 Provider</option>' + list.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}).catch(() => {});
provSel.onchange = (e) => {
  state.filters.providerId = e.target.value ? parseInt(e.target.value, 10) : null;
  doFetch();
};
```

And include `provider_id` in fetch query construction inside `fetchAndRender`:

```javascript
if (f.providerId != null) params.set('provider_id', f.providerId);
```

- [ ] **Step 4: Smoke test**

Verify the Provider dropdown populates and filter works.

- [ ] **Step 5: Commit**

```bash
git add src/db.js src/routes/api-logs.js public/pages/logs.js
git commit -m "feat(logs): provider_id filter dropdown"
```

---

### Task 7: Polish empty states + skeleton loaders

**Files:**
- Modify: `public/pages/logs.js`
- Modify: `public/pages/overview.js`
- Modify: `public/pages/analytics.js`
- Modify: `public/pages/health.js`

- [ ] **Step 1: Replace "加载中..." placeholders with skeleton blocks**

In each page, wherever we currently use a "加载中..." text node, use:

```html
<div class="skeleton" style="height: 60px; margin: 8px 0"></div>
<div class="skeleton" style="height: 60px; margin: 8px 0"></div>
<div class="skeleton" style="height: 60px; margin: 8px 0"></div>
```

Replace at minimum:
- `public/pages/logs.js` initial logs-list state
- `public/pages/overview.js` kpi-grid + trend-chart + active-models + recent-errors initial states
- `public/pages/analytics.js` cost-summary + breakdown initial states
- `public/pages/health.js` initial health-body state

- [ ] **Step 2: Replace empty render-rows fallback with empty-state class**

Where pages currently do `<div style="...暂无数据">`, use:

```html
<div class="empty-state">
  <div class="icon">📭</div>
  <div class="title">暂无数据</div>
  <div class="desc">满足过滤条件的日志为空。调整时间范围或过滤条件试试。</div>
</div>
```

- [ ] **Step 3: Smoke test**

Reload each page with empty DB — verify polished empty states render. During loads, skeletons shimmer.

- [ ] **Step 4: Commit**

```bash
git add public/pages
git commit -m "feat(ui): skeleton loaders + structured empty states across all pages"
```

---

### Task 8: Robust error handling + toast

**Files:**
- Create: `public/components/toast.js`
- Modify: `public/lib/api.js`
- Modify: `public/app.js`

- [ ] **Step 1: Create toast component**

```javascript
// public/components/toast.js
let root = null;

function ensureRoot() {
  if (root) return root;
  root = document.createElement('div');
  root.id = 'toast-root';
  root.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:200;display:flex;flex-direction:column;gap:8px;';
  document.body.appendChild(root);
  return root;
}

export function showToast(message, { type = 'info', duration = 4000 } = {}) {
  const r = ensureRoot();
  const colors = {
    info: 'var(--accent-blue)',
    error: 'var(--accent-red)',
    success: 'var(--accent-green)',
    warning: 'var(--accent-yellow)',
  };
  const el = document.createElement('div');
  el.style.cssText = `background:var(--bg-elevated);border-left:3px solid ${colors[type] || colors.info};color:var(--text-primary);padding:12px 16px;border-radius:6px;box-shadow:var(--shadow-panel);font-size:13px;max-width:360px;animation:toast-in 0.2s ease`;
  el.textContent = message;
  r.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.2s ease';
    setTimeout(() => el.remove(), 200);
  }, duration);
}
```

Add to styles.css:

```css
@keyframes toast-in {
  from { transform: translateX(20px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
```

- [ ] **Step 2: Update api.js to surface non-401 errors as toasts**

```javascript
// public/lib/api.js — replace fail branch
import { showToast } from '/components/toast.js';

// inside api(), after !res.ok check:
if (!res.ok) {
  const body = await res.text();
  showToast(`API ${res.status}: ${body.slice(0, 120)}`, { type: 'error' });
  throw new Error(`HTTP ${res.status}: ${body}`);
}
```

- [ ] **Step 3: Add global error handler in app.js**

```javascript
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.message?.startsWith('HTTP')) return; // already toasted
  console.error('unhandled:', e.reason);
  import('/components/toast.js').then(m => m.showToast('未知错误：' + (e.reason?.message || 'unknown'), { type: 'error' }));
});
```

- [ ] **Step 4: Smoke test**

Force a 500 by killing D1 (or by hitting a non-existent endpoint via console) — verify toast appears.

- [ ] **Step 5: Commit**

```bash
git add public/components/toast.js public/lib/api.js public/app.js public/styles.css
git commit -m "feat(ui): toast notifications + global error handling"
```

---

### Task 9: Saved views: rename + delete UI

**Files:**
- Modify: `public/pages/logs.js`

- [ ] **Step 1: Improve saved views UX**

Update the saved-view UI in `renderFilterBar` to use buttons instead of `<select>` and add inline delete:

```javascript
// Replace #load-view select block with:
<div id="saved-views" style="display:flex;gap:6px;flex-wrap:wrap"></div>

// New function:
function renderSavedViews(container) {
  const saved = JSON.parse(localStorage.getItem(VIEWS_KEY) || '{}');
  const el = container.querySelector('#saved-views');
  if (!el) return;
  el.innerHTML = Object.keys(saved).map(name => `
    <span class="filter-chip" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer" data-view-name="${name}">
      ${name}
      <span style="opacity:0.5;cursor:pointer" data-del-view="${name}">×</span>
    </span>
  `).join('');
  el.querySelectorAll('[data-view-name]').forEach(el => {
    el.onclick = (e) => {
      if (e.target.dataset.delView) return;
      loadSavedView(el.dataset.viewName);
    };
  });
  el.querySelectorAll('[data-del-view]').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      const name = el.dataset.delView;
      if (!confirm(`删除视图 "${name}"?`)) return;
      const saved = JSON.parse(localStorage.getItem(VIEWS_KEY) || '{}');
      delete saved[name];
      localStorage.setItem(VIEWS_KEY, JSON.stringify(saved));
      renderSavedViews(container);
    };
  });
}
```

Call `renderSavedViews(el)` instead of `populateSavedViews(...)`. Drop the old `populateSavedViews` function.

- [ ] **Step 2: Smoke test**

Save a view, see chip appear, click to load, click × to delete.

- [ ] **Step 3: Commit**

```bash
git add public/pages/logs.js
git commit -m "feat(logs): saved-view chips with inline delete"
```

---

### Task 10: Final QA pass + deploy

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Manual QA checklist (in `npm run dev`)**

- [ ] ⌘K opens palette, arrows + Enter work, Esc closes
- [ ] Navigate to each page via palette — all render
- [ ] Logs filter via palette ("Show errors only") applies correctly
- [ ] Saved views: save, load, delete all work
- [ ] Playground: history dropdown loads previous sessions
- [ ] Provider filter in Logs works
- [ ] Skeletons render during slow loads (throttle network in DevTools)
- [ ] Empty states render when D1 is empty
- [ ] Toast appears on API errors
- [ ] Alert banner appears when unacknowledged alert exists
- [ ] Page transitions animate
- [ ] No console errors

- [ ] **Step 3: Deploy**

Run: `npm run deploy`
Expected: success.

- [ ] **Step 4: Production sanity check**

Repeat key checks (⌘K, navigation, polling, alert banner) on production URL.

---

## Self-Review Checklist

Against spec sections 4.3, 5.2, 5.4, 11:

- [ ] ⌘K / Ctrl+K opens overlay (spec 4.3)
- [ ] Backdrop click + Esc close palette (spec 4.3)
- [ ] Arrow key navigation + Enter activation (spec 4.3)
- [ ] Static commands: page jumps + time-range + actions (spec 4.3)
- [ ] Dynamic commands: model lookups + free-text search (spec 4.3)
- [ ] Saved views with delete (spec 5.2)
- [ ] Playground history (spec 5.4)
- [ ] Provider filter on Logs (spec 5.2)
- [ ] Skeleton loaders (spec 11.3)
- [ ] Empty states with helpful copy (spec 11.3)
- [ ] Toast notifications for errors (spec 11.3)
- [ ] Page transition animations (spec 4.1)
- [ ] All tests pass
- [ ] No console errors in production

Items intentionally NOT in scope:
- Theme switcher (light mode) — single dark theme by design
- Mobile responsive — desktop-only per spec
- Multi-user / shared views — single-user product
