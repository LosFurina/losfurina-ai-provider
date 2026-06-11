// public/lib/summarize.js
// Pure helpers that distill request/response bodies into human-readable summaries
// for the Logs detail side panel. Handle both Anthropic and OpenAI schemas.

export function summarizeRequest(rawBody) {
  if (!rawBody) return null;
  let body;
  try { body = JSON.parse(rawBody); } catch { return null; }

  const out = {
    model: body.model || null,
    stream: body.stream === true,
    maxTokens: body.max_tokens ?? body.max_completion_tokens ?? null,
    temperature: body.temperature ?? null,
    toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
    toolNames: Array.isArray(body.tools)
      ? body.tools.map(t => t.name || t.function?.name).filter(Boolean)
      : [],
    system: extractSystem(body),
    messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
    lastUserText: extractLastUserText(body.messages),
  };
  return out;
}

function extractSystem(body) {
  // Anthropic: top-level `system` field (string) or array of content blocks
  if (typeof body.system === 'string') return body.system;
  if (Array.isArray(body.system)) {
    return body.system
      .map(b => typeof b === 'string' ? b : (b?.text || ''))
      .join('\n')
      .trim() || null;
  }
  // OpenAI: first message with role='system'
  if (Array.isArray(body.messages)) {
    const sysMsg = body.messages.find(m => m?.role === 'system');
    if (sysMsg) return contentToText(sysMsg.content);
  }
  return null;
}

function extractLastUserText(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return contentToText(messages[i].content);
  }
  return null;
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        if (part?.type === 'image') return '[image]';
        if (part?.type === 'tool_use') return `[tool_use: ${part.name || ''}]`;
        if (part?.type === 'tool_result') return `[tool_result]`;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return null;
}

export function summarizeResponse(rawBody, contentType = '') {
  if (!rawBody) return null;
  const isSse = contentType.includes('text/event-stream') ||
    rawBody.startsWith('event:') || rawBody.startsWith('data:');

  if (isSse) return summarizeSse(rawBody);
  return summarizeJson(rawBody);
}

function summarizeJson(rawBody) {
  let body;
  try { body = JSON.parse(rawBody); } catch { return null; }

  // Anthropic non-stream: { content: [{type:'text', text:'...'}], stop_reason }
  if (Array.isArray(body.content)) {
    const text = body.content
      .map(b => b?.type === 'text' ? b.text : '')
      .filter(Boolean)
      .join('\n');
    return { text, stopReason: body.stop_reason || null };
  }

  // OpenAI: { choices:[{message:{content:'...'}, finish_reason}] }
  if (Array.isArray(body.choices) && body.choices[0]) {
    const c = body.choices[0];
    return {
      text: c.message?.content ?? '',
      stopReason: c.finish_reason || null,
    };
  }

  // Error responses
  if (body.error) {
    return { text: '', stopReason: null, error: body.error.message || JSON.stringify(body.error) };
  }

  return null;
}

function summarizeSse(rawBody) {
  let text = '';
  let stopReason = null;

  for (const line of rawBody.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let obj;
    try { obj = JSON.parse(payload); } catch { continue; }

    // Anthropic: content_block_delta carries text deltas
    if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta') {
      text += obj.delta.text || '';
    }
    if (obj.type === 'message_delta' && obj.delta?.stop_reason) {
      stopReason = obj.delta.stop_reason;
    }

    // OpenAI streaming: choices[0].delta.content
    if (Array.isArray(obj.choices) && obj.choices[0]) {
      const ch = obj.choices[0];
      if (ch.delta?.content) text += ch.delta.content;
      if (ch.finish_reason) stopReason = ch.finish_reason;
    }
  }

  return { text, stopReason };
}
