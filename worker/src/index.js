const PAPAGO_URL = 'https://papago.apigw.ntruss.com/nmt/v1/translation';

function origins(env) {
  return (env.ALLOWED_ORIGINS || 'https://amepo.github.io,http://localhost:5174')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(origin ? corsHeaders(origin) : {}) },
  });
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/translate') return new Response('Not found', { status: 404 });

    const origin = request.headers.get('Origin') || '';
    if (!origins(env).includes(origin)) return json({ error: 'Origin not allowed' }, 403, '');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, origin);
    }

    if (!env.PAPAGO_CLIENT_ID || !env.PAPAGO_CLIENT_SECRET || !env.PAPAGO_PROXY_TOKEN) {
      return json({ error: 'Worker secrets are not configured' }, 500, origin);
    }
    const authorization = request.headers.get('Authorization') || '';
    const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!constantTimeEqual(suppliedToken, env.PAPAGO_PROXY_TOKEN)) {
      return json({ error: 'Unauthorized' }, 401, origin);
    }

    let input;
    try {
      input = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400, origin);
    }
    const { source, target, text } = input || {};
    if (!['ja', 'ko'].includes(source) || !['ja', 'ko'].includes(target) || source === target) {
      return json({ error: 'Only ja↔ko translation is supported' }, 400, origin);
    }
    if (typeof text !== 'string' || !text.trim() || [...text].length > 5000) {
      return json({ error: 'Text must contain 1 to 5000 characters' }, 400, origin);
    }

    const form = new URLSearchParams({ source, target, text: text.trim() });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const upstream = await fetch(PAPAGO_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-NCP-APIGW-API-KEY-ID': env.PAPAGO_CLIENT_ID,
          'X-NCP-APIGW-API-KEY': env.PAPAGO_CLIENT_SECRET,
        },
        body: form,
        signal: controller.signal,
      });
      if (!upstream.ok) {
        return json({ error: 'Papago request failed', status: upstream.status }, 502, origin);
      }
      const result = await upstream.json();
      const translatedText = result?.message?.result?.translatedText;
      if (typeof translatedText !== 'string' || !translatedText.trim()) {
        return json({ error: 'Papago returned an empty translation' }, 502, origin);
      }
      return json({ translatedText }, 200, origin);
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'Papago request timed out' : 'Papago is unavailable';
      return json({ error: message }, 502, origin);
    } finally {
      clearTimeout(timeout);
    }
  },
};
