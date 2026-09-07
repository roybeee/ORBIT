import {readWorkspace,writeCommand,type Database} from '../../../db/repository.ts';
import {actionSchema} from '../validation.ts';
import {decrypt} from '../agent/secrets.ts';
import {gunzipSync,strFromU8} from 'fflate';
import seed from './seed.json' with {type:'json'};
export interface WikiRuntime {ORBIT_WIKI_SEED_KEY?:string;ORBIT_WIKI_OWNER_EMAIL?:string;[key:string]:unknown}
export async function bootstrapWiki(db:Database,user:{id:string;email:string},env:WikiRuntime) {
 if(!env.ORBIT_WIKI_SEED_KEY||!env.ORBIT_WIKI_OWNER_EMAIL||user.email.toLowerCase()!==env.ORBIT_WIKI_OWNER_EMAIL.toLowerCase())return {available:false,imported:0};
 const existing=await db.prepare('SELECT revision FROM orbit_mutations WHERE owner_id=? AND operation_id=?').bind(user.id,seed.id).first();
 if(existing)return {available:true,imported:seed.count};
 const count=Number(env.ORBIT_WIKI_SEED_PARTS);
 if(!Number.isInteger(count)||count<1||count>100)throw new Error('위키 초기 자료 설정을 확인해 주세요.');
 const payload=Array.from({length:count},(_,i)=>String(env['ORBIT_WIKI_SEED_PART_'+i]??'')).join('');
 const packed=await decrypt<{gzip:string}>(payload,env.ORBIT_WIKI_SEED_KEY,seed.id);
 const bytes=Uint8Array.from(atob(packed.gzip),c=>c.charCodeAt(0));
 const action=actionSchema.parse(JSON.parse(strFromU8(gunzipSync(bytes))));
 const current=await readWorkspace(db,user.id);
 await writeCommand(db,user.id,{operationId:seed.id,expectedRevision:current.revision,action});
 return {available:true,imported:seed.count};
}
