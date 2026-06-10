import { aggregateModels } from '../lib/router.js';

export async function handleModelsList(request, env) {
  const data = await aggregateModels(env.DB);
  return new Response(JSON.stringify({ object: 'list', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
