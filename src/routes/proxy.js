import { insertLog } from '../db.js';
import { formatBatchLog } from '../logger.js';
import { sendTelegramMessage } from '../telegram.js';
import { LogBuffer } from '../buffer.js';

const logBuffer = new LogBuffer();

export async function handleProxy(request, config, env, ctx) {
  const startTime = Date.now();
  const requestBody = await request.clone().text();

  let model = 'unknown';
  try {
    if (requestBody) {
      const parsed = JSON.parse(requestBody);
      model = parsed.model || 'unknown';
    }
  } catch {}

  try {
    const targetUrl = new URL(request.url).pathname;
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${config.targetApiKey}`);
    headers.delete('Host');

    const targetResponse = await fetch(new URL(targetUrl, config.targetUrl).toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' ? undefined : requestBody,
    });

    const responseClone = targetResponse.clone();
    const responseBody = await responseClone.text();
    const durationMs = Date.now() - startTime;

    let promptTokens = 0, completionTokens = 0, totalTokens = 0;
    try {
      const parsed = JSON.parse(responseBody);
      if (parsed.usage) {
        promptTokens = parsed.usage.prompt_tokens || 0;
        completionTokens = parsed.usage.completion_tokens || 0;
        totalTokens = parsed.usage.total_tokens || 0;
      }
    } catch {}

    const logEntry = {
      timestamp: new Date().toISOString(),
      model,
      method: request.method,
      path: targetUrl,
      status: targetResponse.status,
      durationMs,
      promptTokens,
      completionTokens,
      totalTokens,
      requestBody,
      responseBody,
    };

    ctx.waitUntil(insertLog(env.DB, logEntry).catch(err => {
      console.error('D1 insert error:', err.message);
    }));

    const flushFn = async (entries) => {
      try {
        const message = formatBatchLog(entries);
        await sendTelegramMessage(config, message);
      } catch (err) {
        console.error('Telegram flush error:', err.message);
      }
    };
    logBuffer.push(logEntry, flushFn, ctx);

    return new Response(responseBody, {
      status: targetResponse.status,
      statusText: targetResponse.statusText,
      headers: targetResponse.headers,
    });
  } catch (err) {
    console.error('Proxy error:', err.message);
    return new Response(JSON.stringify({ error: { message: 'Upstream request failed', detail: err.message, type: 'proxy_error' } }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
