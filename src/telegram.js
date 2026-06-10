/**
 * Telegram Bot API notification sender.
 */
export async function sendTelegramMessage(config, text) {
  if (!config.telegramBotToken || !config.telegramChatId) {
    return; // Telegram not configured, silently skip
  }
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text: text,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
      }),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Telegram send failed:', response.status, errorBody);
    }
  } catch (err) {
    console.error('Telegram send error:', err.message);
  }
}
