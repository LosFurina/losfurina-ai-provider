// src/lib/usage.js
// Parses token usage from upstream response bodies.
// Supports: OpenAI JSON, Anthropic JSON, Anthropic SSE stream.

const ZERO = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
};

export function parseUsage(body, contentType = '') {
  if (!body) return { ...ZERO };

  const isSse = contentType.includes('text/event-stream') ||
    body.startsWith('event:') || body.startsWith('data:');

  if (isSse) return parseSse(body);

  try {
    const parsed = JSON.parse(body);
    return extractUsage(parsed?.usage);
  } catch {
    return { ...ZERO };
  }
}

function extractUsage(usage) {
  if (!usage || typeof usage !== 'object') return { ...ZERO };

  // Anthropic uses input_tokens / output_tokens; OpenAI uses prompt_tokens / completion_tokens.
  const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const totalTokens = usage.total_tokens ??
    (promptTokens + completionTokens + cacheCreationTokens + cacheReadTokens);

  return { promptTokens, completionTokens, totalTokens, cacheCreationTokens, cacheReadTokens };
}

function parseSse(body) {
  const result = { ...ZERO };
  // Split on lines starting with "data:" — each is a JSON event
  const lines = body.split('\n');
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let obj;
    try { obj = JSON.parse(payload); } catch { continue; }

    // message_start: full usage with input_tokens + cache fields, output_tokens=1 placeholder
    if (obj.type === 'message_start' && obj.message?.usage) {
      const u = obj.message.usage;
      result.promptTokens = u.input_tokens ?? 0;
      result.cacheCreationTokens = u.cache_creation_input_tokens ?? 0;
      result.cacheReadTokens = u.cache_read_input_tokens ?? 0;
      // capture initial output_tokens too in case there's no message_delta
      result.completionTokens = u.output_tokens ?? 0;
    }
    // message_delta: final output_tokens (overwrite placeholder)
    if (obj.type === 'message_delta' && obj.usage?.output_tokens != null) {
      result.completionTokens = obj.usage.output_tokens;
    }
  }

  result.totalTokens = result.promptTokens + result.completionTokens +
    result.cacheCreationTokens + result.cacheReadTokens;

  return result;
}
