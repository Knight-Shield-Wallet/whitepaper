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
