// RFC 8291 (aes128gcm) and RFC 8292 (VAPID), using Workers Web Crypto.
const enc=new TextEncoder();
export const base64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export const unbase64=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
const join=(...arrays:Uint8Array[])=>{const out=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let offset=0;for(const a of arrays){out.set(a,offset);offset+=a.length}return out};
const hkdf=async(ikm:Uint8Array,salt:Uint8Array,info:Uint8Array,length:number)=>new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:salt as BufferSource,info:info as BufferSource},await crypto.subtle.importKey('raw',ikm as BufferSource,'HKDF',false,['deriveBits']),length*8));
export type Subscription={endpoint:string;keys:{p256dh:string;auth:string};subject:string};
export function validPushEndpoint(value:string){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&(u.hostname==='fcm.googleapis.com'||u.hostname.endsWith('.push.services.mozilla.com')||u.hostname.endsWith('.push.apple.com')||u.hostname==='web.push.apple.com'||u.hostname.endsWith('.notify.windows.com'));}catch{return false}}
export async function vapidKeys(){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);return {publicKey:base64url(new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey))),privateKey:JSON.stringify(await crypto.subtle.exportKey('jwk',pair.privateKey))};}
export async function encryptPush(subscription:Subscription,text:string,deterministic?:{salt:Uint8Array;pair:CryptoKeyPair}){
 const ua=unbase64(subscription.keys.p256dh),auth=unbase64(subscription.keys.auth);
 if(ua.length!==65||auth.length!==16)throw new Error('Invalid push keys');
 const pair=deterministic?.pair??await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const publicKey=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey));
 const peer=await crypto.subtle.importKey('raw',ua,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:peer},pair.privateKey,256));
 const ikm=await hkdf(shared,auth,join(enc.encode('WebPush: info\0'),ua,publicKey),32),salt=deterministic?.salt??crypto.getRandomValues(new Uint8Array(16));
 const cek=await hkdf(ikm,salt,enc.encode('Content-Encoding: aes128gcm\0'),16),nonce=await hkdf(ikm,salt,enc.encode('Content-Encoding: nonce\0'),12);
 const plain=join(enc.encode(text),new Uint8Array([2]));if(plain.length>3993)throw new Error('Push payload too large');
 const key=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']);
 const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,plain));
 return join(salt,new Uint8Array([0,0,16,0,65]),publicKey,encrypted);
}
export async function pushRequest(subscription:Subscription,keys:{publicKey:string;privateKey:string},payload:unknown){
 if(!validPushEndpoint(subscription.endpoint))throw new Error('Invalid push endpoint');
 const h=base64url(enc.encode(JSON.stringify({typ:'JWT',alg:'ES256'}))),p=base64url(enc.encode(JSON.stringify({aud:new URL(subscription.endpoint).origin,exp:Math.floor(Date.now()/1000)+3600,sub:subscription.subject})));
 const key=await crypto.subtle.importKey('jwk',JSON.parse(keys.privateKey),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const sig=base64url(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,enc.encode(h+'.'+p))));
 return {headers:{Authorization:`vapid t=${h}.${p}.${sig}, k=${keys.publicKey}`,'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream',TTL:'86400',Urgency:'normal'},body:await encryptPush(subscription,JSON.stringify(payload))};
}
