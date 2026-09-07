const SHARE_BUILD='2026-09-07.1';
self.addEventListener('message',event=>{if(event.data?.type==='ORBIT_SHARE_STATUS')event.ports?.[0]?.postMessage({type:'ORBIT_SHARE_STATUS',build:SHARE_BUILD,files:true});});
const CACHE='orbit-offline-v3';
const BUNDLES='orbit-static-v1';
const SAFE_ASSETS=new Map([
 ['/offline.html','text/html'],['/favicon.svg','image/svg+xml'],
 ['/icons/orbit-192.png','image/png'],['/icons/orbit-512.png','image/png'],
 ['/icons/orbit-maskable-512.png','image/png'],['/icons/apple-touch-icon.png','image/png'],
]);
// Auth redirects must never become a cached icon or offline page.
const safeResponse=(response,type)=>response.ok&&!response.redirected&&(response.headers.get('content-type')||'').split(';')[0]===type;
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await Promise.allSettled([...SAFE_ASSETS].map(async([path,type])=>{
   const response=await fetch(new Request(new URL(path,self.location.origin),{credentials:'same-origin',cache:'reload'}));
   if(safeResponse(response,type))await cache.put(path,response);
  }));
  await self.skipWaiting();
 })());
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('orbit-offline-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(url.origin===self.location.origin&&url.pathname==='/share-target'&&event.request.method==='POST'){event.respondWith(receiveShare(event.request));return;}
 if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 // Never cache private APIs, exports, sign-in or private HTML.
 if(url.pathname.startsWith('/api/')||url.pathname.includes('signin-with-chatgpt')||url.pathname.includes('signout-with-chatgpt')||url.pathname==='/callback')return;
 if(event.request.mode==='navigate'){
  event.respondWith(fetch(event.request).catch(async()=>{
   const cache=await caches.open(CACHE);
   return await cache.match('/offline.html')||new Response('인터넷 연결 후 Orbit을 다시 열어 주세요.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});
  }));return;
 }
 // Only content-hashed, user-independent code/style assets are cached.
 if(/^\/assets\/[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8,}\.(js|css|woff2)$/.test(url.pathname)&&!url.search){event.respondWith((async()=>{const cache=await caches.open(BUNDLES),hit=await cache.match(url.pathname);if(hit)return hit;const response=await fetch(event.request);const type=(response.headers.get('content-type')||'').split(';')[0];if(response.ok&&!response.redirected&&['application/javascript','text/javascript','text/css','font/woff2'].includes(type)){await cache.put(url.pathname,response.clone());const keys=await cache.keys();if(keys.length>80)await cache.delete(keys[0]);}return response;})());return;}
 if(SAFE_ASSETS.has(url.pathname)&&!url.search){
  event.respondWith((async()=>{
   const cache=await caches.open(CACHE),cached=await cache.match(url.pathname);
   if(cached)return cached;
   const response=await fetch(event.request);
   if(safeResponse(response,SAFE_ASSETS.get(url.pathname)))await cache.put(url.pathname,response.clone());
   return response;
  })());
 }
});

// OS-shared files are temporary drafts, never an authoritative/offline copy of
// workspace data. Stage before auth navigation; upload only after user review.
async function stageShare(record){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('orbit-share-drafts',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('shares'))r.result.createObjectStore('shares',{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 try{await new Promise((resolve,reject)=>{const tx=db.transaction('shares','readwrite'),store=tx.objectStore('shares'),all=store.getAll();all.onsuccess=()=>{let count=0;for(const item of all.result){if(Date.now()-item.createdAt>86400000)store.delete(item.id);else count++;}if(count>=10){tx.abort();return}store.put(record);};tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error||new Error('share queue full'));});}finally{db.close();}
}
async function receiveShare(request){
 try{
  const declared=Number(request.headers.get('content-length')||0);if(declared>150*1024*1024)throw new Error('too large');
  const form=await request.formData(),files=form.getAll('files').filter(file=>typeof file!=='string'&&file.size>0);
  if(files.length>8||files.reduce((n,f)=>n+f.size,0)>150*1024*1024||files.some(f=>f.size>100*1024*1024))throw new Error('too large');
  if(!files.length)throw new Error('empty');
  const id=crypto.randomUUID();await stageShare({id,createdAt:Date.now(),files:files.map(file=>({id:crypto.randomUUID(),file}))});return Response.redirect(new URL('/share?draft='+id,self.location.origin),303);
 }catch{return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orbit 공유</title><main style="font-family:system-ui;padding:32px;line-height:1.7"><h1>공유한 파일을 보관하지 못했습니다.</h1><p>파일 8개, 전체 150 MB 이내로 다시 공유해 주세요. 기기 저장 공간을 확인하고, 이전 공유 파일이 남아 있다면 먼저 정리해 주세요.</p><a href="/share">Orbit의 받은 파일 열기</a></main>',{status:503,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'}})}
}
