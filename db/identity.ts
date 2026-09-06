import type {Database} from './repository';

// These claims come only from Sites dispatch, never request bodies or form fields.
// Keep existing owner keys: encrypted integration secrets are bound to those keys.
export async function resolveIdentity(db:Database,email:string,stableId:string|null):Promise<string|null>{
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(email.trim().toLowerCase()));
 const hash=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
 if(stableId){
  await db.prepare(`INSERT INTO orbit_identity_links(email_hash,owner_id,conflicted) VALUES(?,?,0)
   ON CONFLICT(email_hash) DO UPDATE SET conflicted=1
   WHERE orbit_identity_links.owner_id<>excluded.owner_id AND orbit_identity_links.conflicted=0`).bind(hash,stableId).run();
  return stableId;
 }
 const link=await db.prepare('SELECT owner_id,conflicted FROM orbit_identity_links WHERE email_hash=?').bind(hash).first<{owner_id:string;conflicted:number}>();
 return link&&link.conflicted===0?link.owner_id:null;
}
