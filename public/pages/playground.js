// public/pages/playground.js
import { api } from '/lib/api.js';

const state = {
  model: '',
  maxTokens: 4096,
  temperature: 0.7,
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: '' },
  ],
  response: null,
  loading: false,
  showRaw: false,
};

let availableModels = [];

export function renderPlayground(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Playground</div>
        <div class="page-subtitle">通过网关测试模型（注意：真实调用，会产生费用）</div>
      </div>
    </div>
    <div style="flex:1;display:flex;overflow:hidden">
      <div style="flex:1;border-right:1px solid var(--border-subtle);display:flex;flex-direction:column">
        <div style="padding:12px 20px;border-bottom:1px solid var(--border-subtle);display:flex;gap:10px;align-items:center">
          <select class="filter-chip" id="pg-model" style="min-width:160px"></select>
          <label style="font-size:11px;color:var(--text-secondary)">max_tokens
            <input id="pg-max" type="number" value="${state.maxTokens}" style="width:80px;background:var(--bg-overlay);border:1px solid var(--border-default);color:var(--text-primary);padding:4px 6px;border-radius:4px;margin-left:4px"/>
          </label>
          <label style="font-size:11px;color:var(--text-secondary)">temp
            <input id="pg-temp" type="number" step="0.1" min="0" max="2" value="${state.temperature}" style="width:60px;background:var(--bg-overlay);border:1px solid var(--border-default);color:var(--text-primary);padding:4px 6px;border-radius:4px;margin-left:4px"/>
          </label>
          <button class="filter-chip" id="pg-send" style="margin-left:auto;background:var(--accent-blue);color:white;padding:6px 14px">▶ 发送</button>
        </div>
        <div style="flex:1;padding:16px 20px;overflow-y:auto" id="pg-messages"></div>
        <div style="padding:10px 20px;border-top:1px solid var(--border-subtle)">
          <button class="filter-chip" id="pg-add-msg">+ 添加消息</button>
        </div>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;background:#0c0e14">
        <div style="padding:12px 20px;border-bottom:1px solid var(--border-subtle);font-size:11px;color:var(--text-tertiary)" id="pg-resp-meta">尚未发送请求</div>
        <div style="flex:1;padding:16px 20px;overflow-y:auto" id="pg-response"></div>
        <div style="padding:10px 20px;border-top:1px solid var(--border-subtle);display:flex;gap:12px;font-size:11px">
          <span id="pg-toggle-rendered" style="color:var(--accent-blue);cursor:pointer;border-bottom:1px solid var(--accent-blue)">渲染</span>
          <span id="pg-toggle-raw" style="color:var(--text-tertiary);cursor:pointer">原始 JSON</span>
          <span id="pg-copy" style="margin-left:auto;color:var(--text-tertiary);cursor:pointer">复制响应</span>
        </div>
      </div>
    </div>
  `;
  loadModels(container);
  renderMessages();
  bindEvents(container);
}

async function loadModels(container) {
  try {
    const data = await api('/v1/models');
    availableModels = (data.data || []).map(m => m.id);
    const sel = container.querySelector('#pg-model');
    sel.innerHTML = availableModels.map(m => `<option value="${m}">${m}</option>`).join('');
    if (availableModels[0]) state.model = availableModels[0];
  } catch (e) {
    console.error('failed to load models', e);
  }
}

function bindEvents(container) {
  container.querySelector('#pg-model').onchange = e => state.model = e.target.value;
  container.querySelector('#pg-max').oninput = e => state.maxTokens = parseInt(e.target.value, 10) || 4096;
  container.querySelector('#pg-temp').oninput = e => state.temperature = parseFloat(e.target.value) || 0.7;
  container.querySelector('#pg-add-msg').onclick = () => {
    state.messages.push({ role: 'user', content: '' });
    renderMessages();
  };
  container.querySelector('#pg-send').onclick = () => send(container);
  container.querySelector('#pg-toggle-rendered').onclick = () => { state.showRaw = false; renderResponse(); };
  container.querySelector('#pg-toggle-raw').onclick = () => { state.showRaw = true; renderResponse(); };
  container.querySelector('#pg-copy').onclick = () => {
    navigator.clipboard.writeText(JSON.stringify(state.response, null, 2));
  };
}

function renderMessages() {
  const el = document.getElementById('pg-messages');
  el.innerHTML = state.messages.map((m, i) => `
    <div style="margin-bottom:12px">
      <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:6px;display:flex;gap:6px;align-items:center">
        <select data-i="${i}" class="msg-role" style="background:var(--bg-overlay);color:var(--text-secondary);border:1px solid var(--border-default);padding:1px 6px;border-radius:3px;font-size:10px">
          <option value="system" ${m.role === 'system' ? 'selected' : ''}>system</option>
          <option value="user" ${m.role === 'user' ? 'selected' : ''}>user</option>
          <option value="assistant" ${m.role === 'assistant' ? 'selected' : ''}>assistant</option>
        </select>
        <span style="margin-left:auto;cursor:pointer;color:var(--accent-red)" data-del="${i}">×</span>
      </div>
      <textarea data-i="${i}" class="msg-content" style="width:100%;min-height:60px;background:var(--bg-elevated);border:1px solid var(--border-subtle);color:var(--text-primary);padding:10px;border-radius:6px;font-family:var(--font-mono);font-size:11px;resize:vertical">${escapeHtml(m.content)}</textarea>
    </div>
  `).join('');
  el.querySelectorAll('.msg-role').forEach(s => s.onchange = e => state.messages[parseInt(s.dataset.i, 10)].role = e.target.value);
  el.querySelectorAll('.msg-content').forEach(t => t.oninput = e => state.messages[parseInt(t.dataset.i, 10)].content = e.target.value);
  el.querySelectorAll('[data-del]').forEach(x => x.onclick = () => {
    const i = parseInt(x.dataset.del, 10);
    state.messages.splice(i, 1);
    renderMessages();
  });
}

async function send(container) {
  if (!state.model) { alert('请选择模型'); return; }
  state.loading = true;
  document.getElementById('pg-resp-meta').textContent = '发送中...';
  document.getElementById('pg-response').innerHTML = '<div style="color:var(--text-tertiary);text-align:center;padding:40px">⏳ 等待响应...</div>';
  const t0 = Date.now();
  try {
    const data = await api('/api/playground', {
      method: 'POST',
      body: JSON.stringify({
        model: state.model,
        max_tokens: state.maxTokens,
        temperature: state.temperature,
        messages: state.messages.filter(m => m.content.trim()),
      }),
    });
    const dt = Date.now() - t0;
    const usage = data.usage || {};
    state.response = data;
    document.getElementById('pg-resp-meta').innerHTML = `
      延迟: <span style="color:var(--accent-green)">${dt}ms</span> ·
      Tokens: <span style="color:var(--text-primary)">${usage.prompt_tokens || 0} + ${usage.completion_tokens || 0} = ${usage.total_tokens || 0}</span>
    `;
    renderResponse();
  } catch (e) {
    document.getElementById('pg-response').innerHTML = `<div style="color:var(--accent-red);padding:20px">${e.message}</div>`;
  } finally {
    state.loading = false;
  }
}

function renderResponse() {
  const el = document.getElementById('pg-response');
  if (!state.response) return;
  if (state.showRaw) {
    el.innerHTML = `<pre style="margin:0;font-family:var(--font-mono);font-size:11px;color:var(--text-primary);white-space:pre-wrap;word-break:break-word">${escapeHtml(JSON.stringify(state.response, null, 2))}</pre>`;
  } else {
    const content = state.response.choices?.[0]?.message?.content || '(空响应)';
    el.innerHTML = `<div style="font-size:13px;line-height:1.7;color:var(--text-primary);white-space:pre-wrap">${escapeHtml(content)}</div>`;
  }
  document.getElementById('pg-toggle-rendered').style.cssText = state.showRaw
    ? 'color:var(--text-tertiary);cursor:pointer'
    : 'color:var(--accent-blue);cursor:pointer;border-bottom:1px solid var(--accent-blue)';
  document.getElementById('pg-toggle-raw').style.cssText = state.showRaw
    ? 'color:var(--accent-blue);cursor:pointer;border-bottom:1px solid var(--accent-blue)'
    : 'color:var(--text-tertiary);cursor:pointer';
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
