(() => {
  'use strict';

  if (window.top !== window) return;

  const API = 'https://ejeuttgrqxqxlpotbzao.supabase.co/functions/v1/midnight-lens-marketplace-v1';
  const apiStorage = globalThis.browser?.storage?.local || globalThis.chrome?.storage?.local;
  const defaults = { realBuySell: true, minAgeDays: 90, strictUnknownAge: false, hideHighRisk: true, showHidden: false, syncVisible: true };
  const state = { settings: { ...defaults }, session: '', hiddenCommercial: 0, hiddenAge: 0, visible: 0, scanned: 0, synced: new Set(), scheduled: false };

  function randomSession() {
    const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
  }
  function storageGet(keys) { return new Promise((resolve) => apiStorage.get(keys, resolve)); }
  function storageSet(value) { return new Promise((resolve) => apiStorage.set(value, resolve)); }

  function commercialScore(text) {
    const t = text.toLowerCase();
    const rules = [
      [/\b(dealer|dealership|auto sales|car lot)\b/i, 35],
      [/\b(financ(?:e|ing)|credit application|approved credit|\$?0 down|payments? from)\b/i, 28],
      [/\b(warranty|certified pre[- ]owned|trade[- ]?ins?)\b/i, 18],
      [/\b(multiple available|more in stock|inventory|bulk|wholesale|liquidation)\b/i, 25],
      [/\b(store|shop|business hours|open (?:daily|7 days)|plus gst|taxes extra)\b/i, 18],
      [/\b(visit our|our website|our showroom|apply online)\b/i, 20]
    ];
    let score = 0; for (const [re, weight] of rules) if (re.test(t)) score += weight;
    if (/\b(my (?:old|used)|moving sale|downsizing|pickup only|used it|owned it)\b/i.test(t)) score -= 10;
    return Math.max(0, Math.min(100, score));
  }

  function accountAgeDays(text) {
    const match = text.match(/joined facebook in\s+([a-z]+\s+)?(20\d{2}|19\d{2})/i);
    if (!match) return null;
    const year = Number(match[2]);
    const month = match[1] ? ['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(match[1].trim().toLowerCase()) : 0;
    const joined = new Date(Date.UTC(year, Math.max(0, month), 1));
    return Math.max(0, Math.floor((Date.now() - joined.getTime()) / 86400000));
  }

  function itemIdFromHref(href) { return href?.match(/\/marketplace\/item\/(\d+)/)?.[1] || null; }

  function findCard(anchor) {
    let node = anchor;
    for (let i = 0; i < 7 && node?.parentElement; i++, node = node.parentElement) {
      const txt = (node.innerText || '').trim();
      const links = node.querySelectorAll?.('a[href*="/marketplace/item/"]')?.length || 0;
      if (txt.length >= 20 && txt.length <= 1800 && links <= 3) return node;
    }
    return anchor.parentElement;
  }

  function extract(anchor) {
    const href = anchor.href;
    const itemId = itemIdFromHref(href); if (!itemId) return null;
    const card = findCard(anchor); if (!card) return null;
    const raw = (card.innerText || '').trim().slice(0, 3000);
    const lines = raw.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    const priceLine = lines.find((x) => /(?:CA\$|C\$|\$)\s?[\d,.]+/.test(x)) || '';
    const title = lines.find((x) => x !== priceLine && x.length > 2 && x.length < 180 && !/^sponsored$/i.test(x) && !/^(edmonton|calgary|alberta|canada)$/i.test(x)) || `Marketplace item ${itemId}`;
    const age = accountAgeDays(raw);
    const cScore = commercialScore(raw);
    return { itemId, card, raw, href, title, priceLine, age, commercialScore: cScore };
  }

  function shouldHide(item) {
    if (state.settings.showHidden) return null;
    if (state.settings.realBuySell && item.commercialScore >= 60) return 'commercial';
    if (state.settings.minAgeDays > 0) {
      if (item.age !== null && item.age < state.settings.minAgeDays) return 'age';
      if (item.age === null && state.settings.strictUnknownAge) return 'age';
    }
    return null;
  }

  async function syncItem(item) {
    if (!state.settings.syncVisible || state.synced.has(item.itemId)) return;
    state.synced.add(item.itemId);
    try {
      const response = await fetch(`${API}?action=ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-lens-session': state.session },
        body: JSON.stringify({
          idempotency_key: `facebook:${item.itemId}`,
          source_url: item.href,
          source_listing_id: item.itemId,
          title: item.title,
          price_text: item.priceLine,
          description: item.raw,
          seller_account_age_days: item.age,
          seller_signals: { source: 'visible_dom', extension: 'midnight-lens-marketplace-v1' },
          photo_signals: [], identifiers: []
        })
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
    } catch {
      state.synced.delete(item.itemId);
    }
  }

  function scan() {
    state.hiddenCommercial = 0; state.hiddenAge = 0; state.visible = 0; state.scanned = 0;
    const seen = new Set();
    const anchors = document.querySelectorAll('a[href*="/marketplace/item/"]');
    for (const anchor of anchors) {
      const id = itemIdFromHref(anchor.href); if (!id || seen.has(id)) continue; seen.add(id);
      const item = extract(anchor); if (!item) continue; state.scanned++;
      const reason = shouldHide(item);
      item.card.dataset.lensMarketplaceItem = id;
      item.card.dataset.lensCommercialScore = String(item.commercialScore);
      item.card.dataset.lensAccountAge = item.age === null ? 'unknown' : String(item.age);
      item.card.classList.toggle('lens-marketplace-hidden', Boolean(reason));
      item.card.dataset.lensHiddenReason = reason || '';
      if (reason === 'commercial') state.hiddenCommercial++;
      else if (reason === 'age') state.hiddenAge++;
      else { state.visible++; syncItem(item); }
    }
    updatePanel();
  }

  function scheduleScan() {
    if (state.scheduled) return; state.scheduled = true;
    setTimeout(() => { state.scheduled = false; scan(); }, 250);
  }

  function style() {
    const css = document.createElement('style');
    css.textContent = `
      .lens-marketplace-hidden{display:none!important}
      #lens-marketplace-control{position:fixed;z-index:2147483646;right:12px;bottom:12px;width:min(330px,calc(100vw - 24px));background:rgba(7,11,19,.97);color:#f4f6fb;border:1px solid rgba(255,255,255,.16);border-radius:16px;box-shadow:0 16px 50px rgba(0,0,0,.42);font:13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;backdrop-filter:blur(16px);overflow:hidden}
      #lens-marketplace-control *{box-sizing:border-box}
      #lens-marketplace-control header{padding:13px 14px;border-bottom:1px solid rgba(255,255,255,.1);display:flex;align-items:center;justify-content:space-between;gap:10px}
      #lens-marketplace-control header b{letter-spacing:.08em;text-transform:uppercase;font-size:11px}
      #lens-marketplace-control .lm-body{padding:12px;display:grid;gap:9px}
      #lens-marketplace-control label{display:flex;align-items:center;justify-content:space-between;gap:10px;color:#c8d0df}
      #lens-marketplace-control label span{display:grid}.lm-note{font-size:10px;color:#8d98ad}
      #lens-marketplace-control input[type=checkbox]{accent-color:#3157ff;width:17px;height:17px}
      #lens-marketplace-control select{background:#0d1422;color:#f4f6fb;border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:7px}
      #lens-marketplace-control .lm-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.lm-stat{padding:8px;border:1px solid rgba(255,255,255,.1);border-radius:9px;text-align:center}.lm-stat b{display:block;font-size:16px}.lm-stat small{font-size:9px;color:#8d98ad;text-transform:uppercase}
      #lens-marketplace-control .lm-actions{display:flex;gap:6px}.lm-btn{flex:1;border:1px solid rgba(255,255,255,.15);background:transparent;color:#c8d0df;border-radius:9px;padding:9px;cursor:pointer;font-weight:600}.lm-btn.primary{background:#3157ff;color:white;border-color:#3157ff}
      #lens-marketplace-control .lm-collapse{border:0;background:transparent;color:#8d98ad;font-size:18px;cursor:pointer}.lm-collapsed .lm-body{display:none!important}
    `;
    document.documentElement.append(css);
  }

  function panel() {
    const root = document.createElement('section'); root.id = 'lens-marketplace-control';
    root.innerHTML = `
      <header><b>◈ Lens · Real Buy & Sell</b><button type="button" class="lm-collapse" aria-label="Collapse Lens">−</button></header>
      <div class="lm-body">
        <div class="lm-stats"><div class="lm-stat"><b data-stat="visible">0</b><small>shown</small></div><div class="lm-stat"><b data-stat="commercial">0</b><small>commercial hidden</small></div><div class="lm-stat"><b data-stat="age">0</b><small>age hidden</small></div></div>
        <label><span><b>Real Buy & Sell</b><small class="lm-note">Hide likely commercial inventory</small></span><input data-setting="realBuySell" type="checkbox"></label>
        <label><span><b>Account age</b><small class="lm-note">When Facebook exposes it</small></span><select data-setting="minAgeDays"><option value="0">Any</option><option value="30">30+ days</option><option value="90">90+ days</option><option value="180">6+ months</option><option value="365">1+ year</option></select></label>
        <label><span><b>Strict account age</b><small class="lm-note">Hide Unknown too</small></span><input data-setting="strictUnknownAge" type="checkbox"></label>
        <label><span><b>Show hidden</b><small class="lm-note">Temporary reveal</small></span><input data-setting="showHidden" type="checkbox"></label>
        <label><span><b>Sync visible to Lens</b><small class="lm-note">Only metadata already rendered on this page</small></span><input data-setting="syncVisible" type="checkbox"></label>
        <div class="lm-actions"><button type="button" class="lm-btn" data-action="rescan">Rescan</button><button type="button" class="lm-btn primary" data-action="open">Open Lens</button></div>
        <div class="lm-note">Lens does not request hidden profile fields or crawl seller pages. Unknown data stays Unknown.</div>
      </div>`;
    document.documentElement.append(root);
    root.querySelector('.lm-collapse').addEventListener('click', () => { root.classList.toggle('lm-collapsed'); root.querySelector('.lm-collapse').textContent = root.classList.contains('lm-collapsed') ? '+' : '−'; });
    root.querySelector('[data-action=rescan]').addEventListener('click', scan);
    root.querySelector('[data-action=open]').addEventListener('click', () => window.open(`https://midnight-lens.com/marketplace#s=${encodeURIComponent(state.session)}`, '_blank', 'noopener'));
    root.querySelectorAll('[data-setting]').forEach((input) => input.addEventListener('change', async () => {
      const key = input.dataset.setting;
      state.settings[key] = input.type === 'checkbox' ? input.checked : Number(input.value);
      await storageSet({ lensMarketplaceSettings: state.settings }); scan();
    }));
    updatePanel();
  }

  function updatePanel() {
    const root = document.getElementById('lens-marketplace-control'); if (!root) return;
    root.querySelector('[data-stat=visible]').textContent = String(state.visible);
    root.querySelector('[data-stat=commercial]').textContent = String(state.hiddenCommercial);
    root.querySelector('[data-stat=age]').textContent = String(state.hiddenAge);
    for (const [key, value] of Object.entries(state.settings)) {
      const el = root.querySelector(`[data-setting="${key}"]`); if (!el) continue;
      if (el.type === 'checkbox') el.checked = Boolean(value); else el.value = String(value);
    }
  }

  async function boot() {
    style();
    const stored = await storageGet(['lensMarketplaceSession', 'lensMarketplaceSettings']);
    state.session = stored.lensMarketplaceSession || randomSession();
    state.settings = { ...defaults, ...(stored.lensMarketplaceSettings || {}) };
    await storageSet({ lensMarketplaceSession: state.session, lensMarketplaceSettings: state.settings });
    panel(); scan();
    const observer = new MutationObserver(scheduleScan); observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', scheduleScan); window.addEventListener('scroll', scheduleScan, { passive: true });
  }

  boot();
})();
