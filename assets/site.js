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
