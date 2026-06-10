// public/components/json-viewer.js
export function renderJsonViewer(rawText) {
  if (!rawText) return '<div class="json-viewer">(空)</div>';
  let formatted;
  try {
    const parsed = JSON.parse(rawText);
    formatted = JSON.stringify(parsed, null, 2);
  } catch {
    return `<div class="json-viewer">${escapeHtml(rawText)}</div>`;
  }
  const highlighted = escapeHtml(formatted)
    .replace(/("(?:[^"\\]|\\.)*")(\s*:)/g, '<span class="json-key">$1</span>$2')
    .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span class="json-string">$1</span>')
    .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
    .replace(/:\s*(true|false|null)/g, ': <span class="json-bool">$1</span>');
  return `<div class="json-viewer">${highlighted}</div>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
