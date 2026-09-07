import {readWorkspace,writeCommand,type Database} from '../../../db/repository.ts';
import {actionSchema} from '../validation.ts';
import {decrypt} from '../agent/secrets.ts';
import {gunzipSync,strFromU8} from 'fflate';
import seed from './seed.json' with {type:'json'};
export interface WikiRuntime {ORBIT_WIKI_SEED_KEY?:string;ORBIT_WIKI_OWNER_EMAIL?:string}
export async function bootstrapWiki(db:Database,user:{id:string;email:string},env:WikiRuntime) {
 if(!env.ORBIT_WIKI_SEED_KEY||!env.ORBIT_WIKI_OWNER_EMAIL||user.email.toLowerCase()!==env.ORBIT_WIKI_OWNER_EMAIL.toLowerCase())return {available:false,imported:0};
 const existing=await db.prepare('SELECT revision FROM orbit_mutations WHERE owner_id=? AND operation_id=?').bind(user.id,seed.id).first();
 if(existing)return {available:true,imported:seed.count};
 const packed=await decrypt<{gzip:string}>(seed.payload,env.ORBIT_WIKI_SEED_KEY,seed.id);
 const bytes=Uint8Array.from(atob(packed.gzip),c=>c.charCodeAt(0));
 const action=actionSchema.parse(JSON.parse(strFromU8(gunzipSync(bytes))));
 const current=await readWorkspace(db,user.id);
 await writeCommand(db,user.id,{operationId:seed.id,expectedRevision:current.revision,action});
 return {available:true,imported:seed.count};
}
