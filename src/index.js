import { getConfig } from './config.js';
import { authenticate, unauthorizedResponse } from './auth.js';
import { handleProxy } from './routes/proxy.js';
import { handleLogsApi } from './routes/api-logs.js';
import { handleProvidersApi } from './routes/api-providers.js';
import { handleAdminApi } from './routes/api-admin.js';
import { handlePlayground } from './routes/api-playground.js';
import { handleModelsList } from './routes/models.js';
import { probeAllProviders, purgeOldHealthLogs } from './lib/healthcheck.js';
import { purgeOldLogs } from './db.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const config = getConfig(env);

    // Health check — no auth
    if (url.pathname === '/health' && request.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Auth for API and proxy
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/')) {
      const auth = authenticate(request, config);
      if (!auth.ok) return unauthorizedResponse();
    }

    if (url.pathname.startsWith('/api/admin/')) {
      return handleAdminApi(request, env);
    }

    if (url.pathname === '/api/playground' && request.method === 'POST') {
      return handlePlayground(request, config, env, ctx);
    }

    if (url.pathname.startsWith('/api/logs')) {
      return handleLogsApi(request, env);
    }

    if (url.pathname.startsWith('/api/providers')) {
      return handleProvidersApi(request, env, ctx);
    }

    if (url.pathname === '/v1/models' && request.method === 'GET') {
      return handleModelsList(request, env);
    }

    if (url.pathname.startsWith('/v1/')) {
      return handleProxy(request, config, env, ctx);
    }

    // All other paths fall through to Static Assets binding
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    await probeAllProviders(env, ctx);
    // Purge once per hour (cron fires every 5 min)
    const minutes = new Date().getUTCMinutes();
    if (minutes < 5) {
      await purgeOldHealthLogs(env, 7);
      await purgeOldLogs(env.DB, 7);
    }
  },
};
