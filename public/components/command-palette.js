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
