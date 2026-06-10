function escapeMarkdownV2(text) {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

export function formatLogEntry(logEntry) {
  const { model, method, path, status, durationMs, promptTokens, completionTokens, totalTokens } = logEntry;
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

  return lines.join('\n');
}

export function formatBatchLog(entries) {
  return entries.map(entry => formatLogEntry(entry)).join('\n\n---\n\n');
}
