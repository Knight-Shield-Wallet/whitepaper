(() => {
  const KEY = 'ksd_midnight_lens_guided_proof_v1';
  const startView = document.getElementById('startView');
  const reviewView = document.getElementById('reviewView');
  const receiptView = document.getElementById('receiptView');
  const beginProof = document.getElementById('beginProof');
  const visualPass = document.getElementById('visualPass');
  const visualFail = document.getElementById('visualFail');
  const autoResults = document.getElementById('autoResults');
  const receiptSummary = document.getElementById('receiptSummary');
  const receiptJson = document.getElementById('receiptJson');
  const finalVerdict = document.getElementById('finalVerdict');
  const copyReceipt = document.getElementById('copyReceipt');
  const newProof = document.getElementById('newProof');

  const now = () => new Date().toISOString();
  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
  };
  const save = (state) => localStorage.setItem(KEY, JSON.stringify(state));
  const clear = () => localStorage.removeItem(KEY);

  function show(el) {
    [startView, reviewView, receiptView].forEach(v => v.classList.add('hidden'));
    el.classList.remove('hidden');
  }

  function resultRow(label, value) {
    const status = value === true ? 'PASS' : value === false ? 'FAIL' : 'PENDING';
    const cls = value === true ? 'pass' : value === false ? 'fail' : 'pending';
    return '<div class="result"><span>' + label + '</span><strong class="' + cls + '">' + status + '</strong></div>';
  }

  function automaticChecks(s) {
    const e = s.events || {};
    return {
      guest_requires_no_signin: e.identity_mode === 'guest' && e.signin_requested !== true,
      camera_not_requested_before_start: !!e.session_start_clicked_at && (!e.camera_requested_at || e.camera_requested_at >= e.session_start_clicked_at),
      camera_requested_after_start: !!e.camera_requested_at && !!e.session_start_clicked_at && e.camera_requested_at >= e.session_start_clicked_at,
      camera_stream_started: !!e.camera_ready_at,
      first_capture_completed: (e.capture_count || 0) >= 1,
      remove_completed: (e.remove_count || 0) >= 1,
      recapture_after_remove: !!e.recapture_after_remove,
      session_end_completed: !!e.session_ended_at,
      camera_stopped_on_end: e.camera_stopped_on_end === true,
      captures_cleared_on_end: e.captures_cleared_on_end === true,
      fresh_session_state_confirmed: e.fresh_session_state_confirmed === true,
      gallery_file_picker_used: e.gallery_file_picker_used === true ? false : true
    };
  }

  function renderReview(s) {
    const checks = automaticChecks(s);
    autoResults.innerHTML = Object.entries(checks).map(([k,v]) => resultRow(k.replaceAll('_',' '), v)).join('');
    show(reviewView);
  }

  function finalize(visualOk) {
    const s = load();
    if (!s) return;
    s.human = {
      visual_usable: visualOk,
      confirmed_at: now()
    };
    s.completed_at = now();
    const checks = automaticChecks(s);
    const allAutoPass = Object.values(checks).every(Boolean);
    s.checks = checks;
    s.final_result = allAutoPass && visualOk ? 'PASS' : 'FAIL';
    s.proof_scope = 'guided_quick_session_real_user_journey';
    s.truth_boundary = {
      secure_cache_deletion_proven: false,
      identity_verified: false,
      photo_guard_provenance_proven: false,
      c2pa_proven: false,
      midnight_zk_issuance_proven: false,
      os_level_containment_proven: false
    };
    save(s);
    renderReceipt(s);
  }

  function renderReceipt(s) {
    finalVerdict.textContent = s.final_result === 'PASS' ? 'Journey PASS' : 'Journey needs attention';
    receiptSummary.innerHTML =
      resultRow('Automatic journey checks', Object.values(s.checks || {}).every(Boolean)) +
      resultRow('Human visual / usability check', s.human?.visual_usable === true);
    receiptJson.textContent = JSON.stringify(s, null, 2);
    show(receiptView);
  }

  beginProof.addEventListener('click', () => {
    const state = {
      schema: 'ksd.midnight-lens.guided-proof-session.v1',
      mission: 'Quick Session — Take Photos',
      started_at: now(),
      user_agent: navigator.userAgent,
      platform: navigator.platform || null,
      events: {
        proof_started_at: now(),
        signin_requested: false,
        gallery_file_picker_used: false,
        capture_count: 0,
        remove_count: 0
      }
    };
    save(state);
    location.href = '/session?proof=1';
  });

  visualPass.addEventListener('click', () => finalize(true));
  visualFail.addEventListener('click', () => finalize(false));
  newProof.addEventListener('click', () => { clear(); location.href = '/proof-session'; });
  copyReceipt.addEventListener('click', async () => {
    const s = load();
    if (!s) return;
    await navigator.clipboard.writeText(JSON.stringify(s, null, 2));
    copyReceipt.textContent = 'Receipt Copied';
  });

  const s = load();
  const params = new URLSearchParams(location.search);
  if (params.get('review') === '1' && s) renderReview(s);
  else if (s?.final_result) renderReceipt(s);
})();