const CACHE='orbit-offline-v2';
const SAFE_ASSETS=['/offline.html','/favicon.svg','/icons/orbit-192.png','/icons/orbit-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SAFE_ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('orbit-offline-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 // Never cache authenticated HTML, APIs, exports, notes or user data.
 if(url.pathname.startsWith('/api/')||url.pathname.includes('signin-with-chatgpt')||url.pathname.includes('signout-with-chatgpt')||url.pathname==='/callback')return;
 if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(async()=>{const cached=await caches.match('/offline.html');return cached||new Response('인터넷 연결이 필요합니다.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}})}));return;}
 if(SAFE_ASSETS.includes(url.pathname))event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
