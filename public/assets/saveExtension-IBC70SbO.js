var e=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
  <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
</svg>`,t=`<svg viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="3">
  <polyline points="20 6 9 17 4 12"/>
</svg>`,n=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M3 6h18"/><path d="M8 6V4h8v2"/>
  <path d="M5 6v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6"/>
  <line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
</svg>`,r=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
  <circle cx="12" cy="12" r="3"/>
</svg>`,i=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/>
</svg>`;function a(e){return`<svg viewBox="0 0 24 24" fill="none" stroke="${e}" stroke-width="2">
  <circle cx="12" cy="12" r="10" stroke-dasharray="30 60" stroke-linecap="round">
    <animateTransform attributeName="transform" type="rotate" values="0 12 12;360 12 12" dur="0.8s" repeatCount="indefinite"/>
  </circle>
</svg>`}var o=a(`#38bdf8`),s=a(`#f97316`),c=!1;function l(e,t){let n=e.createContentOfSaveFile(t.address.projectId),r=`${t.address.projectId}-project-state.json`;return JSON.stringify({filename:r,state:n})}function u(){return new Promise(e=>requestAnimationFrame(()=>e()))}function d(a,d){c||(c=!0,a.extend({id:`save-state`,toolbars:{global(c){let f=(m,h,g,_)=>{c([{type:`Icon`,title:`Save State`,svgSource:m,onClick:async()=>{try{let e=l(a,d),o=await(await fetch(`/__theatre-save`,{method:`POST`,headers:{"Content-Type":`application/json`},body:e})).json();o.success?(console.log(`[Theatre] State saved`),f(t,n,r,i),setTimeout(p,1500)):console.error(`[Theatre] Save failed:`,o.error)}catch(e){console.error(`[Theatre] Save error:`,e)}}},{type:`Icon`,title:`Clear Overrides`,svgSource:h,onClick:async()=>{console.log(`[Theatre] Clearing all overrides...`),await a.__experimental.__experimental_clearPersistentStorage(d.address.projectId),window.location.reload()}},{type:`Icon`,title:`Deploy to Staging`,svgSource:g,onClick:async()=>{try{let r=l(a,d);f(e,n,o,i),await u();let s=await(await fetch(`/__theatre-deploy-staging`,{method:`POST`,headers:{"Content-Type":`application/json`},body:r})).json();s.success?(console.log(`[Theatre] Staging deploy complete`,s.url),f(e,n,t,i),setTimeout(p,3e3)):(console.error(`[Theatre] Staging failed:`,s.error),p())}catch(e){console.error(`[Theatre] Staging error:`,e),p()}}},{type:`Icon`,title:`Deploy to Production`,svgSource:_,onClick:async()=>{try{let i=l(a,d);f(e,n,r,s),await u();let o=await(await fetch(`/__theatre-deploy`,{method:`POST`,headers:{"Content-Type":`application/json`},body:i})).json();o.success?(console.log(`[Theatre] Production deploy complete`,o.url),f(e,n,r,t),setTimeout(p,3e3)):(console.error(`[Theatre] Deploy failed:`,o.error),p())}catch(e){console.error(`[Theatre] Deploy error:`,e),p()}}}])},p=()=>f(e,n,r,i);return p(),()=>{}}}}))}export{d as initSaveExtension};