/**
 * Formats log entries into Markdown for Telegram.
 */

function escapeMarkdownV2(text) {
  // MarkdownV2 requires escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

export function formatLogEntry(logEntry) {
  const { model, method, path, status, durationMs, promptTokens, completionTokens, totalTokens, requestSummary, responseSummary } = logEntry;
  const statusIcon = status >= 200 && status < 300 ? '✅' : status >= 400 ? '❌' : '⚠️';
  const time = new Date(logEntry.timestamp).toLocaleTimeString('zh-CN', { hour12: false });

  const lines = [
    `*${escapeMarkdownV2(time)}* ${statusIcon}`,
    `**模型:** \`${escapeMarkdownV2(model)}\``,
    `**路径:** \`${escapeMarkdownV2(method)} ${escapeMarkdownV2(path)}\``,
    '',
    '**📊 Token 用量**',
    `| 类型 | 数量 |`,
    `|------|------|`,
    `| 🆔 Prompt | ${promptTokens} |`,
    `| 💡 Completion | ${completionTokens} |`,
    `| 📦 总计 | ${totalTokens} |`,
    '',
    `**⏱ 性能**`,
    `- **耗时:** ${durationMs}ms`,
    `- **状态码:** ${status} ${statusIcon}`,
  ];

  if (requestSummary) {
    lines.push('', '**📥 请求摘要**', '```', escapeMarkdownV2(requestSummary), '```');
  }

  if (responseSummary) {
    lines.push('', '**📤 响应摘要**', '```', escapeMarkdownV2(responseSummary), '```');
  }

  return lines.join('\n');
}

export function formatBatchLog(entries) {
  return entries.map(entry => formatLogEntry(entry)).join('\n\n---\n\n');
}

export function summarizeBody(text, maxLen = 2000) {
  if (!text) return '';
  try {
    const parsed = JSON.parse(text);
    // Request format: extract messages
    if (parsed.messages && Array.isArray(parsed.messages)) {
      // Return the last user message
      const lastUserMsg = [...parsed.messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg?.content) {
        const content = typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content);
        return content.slice(0, maxLen);
      }
      // Fallback: return all messages as text
      return parsed.messages.map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n').slice(0, maxLen);
    }
    // Response format: extract choices[0].message.content
    if (parsed.choices && Array.isArray(parsed.choices)) {
      const content = parsed.choices[0]?.message?.content;
      if (content) return content.slice(0, maxLen);
    }
    // Fallback: content field
    if (parsed.content) {
      const content = typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content);
      return content.slice(0, maxLen);
    }
  } catch {}
  return text.slice(0, maxLen);
}
