const CACHE='orbit-offline-v3';
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
 if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 // Never intercept private APIs, exports or sign-in. No private HTML or app bundle cache.
 if(url.pathname.startsWith('/api/')||url.pathname.includes('signin-with-chatgpt')||url.pathname.includes('signout-with-chatgpt')||url.pathname==='/callback')return;
 if(event.request.mode==='navigate'){
  event.respondWith(fetch(event.request).catch(async()=>{
   const cache=await caches.open(CACHE);
   return await cache.match('/offline.html')||new Response('인터넷 연결 후 Orbit을 다시 열어 주세요.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});
  }));return;
 }
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
