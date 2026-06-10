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
