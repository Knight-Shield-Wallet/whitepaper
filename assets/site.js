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

const KSD_SIGNUP_API=(document.documentElement.dataset.ksdSignupApi||"https://api.ksdlabs.com").replace(/\/$/,"");
document.querySelectorAll("[data-ksd-signup]").forEach(form=>{
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
      const response=await fetch(KSD_SIGNUP_API+"/v1/subscriptions",{
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
});
