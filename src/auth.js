/**
 * Authentication module.
 * Validates Bearer token against WORKER_API_KEY.
 */
export function authenticate(request, config) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, body: { error: { message: 'Missing or invalid Authorization header', type: 'auth_error' } } };
  }
  const token = authHeader.slice(7);
  if (token !== config.workerApiKey) {
    return { ok: false, status: 401, body: { error: { message: 'Invalid API key', type: 'auth_error' } } };
  }
  return { ok: true };
}

export function unauthorizedResponse() {
  return new Response(
    JSON.stringify({ error: { message: 'Unauthorized', type: 'auth_error' } }),
    { status: 401, headers: { 'Content-Type': 'application/json' } }
  );
}
