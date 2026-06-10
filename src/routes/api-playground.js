// src/routes/api-playground.js
import { handleProxy } from './proxy.js';

export async function handlePlayground(request, config, env, ctx) {
  const body = await request.text();
  const fakeUrl = new URL(request.url);
  fakeUrl.pathname = '/v1/chat/completions';
  const fakeReq = new Request(fakeUrl.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Playground': '1' },
    body,
  });
  return handleProxy(fakeReq, config, env, ctx);
}
