// public/components/side-panel.js
export function openSidePanel({ title, bodyHtml }) {
  const existing = document.getElementById('side-panel-root');
  if (existing) existing.remove();

  const root = document.createElement('div');
  root.id = 'side-panel-root';
  root.innerHTML = `
    <div class="side-panel-overlay"></div>
    <aside class="side-panel">
      <div class="side-panel-header">
        <div style="font-weight:600">${title}</div>
        <button id="side-panel-close" style="background:none;border:none;color:var(--text-secondary);font-size:14px;">关闭</button>
      </div>
      <div class="side-panel-body" id="side-panel-body">${bodyHtml}</div>
    </aside>
  `;
  document.body.appendChild(root);

  // Trigger transition
  requestAnimationFrame(() => {
    root.querySelector('.side-panel').classList.add('open');
  });

  const close = () => {
    root.querySelector('.side-panel').classList.remove('open');
    setTimeout(() => root.remove(), 200);
  };
  root.querySelector('.side-panel-overlay').onclick = close;
  root.querySelector('#side-panel-close').onclick = close;

  return { close, body: root.querySelector('#side-panel-body') };
}
