(() => {
  'use strict';

  const API_PREFIX = 'https://ejeuttgrqxqxlpotbzao.supabase.co/functions/v1/midnight-lens-marketplace-v1';
  const runtime = globalThis.browser?.runtime || globalThis.chrome?.runtime;
  const originalFetch = globalThis.fetch.bind(globalThis);

  if (!runtime?.sendMessage) return;

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.startsWith(API_PREFIX)) return originalFetch(input, init);

    const parsed = new URL(url);
    const action = parsed.searchParams.get('action') || '';
    if (action !== 'ingest' || String(init.method || 'GET').toUpperCase() !== 'POST') {
      return originalFetch(input, init);
    }

    const headers = new Headers(init.headers || {});
    const session = headers.get('x-lens-session') || '';
    let payload = {};
    try { payload = JSON.parse(String(init.body || '{}')); } catch {}

    const message = await runtime.sendMessage({
      type: 'lens-marketplace-api',
      action,
      session,
      payload
    });

    const body = JSON.stringify(message?.data || { ok: false, code: message?.code || 'EXTENSION_BRIDGE_ERROR' });
    return new Response(body, {
      status: Number(message?.status || (message?.ok ? 200 : 502)),
      headers: { 'content-type': 'application/json' }
    });
  };
})();
