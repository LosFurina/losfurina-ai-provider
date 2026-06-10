/**
 * Centralized configuration reader.
 * All env vars accessed through this module.
 */
export function getConfig(env) {
  return {
    workerApiKey: env.WORKER_API_KEY || '',
    telegramBotToken: env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: env.TELEGRAM_CHAT_ID || '',
  };
}
