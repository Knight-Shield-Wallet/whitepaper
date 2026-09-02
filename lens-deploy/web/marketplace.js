(() => {
  'use strict';

  const API = 'https://ejeuttgrqxqxlpotbzao.supabase.co/functions/v1/midnight-lens-marketplace-v1';
  const LOONIE_MM = 26.5;
  const $ = (id) => document.getElementById(id);
  const state = {
    session: '',
    feed: [],
    selected: null,
    selectedBundle: null,
    posted: null,
    live: null,
    guard: null,
    size: null,
    sizePoints: [],
    registryCheck: null,
  };

  function randomSession() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
  }

  function initSession() {
    const hash = new URLSearchParams(location.hash.slice(1));
    const fromHash = hash.get('s');
    const fromStorage = localStorage.getItem('lensMarketplaceSession');
    state.session = fromHash && fromHash.length >= 24 ? fromHash : fromStorage && fromStorage.length >= 24 ? fromStorage : randomSession();
    localStorage.setItem('lensMarketplaceSession', state.session);
    const record = hash.get('record');
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    return record;
  }

  function setHealth(label, good = false) {
    const el = $('apiHealth');
    el.classList.toggle('good', good);
    el.querySelector('span:last-child').textContent = label;
  }

  async function api(action, { method = 'GET', body = null, params = {} } = {}) {
    const url = new URL(API);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const options = { method, headers: { 'x-lens-session': state.session } };
    if (body !== null) {
      options.headers['content-type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({ ok: false, code: 'INVALID_API_RESPONSE' }));
    if (!response.ok || data.ok === false) {
      const error = new Error(data.code || `HTTP_${response.status}`);
      error.data = data;
      throw error;
    }
    return data;
  }

  function numberOrNull(value) {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function pill(text, kind = 'unknown') {
    const span = document.createElement('span');
    span.className = `proof-chip ${kind}`;
    span.textContent = text;
    return span;
  }

  function receiptLine(label, value, kind = 'assessed') {
    const row = document.createElement('div');
    row.className = 'mini-receipt';
    const left = document.createElement('div');
    const b = document.createElement('b'); b.textContent = label;
    const small = document.createElement('small'); small.textContent = value;
    left.append(b, small);
    row.append(left, pill(kind === 'verified' ? 'Verified' : kind === 'unknown' ? 'Unknown' : kind === 'attention' ? 'Attention' : 'Assessed', kind));
    return row;
  }

  function accountAgeText(days) {
    if (days === null || days === undefined) return 'Unknown';
    if (days < 30) return `${days} days · new`;
    if (days < 365) return `${Math.floor(days / 30)} months`;
    return `${(days / 365).toFixed(1)} years`;
  }

  async function checkCapabilities() {
    try {
      const response = await fetch(`${API}?action=capabilities`, { headers: { origin: location.origin } });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error('API_UNAVAILABLE');
      setHealth(`Lens Marketplace API v${data.version}`, true);
    } catch {
      setHealth('Lens backend unavailable');
    }
  }

  async function refreshFeed() {
    $('feed').innerHTML = '<div class="empty-state">Refreshing Lens feed…</div>';
    try {
      const minAge = Number($('accountAge').value || 0);
      const data = await api('feed', { params: { hide_commercial: $('realBuySell').checked, min_account_days: minAge, max_risk: Number($('riskCeiling').value || 100) } });
      let listings = data.listings || [];
      if ($('hideUnknownAge').checked && minAge > 0) listings = listings.filter((x) => x.seller_account_age_days !== null && x.seller_account_age_days >= minAge);
      state.feed = listings;
      renderFeed();
    } catch (error) {
      $('feed').innerHTML = `<div class="notice error">Could not load feed: ${error.message}</div>`;
    }
  }

  function renderFeed() {
    const feed = $('feed'); feed.replaceChildren();
    $('feedCounter').textContent = `${state.feed.length} shown`;
    if (!state.feed.length) {
      const empty = document.createElement('div'); empty.className = 'empty-state';
      empty.textContent = 'No listings pass the current Lens filters.';
      feed.append(empty); return;
    }
    for (const item of state.feed) {
      const card = document.createElement('button');
      card.type = 'button'; card.className = 'listing-card';
      const top = document.createElement('div'); top.className = 'listing-card-top';
      const title = document.createElement('strong'); title.textContent = item.title || 'Untitled listing';
      const price = document.createElement('span'); price.className = 'listing-price'; price.textContent = item.price_text || 'Price not captured';
      top.append(title, price);
      const meta = document.createElement('div'); meta.className = 'listing-meta';
      meta.append(
        pill(item.commercial_class === 'likely_private' ? 'Likely private' : item.commercial_class === 'likely_commercial' ? 'Likely commercial' : 'Seller uncertain', item.commercial_class === 'likely_private' ? 'verified' : item.commercial_class === 'likely_commercial' ? 'attention' : 'unknown'),
        pill(`Risk ${Math.round(Number(item.risk_score || 0))}`, Number(item.risk_score || 0) >= 60 ? 'attention' : 'assessed'),
        pill(`Account ${accountAgeText(item.seller_account_age_days)}`, item.seller_account_age_days == null ? 'unknown' : 'assessed')
      );
      const source = document.createElement('small'); source.className = 'listing-source'; source.textContent = item.source_host || 'manual';
      card.append(top, meta, source);
      card.addEventListener('click', () => selectRecord(item.id));
      feed.append(card);
    }
  }

  async function ingestFromForm(event) {
    event.preventDefault();
    const payload = {
      source_url: $('sourceUrl').value.trim() || 'manual',
      title: $('listingTitle').value.trim(),
      price_text: $('listingPrice').value.trim(),
      description: $('listingDescription').value.trim(),
      seller_name: $('sellerName').value.trim(),
      seller_account_age_days: numberOrNull($('sellerAge').value),
      seller_listing_count: numberOrNull($('sellerListingCount').value),
      seller_signals: {},
      identifiers: [],
      photo_signals: [],
    };
    if (!payload.title && payload.source_url === 'manual') {
      alert('Add a title or a supported marketplace URL.'); return;
    }
    try {
      const data = await api('ingest', { method: 'POST', body: payload });
      await refreshFeed();
      await selectRecord(data.listing.id);
      $('importForm').reset();
      $('accountAge').value = '90';
    } catch (error) {
      alert(`Lens could not import this listing: ${error.message}`);
    }
  }

  async function selectRecord(id) {
    try {
      const bundle = await api('record', { params: { id } });
      state.selected = bundle.listing;
      state.selectedBundle = bundle;
      renderRecord(bundle);
      $('recordPanel').hidden = false;
      $('recordPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      alert(`Could not load Lens record: ${error.message}`);
    }
  }

  function renderRecord(bundle) {
    const listing = bundle.listing;
    $('recordTitle').textContent = listing.title || 'Selected listing';
    const summary = $('recordSummary'); summary.replaceChildren();
    summary.append(
      receiptLine('Seller class', `${listing.commercial_class.replaceAll('_', ' ')} · score ${Math.round(Number(listing.commercial_score || 0))}`, 'assessed'),
      receiptLine('Seller account age', accountAgeText(listing.seller_account_age_days), listing.seller_account_age_days == null ? 'unknown' : 'verified'),
      receiptLine('Listing risk', `${Math.round(Number(listing.risk_score || 0))}/100`, Number(listing.risk_score || 0) >= 60 ? 'attention' : 'assessed')
    );
    const receipts = $('recordReceipts'); receipts.replaceChildren();
    for (const rec of bundle.receipts || []) {
      const card = document.createElement('article'); card.className = 'receipt-card';
      const h = document.createElement('h3'); h.textContent = String(rec.receipt_type || '').replaceAll('_', ' ');
      const meta = document.createElement('div'); meta.className = 'receipt-meta';
      meta.append(pill(rec.status, rec.status === 'verified' || rec.status === 'negative_search' ? 'verified' : rec.status === 'attention' ? 'attention' : rec.status === 'unknown' ? 'unknown' : 'assessed'));
      if (rec.confidence != null) meta.append(pill(`${Math.round(rec.confidence)}% confidence`, 'assessed'));
      const authority = document.createElement('p'); authority.textContent = `Source: ${rec.authority}`;
      const pre = document.createElement('pre'); pre.className = 'evidence-json'; pre.textContent = JSON.stringify(rec.evidence, null, 2);
      card.append(h, meta, authority, pre); receipts.append(card);
    }
    for (const check of bundle.registry_checks || []) {
      const card = document.createElement('article'); card.className = 'receipt-card';
      const h = document.createElement('h3'); h.textContent = `${check.registry} registry check`;
      const p = document.createElement('p'); p.textContent = `${check.identifier_type}: ${check.identifier_value} · ${check.result}. ${check.authority}`;
      card.append(h, p); receipts.append(card);
    }
  }

  async function fileToCanvas(file, canvas, maxSide = 1000) {
    if (!file) return null;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const buffer = await file.arrayBuffer();
    return analyzeCanvas(canvas, buffer, file);
  }

  function exifSignals(buffer) {
    const bytes = new Uint8Array(buffer);
    const ascii = new TextDecoder('latin1').decode(bytes.slice(0, Math.min(bytes.length, 262144)));
    const exif = ascii.includes('Exif\u0000\u0000');
    const c2pa = /c2pa|jumbf|content credentials/i.test(ascii);
    let gpsTag = false;
    for (let i = 0; i < Math.min(bytes.length - 1, 262144); i++) {
      if ((bytes[i] === 0x88 && bytes[i + 1] === 0x25) || (bytes[i] === 0x25 && bytes[i + 1] === 0x88)) { gpsTag = true; break; }
    }
    return { exif_present: exif, possible_gps_ifd: exif && gpsTag, content_credentials_marker: c2pa };
  }

  function metrics(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = image.data;
    const step = Math.max(4, Math.floor(Math.sqrt((canvas.width * canvas.height) / 50000)) * 4);
    let bright = 0, sat = 0, clippedHigh = 0, clippedLow = 0, sharp = 0, count = 0;
    let previous = null;
    for (let i = 0; i < d.length; i += step) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const lum = .2126 * r + .7152 * g + .0722 * b;
      bright += lum; sat += max === 0 ? 0 : (max - min) / max;
      if (lum > .97) clippedHigh++; if (lum < .03) clippedLow++;
      if (previous !== null) sharp += Math.abs(lum - previous);
      previous = lum; count++;
    }
    return {
      brightness: bright / count,
      saturation: sat / count,
      clipped_high: clippedHigh / count,
      clipped_low: clippedLow / count,
      texture_delta: sharp / Math.max(1, count - 1),
    };
  }

  function dHash(canvas) {
    const c = document.createElement('canvas'); c.width = 9; c.height = 8;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(canvas, 0, 0, 9, 8);
    const d = ctx.getImageData(0, 0, 9, 8).data;
    const gray = [];
    for (let i = 0; i < d.length; i += 4) gray.push(.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]);
    let bits = 0n, pos = 0n;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      if (gray[y * 9 + x] > gray[y * 9 + x + 1]) bits |= 1n << pos;
      pos++;
    }
    return bits.toString(16).padStart(16, '0');
  }

  function hammingHex(a, b) {
    if (!a || !b || a.length !== b.length) return 64;
    let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), count = 0;
    while (x) { count += Number(x & 1n); x >>= 1n; }
    return count;
  }

  async function detectorSignals(canvas) {
    const output = { faces: [], barcodes: [], text_blocks: [] };
    if ('FaceDetector' in window) {
      try {
        const faces = await new FaceDetector({ fastMode: true, maxDetectedFaces: 10 }).detect(canvas);
        output.faces = faces.map((f) => ({ x: Math.round(f.boundingBox.x), y: Math.round(f.boundingBox.y), width: Math.round(f.boundingBox.width), height: Math.round(f.boundingBox.height) }));
      } catch {}
    }
    if ('BarcodeDetector' in window) {
      try {
        const codes = await new BarcodeDetector().detect(canvas);
        output.barcodes = codes.slice(0, 20).map((c) => ({ value: c.rawValue, format: c.format }));
      } catch {}
    }
    if ('TextDetector' in window) {
      try {
        const blocks = await new TextDetector().detect(canvas);
        output.text_blocks = blocks.slice(0, 40).map((b) => String(b.rawValue || '').slice(0, 160)).filter(Boolean);
      } catch {}
    }
    return output;
  }

  function filterTeller(m) {
    const effects = [];
    if (m.brightness > .72) effects.push({ effect: 'bright exposure / lifted luminance', confidence: Math.round(Math.min(92, 55 + (m.brightness - .72) * 180)) });
    if (m.brightness < .28) effects.push({ effect: 'dark exposure / lowered luminance', confidence: Math.round(Math.min(88, 55 + (.28 - m.brightness) * 180)) });
    if (m.saturation > .58) effects.push({ effect: 'high saturation', confidence: Math.round(Math.min(90, 55 + (m.saturation - .58) * 150)) });
    if (m.texture_delta < .045) effects.push({ effect: 'low local texture; smoothing or naturally smooth scene possible', confidence: 58 });
    if (m.texture_delta > .18) effects.push({ effect: 'strong local contrast / sharpening possible', confidence: 55 });
    if (m.clipped_high > .08) effects.push({ effect: 'highlight clipping', confidence: 85 });
    if (m.clipped_low > .1) effects.push({ effect: 'shadow clipping', confidence: 85 });
    return { mode: 'inferred_observable_effects', exact_settings_available: false, effects, confidence: effects.length ? Math.max(...effects.map((e) => e.confidence)) : 45 };
  }

  async function analyzeCanvas(canvas, buffer, file) {
    const m = metrics(canvas);
    const detectors = await detectorSignals(canvas);
    const metadata = exifSignals(buffer);
    const privacy = {
      risk_count: detectors.faces.length + (metadata.possible_gps_ifd ? 1 : 0) + (detectors.text_blocks.length ? 1 : 0),
      faces_detected: detectors.faces.length,
      text_detected: detectors.text_blocks.length > 0,
      exif_present: metadata.exif_present,
      possible_gps_metadata: metadata.possible_gps_ifd,
      note: detectors.text_blocks.length ? 'Visible text exists. Lens cannot assume whether it contains private information; inspect before sharing.' : 'No text detector evidence available or no text detected.',
      confidence: metadata.possible_gps_ifd || detectors.faces.length ? 80 : 60,
    };
    return {
      file: { name: file.name, type: file.type, size: file.size, last_modified: file.lastModified },
      width: canvas.width, height: canvas.height,
      hash: dHash(canvas), metrics: m, metadata, detectors, privacy,
      filter_teller: { ...filterTeller(m), provenance_marker_possible: metadata.content_credentials_marker },
    };
  }

  function compareScans(a, b) {
    if (!a || !b) return null;
    const hamming = hammingHex(a.hash, b.hash);
    const brightnessDelta = Math.abs(a.metrics.brightness - b.metrics.brightness);
    const saturationDelta = Math.abs(a.metrics.saturation - b.metrics.saturation);
    const aspectA = a.width / a.height, aspectB = b.width / b.height;
    const aspectDelta = Math.min(1, Math.abs(aspectA - aspectB) / Math.max(aspectA, aspectB));
    const score = Math.max(0, Math.round(100 - hamming * 1.35 - brightnessDelta * 55 - saturationDelta * 45 - aspectDelta * 30));
    const match = score >= 76 ? 'strong' : score >= 52 ? 'partial' : score >= 32 ? 'weak' : 'mismatch';
    return { method: 'device_visual_fingerprint', score, live_match: match, hamming_distance: hamming, brightness_delta: Number(brightnessDelta.toFixed(3)), saturation_delta: Number(saturationDelta.toFixed(3)), confidence: Math.min(88, Math.max(45, score)), limitation: 'Visual similarity cannot prove identity or internal condition.' };
  }

  function showCompare() {
    const box = $('compareResult');
    const comparison = compareScans(state.posted, state.live);
    if (!comparison) { box.textContent = 'Add a posted photo and a live photo to compare the visible item. A visual match is evidence, not identity proof.'; return; }
    box.textContent = `Visual comparison: ${comparison.live_match.toUpperCase()} · score ${comparison.score}/100 · fingerprint distance ${comparison.hamming_distance}. This is similarity evidence, not identity proof.`;
  }

  async function handlePhotoInput(input, canvas, key) {
    const file = input.files?.[0]; if (!file) return;
    try { state[key] = await fileToCanvas(file, canvas); showCompare(); if (key === 'guard') renderGuard(); }
    catch (error) { alert(`Photo analysis failed: ${error.message}`); }
  }

  async function scanIdentifiers() {
    const scans = [state.posted, state.live].filter(Boolean);
    const found = [];
    for (const scan of scans) {
      for (const code of scan.detectors.barcodes || []) found.push({ type: 'barcode', value: code.value, source: 'device_barcode_detector', confidence: 92 });
      for (const block of scan.detectors.text_blocks || []) {
        for (const token of block.match(/[A-Z0-9][A-Z0-9._-]{5,29}/gi) || []) found.push({ type: 'serial_candidate', value: token, source: 'device_text_detector', confidence: 62 });
      }
    }
    const manual = $('identifierValue').value.trim().replace(/[^a-zA-Z0-9._-]/g, '');
    if (manual) found.unshift({ type: $('identifierType').value, value: manual, source: 'user_confirmed', confidence: 100 });
    const unique = [...new Map(found.map((x) => [`${x.type}:${x.value}`, x])).values()].slice(0, 20);
    $('identifierResults').replaceChildren();
    if (!unique.length) $('identifierResults').append(receiptLine('Identifier scan', 'No supported device detector found a code. Enter the serial manually if visible.', 'unknown'));
    else unique.forEach((x) => $('identifierResults').append(receiptLine(x.type, `${x.value} · ${x.source}`, x.source === 'user_confirmed' ? 'verified' : 'assessed')));
    return unique;
  }

  async function baseSelectedPayload() {
    if (!state.selected?.id) throw new Error('SELECT_A_LISTING_FIRST');
    if (!state.selectedBundle || state.selectedBundle.listing.id !== state.selected.id) state.selectedBundle = await api('record', { params: { id: state.selected.id } });
    const l = state.selectedBundle.listing;
    return {
      idempotency_key: l.idempotency_key,
      source_url: l.source_url || 'manual', source_listing_id: l.source_listing_id,
      title: l.title, price_text: l.price_text, currency: l.currency, description: l.description,
      seller_name: l.seller_name, seller_account_age_days: l.seller_account_age_days, seller_listing_count: l.seller_listing_count,
      seller_signals: l.seller_signals || {}, photo_signals: l.photo_signals || [], identifiers: l.identifiers || [],
    };
  }

  async function saveItemScan() {
    try {
      const payload = await baseSelectedPayload();
      const identifiers = await scanIdentifiers();
      const comparison = compareScans(state.posted, state.live);
      payload.identifiers = identifiers.length ? identifiers : payload.identifiers;
      payload.photo_signals = [state.posted && { role: 'posted', hash: state.posted.hash, privacy_risk_count: state.posted.privacy.risk_count }, state.live && { role: 'live', hash: state.live.hash, privacy_risk_count: state.live.privacy.risk_count, live_match: comparison?.live_match }].filter(Boolean);
      if (comparison) payload.live_item_compare = comparison;
      payload.condition_scan = state.live ? visibleCondition(state.live.metrics) : {};
      const data = await api('reanalyze', { method: 'POST', body: payload });
      await selectRecord(data.listing.id); await refreshFeed();
    } catch (error) { alert(`Could not save item scan: ${error.message}`); }
  }

  function visibleCondition(m) {
    const flags = [];
    if (m.clipped_high > .12 || m.clipped_low > .15) flags.push('Lighting limits visible-condition confidence');
    if (m.texture_delta > .2) flags.push('High edge/texture activity; inspect for scratches, cracks or clutter manually');
    return { scope: 'visible_surface_only', flags, confidence: flags.length ? 52 : 60, limitation: 'No claim about internal mechanical, electrical, battery or water condition.' };
  }

  function renderGuard() {
    const box = $('guardResults'); box.replaceChildren();
    const s = state.guard; if (!s) return;
    box.append(receiptLine('Privacy scan', `${s.privacy.risk_count} risk signal(s) · faces ${s.privacy.faces_detected} · EXIF ${s.privacy.exif_present ? 'present' : 'not detected'} · possible GPS ${s.privacy.possible_gps_metadata ? 'yes' : 'no'}`, s.privacy.risk_count ? 'attention' : 'assessed'));
    box.append(receiptLine('Filter Teller', s.filter_teller.effects.length ? s.filter_teller.effects.map((x) => `${x.effect} (${x.confidence}%)`).join('; ') : 'No strong observable edit effects detected. Exact hidden settings are not knowable from a flattened image.', 'assessed'));
    box.append(receiptLine('Provenance marker', s.metadata.content_credentials_marker ? 'Possible C2PA / Content Credentials marker found; use a credential inspector for cryptographic verification.' : 'No C2PA marker detected in the inspected file bytes.', s.metadata.content_credentials_marker ? 'assessed' : 'unknown'));
    if (s.detectors.text_blocks.length) box.append(receiptLine('Visible text', `${s.detectors.text_blocks.length} text block(s) detected. Inspect for addresses, plates, documents and screen content.`, 'attention'));
  }

  function drawReconstruction() {
    if (!state.guard) throw new Error('CHOOSE_A_PHOTO_FIRST');
    const source = $('guardCanvas'), dest = $('reconstructedCanvas');
    dest.width = source.width; dest.height = source.height;
    const sctx = source.getContext('2d', { willReadFrequently: true });
    const dctx = dest.getContext('2d', { willReadFrequently: true });
    const img = sctx.getImageData(0, 0, source.width, source.height);
    const pixels = img.data;
    const m = state.guard.metrics;
    const satFactor = m.saturation > .58 ? .72 : 1;
    const brightnessShift = m.brightness > .72 ? -22 : m.brightness < .28 ? 22 : 0;
    for (let i = 0; i < pixels.length; i += 4) {
      let r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      const gray = .299 * r + .587 * g + .114 * b;
      r = gray + (r - gray) * satFactor + brightnessShift;
      g = gray + (g - gray) * satFactor + brightnessShift;
      b = gray + (b - gray) * satFactor + brightnessShift;
      pixels[i] = Math.max(0, Math.min(255, r)); pixels[i + 1] = Math.max(0, Math.min(255, g)); pixels[i + 2] = Math.max(0, Math.min(255, b));
    }
    dctx.putImageData(img, 0, 0);
    return { mode: 'Lens Reconstructed — filters computationally reduced', original_recovered: false, operations: { saturation_factor: satFactor, brightness_shift: brightnessShift }, confidence: 55, limitation: 'A flattened image does not contain the pixels removed or altered by prior filters.' };
  }

  function downloadCanvas(canvas, filename, quality = .92) {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    }, 'image/jpeg', quality);
  }

  function privacyClean() {
    if (!state.guard) { alert('Choose a Photo Guard image first.'); return; }
    const source = $('guardCanvas');
    const copy = document.createElement('canvas'); copy.width = source.width; copy.height = source.height;
    copy.getContext('2d').drawImage(source, 0, 0);
    const ctx = source.getContext('2d');
    ctx.save();
    for (const box of state.guard.detectors.faces || []) {
      ctx.filter = 'blur(18px)';
      ctx.drawImage(copy, box.x, box.y, box.width, box.height, box.x, box.y, box.width, box.height);
      ctx.filter = 'none';
    }
    ctx.restore();
    downloadCanvas(source, 'midnight-lens-privacy-clean.jpg');
    $('guardResults').prepend(receiptLine('Privacy-clean export', `Re-encoded JPEG strips original embedded metadata${state.guard.detectors.faces.length ? ' and blurs detected faces' : ''}. Visible addresses, plates, reflections and documents still require human review.`, 'assessed'));
  }

  async function savePhotoGuard() {
    try {
      if (!state.guard) throw new Error('CHOOSE_A_PHOTO_FIRST');
      const payload = await baseSelectedPayload();
      payload.privacy_scan = state.guard.privacy;
      payload.filter_teller = state.guard.filter_teller;
      const reconstruction = drawReconstruction();
      payload.filter_reconstruction = reconstruction;
      const data = await api('reanalyze', { method: 'POST', body: payload });
      await selectRecord(data.listing.id);
    } catch (error) { alert(`Could not save Photo Guard evidence: ${error.message}`); }
  }

  function sizeCanvasPoint(event) {
    if (!state.size || state.sizePoints.length >= 4) return;
    const c = $('sizeCanvas'); const r = c.getBoundingClientRect();
    state.sizePoints.push({ x: (event.clientX - r.left) * c.width / r.width, y: (event.clientY - r.top) * c.height / r.height });
    redrawSize();
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function redrawSize() {
    const c = $('sizeCanvas'); if (!state.size) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(state.size.imageCanvas, 0, 0, c.width, c.height);
    ctx.lineWidth = Math.max(2, c.width / 250); ctx.strokeStyle = '#8197ff'; ctx.fillStyle = '#fff';
    state.sizePoints.forEach((p, i) => { ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.fillText(String(i + 1), p.x + 10, p.y - 10); });
    if (state.sizePoints.length >= 2) { ctx.beginPath(); ctx.moveTo(state.sizePoints[0].x, state.sizePoints[0].y); ctx.lineTo(state.sizePoints[1].x, state.sizePoints[1].y); ctx.stroke(); }
    if (state.sizePoints.length >= 4) {
      ctx.beginPath(); ctx.moveTo(state.sizePoints[2].x, state.sizePoints[2].y); ctx.lineTo(state.sizePoints[3].x, state.sizePoints[3].y); ctx.stroke();
      const refPx = dist(state.sizePoints[0], state.sizePoints[1]); const itemPx = dist(state.sizePoints[2], state.sizePoints[3]);
      const mm = itemPx / refPx * LOONIE_MM;
      $('sizeInstruction').textContent = `Measured dimension: ${mm.toFixed(1)} mm (${(mm / 10).toFixed(2)} cm). Reference: current Canadian $1 coin = ${LOONIE_MM} mm diameter. Perspective can distort the result; keep coin and item on the same plane.`;
    } else $('sizeInstruction').textContent = state.sizePoints.length < 2 ? 'Tap the two opposite edges of the loonie.' : 'Now tap the two endpoints of the item dimension you want to measure.';
  }

  async function loadSizePhoto() {
    const file = $('sizePhoto').files?.[0]; if (!file) return;
    const temp = document.createElement('canvas'); const analysis = await fileToCanvas(file, temp, 1200);
    const c = $('sizeCanvas'); c.width = temp.width; c.height = temp.height; c.getContext('2d').drawImage(temp, 0, 0);
    state.size = { analysis, imageCanvas: temp }; state.sizePoints = []; redrawSize();
  }

  async function saveSize() {
    if (!state.size || state.sizePoints.length !== 4) { alert('Add four measurement points first.'); return; }
    try {
      const payload = await baseSelectedPayload();
      const refPx = dist(state.sizePoints[0], state.sizePoints[1]); const itemPx = dist(state.sizePoints[2], state.sizePoints[3]);
      payload.size_scan = { method: 'loonie_reference_photo', reference: 'Canadian $1 coin', reference_diameter_mm: LOONIE_MM, measured_mm: Number((itemPx / refPx * LOONIE_MM).toFixed(1)), confidence: 70, limitation: 'Perspective and lens distortion can affect a single-photo measurement; coin and item should be on the same plane.' };
      const data = await api('reanalyze', { method: 'POST', body: payload }); await selectRecord(data.listing.id);
    } catch (error) { alert(`Could not save size evidence: ${error.message}`); }
  }

  async function prepareRegistry(registry) {
    try {
      if (!state.selected?.id) throw new Error('SELECT_A_LISTING_FIRST');
      const value = $('identifierValue').value.trim().replace(/[^a-zA-Z0-9._-]/g, '');
      if (!value) throw new Error('ENTER_SERIAL_OR_IDENTIFIER');
      const data = await api('registry_prepare', { method: 'POST', body: { listing_id: state.selected.id, registry, identifier_type: $('identifierType').value, identifier_value: value } });
      state.registryCheck = data;
      renderRegistry(data);
    } catch (error) { alert(`Registry check could not be prepared: ${error.message}`); }
  }

  function renderRegistry(data) {
    const box = $('registryBox'); box.replaceChildren();
    box.append(receiptLine(data.registry, `${data.identifier_type}: ${data.identifier_value} · check not run yet`, 'unknown'));
    const a = document.createElement('a'); a.className = 'btn primary'; a.href = data.external_url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = `Open official ${data.registry} search`;
    const no = document.createElement('button'); no.className = 'btn'; no.type = 'button'; no.textContent = 'Search showed no result'; no.addEventListener('click', () => recordRegistry('negative_search'));
    const yes = document.createElement('button'); yes.className = 'btn danger'; yes.type = 'button'; yes.textContent = 'Possible stolen result'; yes.addEventListener('click', () => recordRegistry('possible_positive'));
    const row = document.createElement('div'); row.className = 'action-row'; row.append(a, no, yes); box.append(row);
    const note = document.createElement('p'); note.className = 'microcopy'; note.textContent = data.next_action; box.append(note);
  }

  async function recordRegistry(result) {
    try {
      if (!state.registryCheck || !state.selected) throw new Error('PREPARE_A_REGISTRY_CHECK_FIRST');
      const data = await api('registry_result', { method: 'POST', body: { listing_id: state.selected.id, check_id: state.registryCheck.check_id, result } });
      $('registryBox').prepend(receiptLine('Registry result', data.warning, result === 'possible_positive' ? 'attention' : 'verified'));
      await selectRecord(state.selected.id);
    } catch (error) { alert(`Could not record registry result: ${error.message}`); }
  }

  async function deleteSession() {
    if (!confirm('Delete all Lens Marketplace records tied to this local session? This cannot be undone.')) return;
    try {
      await api('session', { method: 'DELETE' });
      localStorage.removeItem('lensMarketplaceSession'); state.session = randomSession(); localStorage.setItem('lensMarketplaceSession', state.session);
      state.feed = []; state.selected = null; state.selectedBundle = null; $('recordPanel').hidden = true; renderFeed();
    } catch (error) { alert(`Session deletion failed: ${error.message}`); }
  }

  function wire() {
    $('importForm').addEventListener('submit', ingestFromForm);
    ['realBuySell', 'accountAge', 'riskCeiling', 'hideUnknownAge'].forEach((id) => $(id).addEventListener('change', refreshFeed));
    $('refreshFeed').addEventListener('click', refreshFeed);
    $('postedPhoto').addEventListener('change', () => handlePhotoInput($('postedPhoto'), $('postedCanvas'), 'posted'));
    $('livePhoto').addEventListener('change', () => handlePhotoInput($('livePhoto'), $('liveCanvas'), 'live'));
    $('guardPhoto').addEventListener('change', () => handlePhotoInput($('guardPhoto'), $('guardCanvas'), 'guard'));
    $('scanIdentifiers').addEventListener('click', scanIdentifiers);
    $('saveItemScan').addEventListener('click', saveItemScan);
    $('privacyClean').addEventListener('click', privacyClean);
    $('reduceFilters').addEventListener('click', () => { try { const info = drawReconstruction(); $('guardResults').prepend(receiptLine('Filter Remover', `${info.mode}. This is not the recovered original.`, 'assessed')); } catch (e) { alert(e.message); } });
    $('savePhotoGuard').addEventListener('click', savePhotoGuard);
    $('sizePhoto').addEventListener('change', loadSizePhoto);
    $('sizeCanvas').addEventListener('click', sizeCanvasPoint);
    $('resetSize').addEventListener('click', () => { state.sizePoints = []; redrawSize(); });
    $('saveSize').addEventListener('click', saveSize);
    $('prepareCpic').addEventListener('click', () => prepareRegistry('CPIC'));
    $('prepareBikeIndex').addEventListener('click', () => prepareRegistry('BIKE_INDEX'));
    $('closeRecord').addEventListener('click', () => { $('recordPanel').hidden = true; });
    $('deleteSession').addEventListener('click', deleteSession);
  }

  async function boot() {
    const recordFromExtension = initSession();
    wire();
    await Promise.allSettled([checkCapabilities(), refreshFeed()]);
    if (recordFromExtension) await selectRecord(recordFromExtension);
  }

  boot();
})();
