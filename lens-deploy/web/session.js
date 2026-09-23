(() => {
  const KEY='ksd_midnight_lens_guided_proof_v1';
  const proofMode=new URLSearchParams(location.search).get('proof')==='1';
  const el=id=>document.getElementById(id);
  const setup=el('setup'),capture=el('capture'),ended=el('ended'),guestChoice=el('guestChoice'),nameChoice=el('nameChoice'),nameWrap=el('nameWrap'),guestName=el('guestName'),startButton=el('startButton'),camera=el('camera'),canvas=el('frame'),cameraStatus=el('cameraStatus'),captureButton=el('captureButton'),shotGrid=el('shotGrid'),shotCount=el('shotCount'),emptyState=el('emptyState'),sessionWho=el('sessionWho'),newSessionButton=el('newSessionButton');
  const endButtons=[el('endButtonTop'),el('endButtonBottom')];
  let identityMode='guest',stream=null,shots=[],proofGuide=null;

  const now=()=>new Date().toISOString();
  function loadProof(){try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch{return null}}
  function saveProof(s){localStorage.setItem(KEY,JSON.stringify(s))}
  function event(name,value){if(!proofMode)return;const s=loadProof();if(!s)return;s.events=s.events||{};s.events[name]=value??now();saveProof(s);renderGuide()}
  function countEvent(name){if(!proofMode)return;const s=loadProof();if(!s)return;s.events=s.events||{};s.events[name]=(s.events[name]||0)+1;saveProof(s);renderGuide()}

  function show(screen){[setup,capture,ended].forEach(x=>x.classList.remove('active'));screen.classList.add('active');window.scrollTo({top:0,behavior:'instant'})}
  function chooseIdentity(mode){identityMode=mode;const guest=mode==='guest';guestChoice.classList.toggle('selected',guest);guestChoice.setAttribute('aria-pressed',String(guest));nameChoice.classList.toggle('selected',!guest);nameChoice.setAttribute('aria-pressed',String(!guest));nameWrap.classList.toggle('hidden',guest);if(!guest)guestName.focus();if(proofMode)event('identity_mode',mode)}
  guestChoice.addEventListener('click',()=>chooseIdentity('guest'));nameChoice.addEventListener('click',()=>chooseIdentity('name'));
  function normalizedName(){const raw=guestName.value.trim();return raw?(raw.startsWith('@')?raw:'@'+raw):''}

  function guideText(){
    const e=loadProof()?.events||{};
    if(!e.session_start_clicked_at)return 'Step 1 of 6 — Leave Guest selected, then tap Start Photo Session.';
    if(!e.camera_ready_at)return 'Step 2 of 6 — Allow camera access when Android asks.';
    if((e.capture_count||0)<1)return 'Step 3 of 6 — Take one photo.';
    if((e.remove_count||0)<1)return 'Step 4 of 6 — Tap Remove on that photo.';
    if(!e.recapture_after_remove)return 'Step 5 of 6 — Take another photo.';
    if(!e.session_ended_at)return 'Step 6 of 6 — Tap End Session & Clear Photos.';
    return 'Journey complete — returning to the proof receipt.';
  }
  function renderGuide(){
    if(!proofMode)return;
    if(!proofGuide){proofGuide=document.createElement('div');proofGuide.className='proof-guide';document.body.prepend(proofGuide)}
    proofGuide.textContent=guideText();
  }

  async function startCamera(){
    cameraStatus.textContent='Starting camera…';cameraStatus.classList.remove('ready');captureButton.disabled=true;
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){cameraStatus.textContent='Camera access is not available in this browser.';event('camera_error','unsupported');return}
    event('camera_requested_at',now());
    try{
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      camera.srcObject=stream;await camera.play();cameraStatus.classList.add('ready');captureButton.disabled=false;event('camera_ready_at',now());
    }catch(error){cameraStatus.textContent='Camera permission was not granted. End the session or allow camera access and try again.';event('camera_error',String(error?.name||'permission_denied'))}
  }

  startButton.addEventListener('click',async()=>{
    const label=identityMode==='guest'?'Guest':normalizedName();
    if(identityMode==='name'&&!label){guestName.setCustomValidity('Enter a KSD @name or choose Guest.');guestName.reportValidity();return}
    guestName.setCustomValidity('');sessionWho.textContent=label+' · camera-only session';
    if(proofMode){event('identity_mode',identityMode);event('session_start_clicked_at',now())}
    show(capture);await startCamera();
  });

  function renderShots(){
    shotCount.textContent=String(shots.length);shotGrid.innerHTML='';
    if(shots.length===0){shotGrid.appendChild(emptyState);emptyState.classList.remove('hidden');return}
    shots.forEach((shot,index)=>{
      const item=document.createElement('div');item.className='shot';
      const img=document.createElement('img');img.src=shot.url;img.alt='Photo '+(index+1)+' from this temporary session';
      const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.setAttribute('aria-label','Remove photo '+(index+1));
      remove.addEventListener('click',()=>{URL.revokeObjectURL(shot.url);shots.splice(index,1);countEvent('remove_count');renderShots()});
      item.append(img,remove);shotGrid.appendChild(item);
    });
  }

  captureButton.addEventListener('click',()=>{
    if(!stream||!camera.videoWidth||!camera.videoHeight)return;
    canvas.width=camera.videoWidth;canvas.height=camera.videoHeight;canvas.getContext('2d',{alpha:false}).drawImage(camera,0,0,canvas.width,canvas.height);
    canvas.toBlob(blob=>{if(!blob)return;shots.push({blob,url:URL.createObjectURL(blob),createdAt:now()});countEvent('capture_count');const s=loadProof();if(proofMode&&(s?.events?.remove_count||0)>=1)event('recapture_after_remove',true);renderShots()},'image/jpeg',.92);
  });

  function clearTemporaryState(){
    const hadStream=!!stream;
    if(stream){stream.getTracks().forEach(track=>track.stop());stream=null}
    camera.srcObject=null;shots.forEach(shot=>URL.revokeObjectURL(shot.url));shots=[];shotGrid.innerHTML='';shotCount.textContent='0';guestName.value='';identityMode='guest';chooseIdentity('guest');captureButton.disabled=true;cameraStatus.textContent='Starting camera…';cameraStatus.classList.remove('ready');
    if(proofMode){event('camera_stopped_on_end',hadStream);event('captures_cleared_on_end',shots.length===0)}
  }
  function endSession(){
    if(proofMode)event('session_ended_at',now());
    clearTemporaryState();show(ended);
    if(proofMode){event('fresh_session_state_confirmed',shots.length===0);setTimeout(()=>location.href='/proof-session?review=1',500)}
  }
  endButtons.forEach(button=>button.addEventListener('click',endSession));
  newSessionButton.addEventListener('click',()=>{clearTemporaryState();renderShots();show(setup)});
  window.addEventListener('pagehide',()=>{if(stream)stream.getTracks().forEach(track=>track.stop());shots.forEach(shot=>URL.revokeObjectURL(shot.url))});

  if(proofMode){const s=loadProof();if(!s){location.href='/proof-session';return}event('quick_session_opened_at',now());event('identity_mode','guest');renderGuide()}
  renderShots();
})();