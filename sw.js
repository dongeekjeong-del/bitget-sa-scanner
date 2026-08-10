const CACHE='sa-scanner-v3';
const ASSETS=['./','./index.html','./scalp.html','./manifest.webmanifest'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url); if(u.hostname==='api.bitget.com')return;
 if(e.request.mode==='navigate' && (u.pathname.endsWith('/bitget-sa-scanner/')||u.pathname.endsWith('/index.html'))){
   e.respondWith((async()=>{let r=await fetch(e.request).catch(()=>caches.match('./index.html'));let h=await r.text();
   const nav=`<div style="position:fixed;z-index:9999;right:12px;bottom:calc(14px + env(safe-area-inset-bottom));display:flex;gap:6px;background:#0b0d12dd;padding:6px;border:1px solid #252b3a;border-radius:13px;backdrop-filter:blur(10px)"><span style="padding:9px 11px;border-radius:9px;background:#70a7ff;color:#07111f;font:800 12px -apple-system">SWING</span><a href="./scalp.html" style="padding:9px 11px;border-radius:9px;background:#191e2b;color:#f4f6fb;text-decoration:none;font:800 12px -apple-system">SCALP</a></div>`;
   h=h.replace('</body>',nav+'</body>');return new Response(h,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})})());return;
 }
 e.respondWith(fetch(e.request).then(r=>{let c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request)));
});