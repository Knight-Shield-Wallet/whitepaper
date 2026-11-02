const toggle=document.querySelector(".nav-toggle");
const links=document.querySelector(".nav-links");
if(links&&!links.querySelector('a[href="/workspace/"]')){
  const workspace=document.createElement("a");
  workspace.href="/workspace/";
  workspace.textContent="Workspace";
  if(location.pathname.startsWith("/workspace/")) workspace.classList.add("nav-primary");
  const catalogue=links.querySelector('a[href="/catalogue/"]');
  if(catalogue) catalogue.after(workspace); else links.prepend(workspace);
}
if(toggle&&links){
  toggle.addEventListener("click",()=>{
    const open=links.classList.toggle("open");
    toggle.setAttribute("aria-expanded",String(open));
  });
  links.querySelectorAll("a").forEach(a=>a.addEventListener("click",()=>{
    links.classList.remove("open");
    toggle.setAttribute("aria-expanded","false");
  }));
}
document.querySelectorAll("[data-year]").forEach(el=>el.textContent=new Date().getFullYear());

const signupForms=[...document.querySelectorAll("[data-ksd-signup]")];
const setSignupAvailability=(form,enabled,message)=>{
  const button=form.querySelector('button[type="submit"]');
  form.querySelectorAll("input,select,button").forEach(control=>{control.disabled=!enabled;});
  form.setAttribute("aria-disabled",String(!enabled));
  if(button) button.textContent=enabled?"Sign me up":"Updates opening soon";
  const status=form.querySelector("[data-signup-status]");
  if(status){
    status.textContent=message||"";
    status.className="signup-status";
  }
};

const installSignupHandler=(form,endpoint)=>{
  const status=form.querySelector("[data-signup-status]");
  const button=form.querySelector('button[type="submit"]');
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    const data=new FormData(form);
    const interest=String(data.get("interest")||form.dataset.interest||"").trim();
    const email=String(data.get("email")||"").trim();
    const firstName=String(data.get("first_name")||"").trim();
    const consent=data.get("consent")==="on";
    if(!email||!interest||!consent)return;
    button.disabled=true;
    status.textContent="Submitting…";
    status.className="signup-status working";
    try{
      const response=await fetch(endpoint,{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({
          email,
          first_name:firstName||null,
          interest,
          consent:true,
          consent_version:"ksdlabs-public-opt-in-v1",
          privacy_version:"ksdlabs-subscriber-privacy-v1",
          source_surface:form.dataset.sourceSurface||"public-site",
          source_url:location.href,
          campaign:null,
          company_website:String(data.get("company_website")||"")
        })
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok||result.ok!==true)throw new Error(result.code||"SIGNUP_FAILED");
      form.reset();
      status.textContent="Almost done — check your inbox to confirm your email.";
      status.className="signup-status ok";
    }catch{
      status.textContent="Signup is temporarily unavailable. Please try again later.";
      status.className="signup-status error";
    }finally{
      button.disabled=false;
    }
  });
};

if(signupForms.length){
  signupForms.forEach(form=>setSignupAvailability(
    form,
    false,
    "Email signup is being verified. No address is collected yet."
  ));

  fetch("/deployment-manifest.json",{cache:"no-store"})
    .then(response=>{
      if(!response.ok)throw new Error("SIGNUP_MANIFEST_UNAVAILABLE");
      return response.json();
    })
    .then(manifest=>{
      const updates=manifest&&manifest.customer_updates||{};
      if(updates.live!==true||updates.backend_runtime_verified!==true){
        throw new Error("SIGNUP_NOT_VERIFIED");
      }
      const endpoint=String(updates.public_signup_api||"").trim();
      const parsed=new URL(endpoint,location.origin);
      if(parsed.protocol!=="https:"||parsed.hostname!=="api.ksdlabs.com"||parsed.pathname!=="/v1/subscriptions"){
        throw new Error("SIGNUP_ENDPOINT_NOT_APPROVED");
      }
      signupForms.forEach(form=>{
        setSignupAvailability(form,true,"");
        installSignupHandler(form,parsed.href);
      });
    })
    .catch(()=>{
      signupForms.forEach(form=>setSignupAvailability(
        form,
        false,
        "Email signup is being verified. No address is collected yet."
      ));
    });
}


// Local illustrative walkthrough: no network, credentials or real execution.
document.querySelectorAll("[data-cafai-demo]").forEach(demo=>{
  const task=demo.querySelector("[data-demo-task]");
  const evidence=demo.querySelector("[data-demo-evidence]");
  const next=demo.querySelector("[data-demo-next]");
  const reset=demo.querySelector("[data-demo-reset]");
  const output=demo.querySelector("[data-demo-output]");
  let step=0;
  const render=(heading,body)=>{
    const h=document.createElement("h3");
    h.textContent=heading;
    const p=document.createElement("p");
    p.textContent=body;
    output.replaceChildren(h,p);
  };
  const restart=()=>{
    step=0; task.disabled=false; evidence.disabled=false;
    next.disabled=false; next.textContent="Start demo";
    render("CafAI brings the work together.","Choose an example, then start. You will see the proposed scope before approving the next step.");
  };
  reset.addEventListener("click",restart);
  next.addEventListener("click",()=>{
    const website=task.value==="website";
    if(step===0){
      task.disabled=true; evidence.disabled=true; step=1;
      render("Dispatch: review the sample scope",website
        ?"Proposed example: update one product description in a preview and check the page and its links. No production publication, purchases or DNS changes are allowed. Approving advances this illustration only."
        :"Proposed example: prepare an application draft using approved information and flag missing fields. No submission, signature, payment or new account is allowed. Approving advances this illustration only.");
      next.textContent="Approve sample scope";
    }else if(step===1){
      step=2;
      render("CafAI: sample work record",website
        ?"Fictional worker record: the preview description was edited. The record names the allowed change and links it to the sample scope. Next, inspect what an independent evidence check would conclude."
        :"Fictional worker record: a draft was prepared and missing fields were marked. Nothing was submitted. Next, inspect what an independent evidence check would conclude.");
      next.textContent="Review sample evidence";
    }else if(step===2){
      step=3;
      const complete=evidence.value==="complete";
      render(complete?"Orbit: illustrative checks pass":"Orbit: illustrative result remains unverified",
        complete
        ?(website?"Sample evidence says the preview text matches and its links work. In a real workflow these observations would need retained evidence and independent verification. This demonstration proves neither.":"Sample evidence says the draft is saved, required fields are identified and no submission occurred. In a real workflow these observations would need retained evidence and independent verification. This demonstration proves neither.")
        :(website?"The sample record contains an edit claim but no page or link check. The illustrated outcome stays unverified. Next action: obtain the missing runtime evidence.":"The sample record claims a draft exists but contains no saved draft to inspect. The illustrated outcome stays unverified. Next action: obtain the draft evidence."));
      next.disabled=true; next.textContent="Walkthrough finished";
    }
  });
});
