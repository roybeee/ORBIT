import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {detectInstallEnvironment,guideBrowser,installRootUrl} from '../lib/orbit/installation.ts';
const source=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
function harness(fetcher){
 const listeners=new Map(),stores=new Map(),deleted=[];
 const caches={open:async name=>{if(!stores.has(name))stores.set(name,new Map());const data=stores.get(name);return{put:async(key,value)=>data.set(key,value.clone()),match:async key=>data.get(key)?.clone()}},keys:async()=>[...stores.keys()],delete:async key=>{deleted.push(key);return stores.delete(key)}};
 const self={location:{origin:'https://orbit.test'},addEventListener:(name,fn)=>listeners.set(name,fn),skipWaiting:async()=>{},clients:{claim:async()=>{}}};
 vm.runInNewContext(source,{self,caches,fetch:fetcher,Request,Response,URL,Map,Promise});
 return{stores,deleted,caches,lifecycle:async name=>{let work;listeners.get(name)({waitUntil:p=>work=p});await work},request:(path,options={})=>{let result;listeners.get('fetch')({request:{url:new URL(path,self.location.origin).href,method:'GET',mode:'cors',...options},respondWith:p=>result=p});return result}};
}
test('manifest launches the standalone agent on desktop and phone with real icons and in-scope shortcuts',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'));
 assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'/');assert.equal(manifest.scope,'/');assert.equal(manifest.prefer_related_applications,false);
 assert.equal(manifest.id,'/');assert.equal(manifest.orientation,undefined);
 for(const icon of manifest.icons){const bytes=await readFile(new URL('../public'+icon.src,import.meta.url));assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`,icon.sizes)}
 assert.ok(manifest.icons.some(icon=>icon.purpose==='maskable'&&icon.sizes==='512x512'));
 const apple=await readFile(new URL('../public/icons/apple-touch-icon.png',import.meta.url));assert.equal(apple.readUInt32BE(16),180);assert.equal(apple.readUInt32BE(20),180);
 for(const shortcut of manifest.shortcuts)assert.match(shortcut.url,/^\/#(today|tasks|review|proposal)$/);
});
test('desktop detection distinguishes Safari, Chrome and Edge despite shared user-agent tokens',()=>{
 const cases=[
  [{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',platform:'MacIntel'},'mac','safari'],
  [{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',platform:'MacIntel'},'mac','chrome'],
  [{userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',platform:'Win32'},'windows','edge'],
  [{userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36',platform:'Win32'},'windows','chrome'],
  [{userAgent:'Chrome/140.0.0.0 Safari/537.36',userAgentData:{platform:'Windows'}},'windows','chrome'],
 ];
 for(const [input,platform,browser] of cases)assert.deepEqual(detectInstallEnvironment(input),{platform,browser});
});
test('recognizes iPad desktop mode and avoids mistaking alternate browsers for Chrome',()=>{
 const cases=[
  [{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15',platform:'MacIntel',maxTouchPoints:5},'ios','safari'],
  [{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1'},'ios','chrome'],
  [{userAgent:'Mozilla/5.0 (Linux; Android 15) Chrome/140.0.0.0 Mobile Safari/537.36'},'android','chrome'],
  [{userAgent:'Mozilla/5.0 (Linux; Android 15) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36'},'android','other'],
  [{userAgent:'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0 Safari/537.36 OPR/120.0.0.0'},'windows','other'],
  [{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15) Gecko/20100101 Firefox/140.0'},'mac','other'],
  [{userAgent:'Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/140.0'},'other','other'],
 ];
 for(const [input,platform,browser] of cases)assert.deepEqual(detectInstallEnvironment(input),{platform,browser});
 assert.equal(guideBrowser('ios','chrome'),'safari');assert.equal(guideBrowser('windows','safari'),'edge');
});
test('manual install opens the actual agent route with a supported browser for every selected device',()=>{
 for(const platform of ['mac','windows','android','ios'])for(const browser of ['safari','chrome','edge','other']){
  const url=new URL(installRootUrl(platform,browser),'https://orbit.test');
  assert.equal(url.pathname,'/');assert.equal(url.hash,'#agent');assert.equal(url.searchParams.get('install'),platform);
  assert.ok(['safari','chrome','edge'].includes(url.searchParams.get('browser')));
  if(platform==='ios')assert.equal(url.searchParams.get('browser'),'safari');
  if(platform==='windows')assert.notEqual(url.searchParams.get('browser'),'safari');
 }
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
