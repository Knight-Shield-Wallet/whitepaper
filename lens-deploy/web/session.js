(() => {
  const setup = document.getElementById('setup');
  const capture = document.getElementById('capture');
  const ended = document.getElementById('ended');
  const guestChoice = document.getElementById('guestChoice');
  const nameChoice = document.getElementById('nameChoice');
  const nameWrap = document.getElementById('nameWrap');
  const guestName = document.getElementById('guestName');
  const startButton = document.getElementById('startButton');
  const camera = document.getElementById('camera');
  const canvas = document.getElementById('frame');
  const cameraStatus = document.getElementById('cameraStatus');
  const captureButton = document.getElementById('captureButton');
  const shotGrid = document.getElementById('shotGrid');
  const shotCount = document.getElementById('shotCount');
  const emptyState = document.getElementById('emptyState');
  const sessionWho = document.getElementById('sessionWho');
  const endButtons = [document.getElementById('endButtonTop'), document.getElementById('endButtonBottom')];
  const newSessionButton = document.getElementById('newSessionButton');

  let identityMode = 'guest';
  let stream = null;
  let shots = [];

  function show(screen) {
    [setup, capture, ended].forEach((el) => el.classList.remove('active'));
    screen.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function chooseIdentity(mode) {
    identityMode = mode;
    const guest = mode === 'guest';
    guestChoice.classList.toggle('selected', guest);
    guestChoice.setAttribute('aria-pressed', String(guest));
    nameChoice.classList.toggle('selected', !guest);
    nameChoice.setAttribute('aria-pressed', String(!guest));
    nameWrap.classList.toggle('hidden', guest);
    if (!guest) guestName.focus();
  }

  guestChoice.addEventListener('click', () => chooseIdentity('guest'));
  nameChoice.addEventListener('click', () => chooseIdentity('name'));

  function normalizedName() {
    const raw = guestName.value.trim();
    if (!raw) return '';
    return raw.startsWith('@') ? raw : '@' + raw;
  }

  async function startCamera() {
    cameraStatus.textContent = 'Starting camera…';
    cameraStatus.classList.remove('ready');
    captureButton.disabled = true;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cameraStatus.textContent = 'Camera access is not available in this browser.';
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      camera.srcObject = stream;
      await camera.play();
      cameraStatus.classList.add('ready');
      captureButton.disabled = false;
    } catch (error) {
      cameraStatus.textContent = 'Camera permission was not granted. End the session or allow camera access and try again.';
    }
  }

  startButton.addEventListener('click', async () => {
    const label = identityMode === 'guest' ? 'Guest' : normalizedName();
    if (identityMode === 'name' && !label) {
      guestName.setCustomValidity('Enter a KSD @name or choose Guest.');
      guestName.reportValidity();
      return;
    }
    guestName.setCustomValidity('');
    sessionWho.textContent = label + ' · camera-only session';
    show(capture);
    await startCamera();
  });

  function renderShots() {
    shotCount.textContent = String(shots.length);
    shotGrid.innerHTML = '';
    if (shots.length === 0) {
      shotGrid.appendChild(emptyState);
      emptyState.classList.remove('hidden');
      return;
    }

    shots.forEach((shot, index) => {
      const item = document.createElement('div');
      item.className = 'shot';
      const img = document.createElement('img');
      img.src = shot.url;
      img.alt = 'Photo ' + (index + 1) + ' from this temporary session';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove photo ' + (index + 1));
      remove.addEventListener('click', () => {
        URL.revokeObjectURL(shot.url);
        shots.splice(index, 1);
        renderShots();
      });
      item.append(img, remove);
      shotGrid.appendChild(item);
    });
  }

  captureButton.addEventListener('click', () => {
    if (!stream || !camera.videoWidth || !camera.videoHeight) return;
    canvas.width = camera.videoWidth;
    canvas.height = camera.videoHeight;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.drawImage(camera, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      shots.push({ blob, url, createdAt: new Date().toISOString() });
      renderShots();
    }, 'image/jpeg', 0.92);
  });

  function clearTemporaryState() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    camera.srcObject = null;
    shots.forEach((shot) => URL.revokeObjectURL(shot.url));
    shots = [];
    shotGrid.innerHTML = '';
    shotCount.textContent = '0';
    guestName.value = '';
    identityMode = 'guest';
    chooseIdentity('guest');
    captureButton.disabled = true;
    cameraStatus.textContent = 'Starting camera…';
    cameraStatus.classList.remove('ready');
  }

  function endSession() {
    clearTemporaryState();
    show(ended);
  }

  endButtons.forEach((button) => button.addEventListener('click', endSession));

  newSessionButton.addEventListener('click', () => {
    clearTemporaryState();
    renderShots();
    show(setup);
  });

  window.addEventListener('pagehide', () => {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    shots.forEach((shot) => URL.revokeObjectURL(shot.url));
  });

  renderShots();
})();