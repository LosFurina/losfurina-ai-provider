import { getConfig } from './config.js';
import { authenticate, unauthorizedResponse } from './auth.js';
import { handleProxy } from './routes/proxy.js';
import { handleLogsApi } from './routes/api-logs.js';

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

    if (url.pathname.startsWith('/api/logs')) {
      return handleLogsApi(request, env);
    }

    if (url.pathname.startsWith('/v1/')) {
      if (!config.targetUrl) {
        return new Response(JSON.stringify({ error: { message: 'Target URL not configured', type: 'config_error' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return handleProxy(request, config, env, ctx);
    }

    // All other paths fall through to Static Assets binding
    return env.ASSETS.fetch(request);
  },
};
