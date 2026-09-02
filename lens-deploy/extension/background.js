(() => {
  'use strict';

  const API = 'https://ejeuttgrqxqxlpotbzao.supabase.co/functions/v1/midnight-lens-marketplace-v1';
  const runtime = globalThis.browser?.runtime || globalThis.chrome?.runtime;

  if (!runtime?.onMessage) return;

  runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'lens-marketplace-api') return undefined;

    const action = String(message.action || '').trim();
    const session = String(message.session || '').trim();
    const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};

    if (!['ingest'].includes(action)) {
      return Promise.resolve({ ok: false, code: 'ACTION_NOT_ALLOWED' });
    }
    if (session.length < 24 || session.length > 256) {
      return Promise.resolve({ ok: false, code: 'SESSION_INVALID' });
    }

    return fetch(`${API}?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-lens-session': session,
        'x-client-info': 'midnight-lens-marketplace-extension/0.1.1'
      },
      body: JSON.stringify(payload)
    }).then(async (response) => {
      const data = await response.json().catch(() => ({ ok: false, code: 'INVALID_API_RESPONSE' }));
      return { ok: response.ok && data.ok !== false, status: response.status, data };
    }).catch(() => ({ ok: false, code: 'NETWORK_ERROR' }));
  });
})();
