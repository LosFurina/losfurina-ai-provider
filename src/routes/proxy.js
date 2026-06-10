// src/routes/proxy.js
import { resolveProvider } from '../lib/router.js';
import { calculateCost } from '../lib/pricing.js';
import { insertLog } from '../db.js';
import { formatBatchLog } from '../logger.js';
import { sendTelegramMessage } from '../telegram.js';
import { LogBuffer } from '../buffer.js';

const logBuffer = new LogBuffer();

export async function handleProxy(request, config, env, ctx) {
  const startTime = Date.now();
  const requestBody = await request.clone().text();

  let model = null;
  try {
    if (requestBody) {
      const parsed = JSON.parse(requestBody);
      model = parsed.model || null;
    }
  } catch {}

  if (!model) {
    return jsonError(400, 'missing_model', 'model field is required in request body');
  }

  const provider = await resolveProvider(env.DB, model);
  if (!provider) {
    // Distinguish "no providers configured at all" vs "model not found"
    const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM providers WHERE enabled = 1').all();
    if (!results[0].n) {
      return jsonError(503, 'no_providers', 'no providers configured; insert into providers table to start routing');
    }
    return jsonError(404, 'model_not_found', `no enabled healthy provider owns model "${model}"`);
  }

  try {
    const pathname = new URL(request.url).pathname;
    const targetUrl = joinUrl(provider.base_url, pathname);
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${provider.api_key}`);
    headers.delete('Host');

    const targetResponse = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method === 'GET' ? undefined : requestBody,
    });

    const responseBody = await targetResponse.clone().text();
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

    const costUsd = await calculateCost(env.DB, model, promptTokens, completionTokens);

    const logEntry = {
      timestamp: new Date().toISOString(),
      model,
      method: request.method,
      path: pathname,
      status: targetResponse.status,
      durationMs,
      promptTokens,
      completionTokens,
      totalTokens,
      requestBody,
      responseBody,
      costUsd,
      source: 'proxy',
      providerId: provider.id,
    };

    ctx.waitUntil(insertLog(env.DB, logEntry).catch(err => {
      console.error('D1 insert error:', err.message);
    }));

    const flushFn = async (entries) => {
      try { await sendTelegramMessage(config, formatBatchLog(entries)); }
      catch (err) { console.error('Telegram flush error:', err.message); }
    };
    logBuffer.push(logEntry, flushFn, ctx);

    return new Response(responseBody, {
      status: targetResponse.status,
      statusText: targetResponse.statusText,
      headers: targetResponse.headers,
    });
  } catch (err) {
    console.error('Proxy error:', err.message);
    return jsonError(502, 'proxy_error', err.message);
  }
}

function joinUrl(base, pathname) {
  const trimmedBase = base.replace(/\/$/, '');
  // Strip leading /v1 from pathname if base already ends with /v1
  let path = pathname;
  if (trimmedBase.endsWith('/v1') && path.startsWith('/v1/')) {
    path = path.slice(3);
  }
  return trimmedBase + path;
}

function jsonError(status, type, message) {
  return new Response(JSON.stringify({ error: { type, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
