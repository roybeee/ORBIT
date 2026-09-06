import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
function harness(fetcher){
 const listeners=new Map(),stores=new Map(),deleted=[];
 const caches={open:async name=>{if(!stores.has(name))stores.set(name,new Map());const data=stores.get(name);return{put:async(key,value)=>data.set(key,value.clone()),match:async key=>data.get(key)?.clone()}},keys:async()=>[...stores.keys()],delete:async key=>{deleted.push(key);return stores.delete(key)}};
 const self={location:{origin:'https://orbit.test'},addEventListener:(name,fn)=>listeners.set(name,fn),skipWaiting:async()=>{},clients:{claim:async()=>{}}};
 vm.runInNewContext(source,{self,caches,fetch:fetcher,Request,Response,URL,Map,Promise});
 return{stores,deleted,caches,lifecycle:async name=>{let work;listeners.get(name)({waitUntil:p=>work=p});await work},request:(path,options={})=>{let result;listeners.get('fetch')({request:{url:new URL(path,self.location.origin).href,method:'GET',mode:'cors',...options},respondWith:p=>result=p});return result}};
}
test('manifest supplies real phone icons, safe maskable size, and supported in-scope shortcuts',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'));
 assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'/');assert.equal(manifest.scope,'/');assert.equal(manifest.prefer_related_applications,false);
 for(const icon of manifest.icons){const bytes=await readFile(new URL('../public'+icon.src,import.meta.url));assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`,icon.sizes)}
 assert.ok(manifest.icons.some(icon=>icon.purpose==='maskable'&&icon.sizes==='512x512'));
 const apple=await readFile(new URL('../public/icons/apple-touch-icon.png',import.meta.url));assert.equal(apple.readUInt32BE(16),180);assert.equal(apple.readUInt32BE(20),180);
 for(const shortcut of manifest.shortcuts)assert.match(shortcut.url,/^\/#(today|tasks|review|proposal)$/);
});
test('installation fetches static assets with credentials and only stores valid types',async()=>{
 const fetched=[];const h=harness(async request=>{fetched.push(request);return new Response('static',{headers:{'content-type':request.url.endsWith('.html')?'text/html;charset=utf-8':request.url.endsWith('.svg')?'image/svg+xml':'image/png'}})});
 await h.lifecycle('install');assert.equal(fetched.length,6);for(const r of fetched){assert.equal(r.credentials,'same-origin');assert.equal(r.cache,'reload');assert.doesNotMatch(new URL(r.url).pathname,/^\/api\//)}
 assert.equal(h.stores.get('orbit-offline-v3').size,6);
});
test('redirected login pages and failed downloads never poison offline assets',async()=>{
 const h=harness(async request=>{if(request.url.endsWith('offline.html')){const response=new Response('private login',{headers:{'content-type':'text/html'}});Object.defineProperty(response,'redirected',{value:true});return response}if(request.url.endsWith('.svg'))throw new TypeError('offline');return new Response('login',{headers:{'content-type':'text/html'}})});
 await h.lifecycle('install');assert.equal(h.stores.get('orbit-offline-v3').size,0);
});
test('all private APIs, authentication, writes and foreign requests bypass the worker',()=>{
 const h=harness(()=>{throw new Error('must bypass')});
 for(const path of ['/api/workspace','/api/notes?id=n','/api/export','/signin-with-chatgpt','/signout-with-chatgpt','/callback','https://foreign.test/'])assert.equal(h.request(path),undefined);
 assert.equal(h.request('/',{method:'POST'}),undefined);assert.equal(h.request('/assets/app.js'),undefined);
});
test('successful private navigation is fetched each time and never cached',async()=>{
 let n=0;const h=harness(async()=>new Response('private '+(++n)));
 assert.equal(await(await h.request('/',{mode:'navigate'})).text(),'private 1');assert.equal(await(await h.request('/',{mode:'navigate'})).text(),'private 2');assert.equal(h.stores.size,0);
});
test('offline navigation returns only the static fallback, including a cold-cache failure',async()=>{
 const h=harness(async()=>{throw new TypeError('offline')});const cache=await h.caches.open('orbit-offline-v3');await cache.put('/offline.html',new Response('연결 안내'));
 assert.equal(await(await h.request('/#review',{mode:'navigate'})).text(),'연결 안내');h.stores.clear();const r=await h.request('/',{mode:'navigate'});assert.equal(r.status,503);assert.match(await r.text(),/인터넷 연결/);
});
test('activation removes old Orbit asset caches and preserves unrelated caches',async()=>{
 const h=harness(async()=>new Response());await h.caches.open('orbit-offline-v2');await h.caches.open('orbit-offline-v3');await h.caches.open('unrelated');await h.lifecycle('activate');assert.deepEqual(h.deleted,['orbit-offline-v2']);assert.ok(h.stores.has('unrelated'));
});
