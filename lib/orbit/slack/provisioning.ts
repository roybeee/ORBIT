import {z} from 'zod';
import type {Database} from '../../../db/repository.ts';
import {digest} from './directives.ts';

// A deployment operator stages one exact capability through Sites runtime env.
// Request bodies cannot choose the principal, action, digest or expiry. No DDL,
// identity registration, user headers, site gate or application key grants access.
const hash=z.string().regex(/^[0-9a-f]{64}$/);
const manifestSchema=z.object({action:z.enum(['create','rotate','revoke']),tokenHash:hash,
 ownerId:z.string().min(1).max(160),emailHash:hash,workspaceId:z.string().regex(/^T[A-Z0-9]+$/),
 requesterId:z.string().regex(/^U[A-Z0-9]+$/),expiresAt:z.number().int().positive(),previousTokenHash:hash.optional()}).strict();
type Manifest=z.infer<typeof manifestSchema>;
type Credential={token_hash:string;owner_id:string;workspace_id:string;requester_id:string;scope:string;expires_at:number;revoked:number};
type Environment={ORBIT_SLACK_PROVISION_AUTH_HASH?:unknown;ORBIT_SLACK_PROVISION_MANIFEST?:unknown};
const same=(r:Credential,m:Manifest)=>r.owner_id===m.ownerId&&r.workspace_id===m.workspaceId&&r.requester_id===m.requesterId&&r.scope==='directives:write';
export async function provisionSlackCredential(db:Database,request:Request,env:Environment):Promise<Response>{
 const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Authorization, OAI-Sites-Authorization'}});
 try{
  const token=/^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('authorization')??'')?.[1];
  if(!token||!hash.safeParse(env.ORBIT_SLACK_PROVISION_AUTH_HASH).success)return reply({error:'unauthorized'},401);
  const actual=await digest(token),expected=env.ORBIT_SLACK_PROVISION_AUTH_HASH as string;
  let difference=0;for(let i=0;i<64;i++)difference|=actual.charCodeAt(i)^expected.charCodeAt(i);
  if(difference)return reply({error:'unauthorized'},401);
  if(request.headers.get('sec-fetch-site')==='cross-site'||(request.headers.has('origin')&&request.headers.get('origin')!==new URL(request.url).origin))return reply({error:'origin'},403);
  if(typeof env.ORBIT_SLACK_PROVISION_MANIFEST!=='string'||env.ORBIT_SLACK_PROVISION_MANIFEST.length>2048)return reply({error:'manifest_unavailable'},503);
  const parsed=manifestSchema.safeParse(JSON.parse(env.ORBIT_SLACK_PROVISION_MANIFEST));
  if(!parsed.success)return reply({error:'invalid_manifest'},422);
  const m=parsed.data;
  if((m.action==='rotate')!==!!m.previousTokenHash||m.tokenHash===m.previousTokenHash)return reply({error:'invalid_rotation'},422);
  // Only existing verified, unconflicted canonical identity links may be used.
  const identity=await db.prepare('SELECT owner_id,conflicted FROM orbit_identity_links WHERE email_hash=?').bind(m.emailHash).first<{owner_id:string;conflicted:number}>();
  if(!identity||identity.conflicted!==0||identity.owner_id!==m.ownerId)return reply({error:'owner_binding_required'},403);
  const read=(tokenHash:string)=>db.prepare('SELECT * FROM orbit_slack_credentials WHERE token_hash=?').bind(tokenHash).first<Credential>();
  let row=await read(m.tokenHash);
  if(request.method==='GET')return reply({state:!row?'absent':row.revoked?'revoked':row.expires_at<=Date.now()?'expired':'active',matches:!!row&&same(row,m)&&row.expires_at===m.expiresAt});
  if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'json_required'},415);
  const reader=request.body?.getReader();let body='';if(reader){const decoder=new TextDecoder();let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024){await reader.cancel();return reply({error:'body_too_large'},413)}body+=decoder.decode(value,{stream:true})}body+=decoder.decode()}
  if(body.trim()!=='{}')return reply({error:'empty_object_required'},422);
  if(row&&(!same(row,m)||row.expires_at!==m.expiresAt))return reply({error:'immutable_credential_conflict'},409);
  if(m.action==='revoke'){
   if(!row)return reply({error:'not_found'},404);
   await db.prepare('UPDATE orbit_slack_credentials SET revoked=1 WHERE token_hash=?').bind(m.tokenHash).run();
  }else{
   if(m.expiresAt<=Date.now()||m.expiresAt>Date.now()+30*86400000)return reply({error:'expiry_out_of_bounds'},422);
   if(row?.revoked)return reply({error:'revoked_credential'},409);
   const old=m.previousTokenHash?await read(m.previousTokenHash):null;
   if(m.action==='rotate'&&(!old||!same(old,m)||(!row&&(old.revoked||old.expires_at<=Date.now()))))return reply({error:'rotation_principal_conflict'},409);
   const identityGate='EXISTS(SELECT 1 FROM orbit_identity_links WHERE email_hash=? AND owner_id=? AND conflicted=0)';
   const rotationGate=old?" AND EXISTS(SELECT 1 FROM orbit_slack_credentials WHERE token_hash=? AND owner_id=? AND workspace_id=? AND requester_id=? AND scope='directives:write' AND revoked=0 AND expires_at>?)":'';
   const statements=[db.prepare(`INSERT INTO orbit_slack_credentials(token_hash,owner_id,workspace_id,requester_id,scope,expires_at,revoked) SELECT ?,?,?,?,'directives:write',?,0 WHERE ${identityGate}${rotationGate} ON CONFLICT(token_hash) DO NOTHING`).bind(m.tokenHash,m.ownerId,m.workspaceId,m.requesterId,m.expiresAt,m.emailHash,m.ownerId,...(old?[old.token_hash,m.ownerId,m.workspaceId,m.requesterId,Date.now()]:[]))];
   if(old)statements.push(db.prepare("UPDATE orbit_slack_credentials SET revoked=1 WHERE token_hash=? AND EXISTS(SELECT 1 FROM orbit_slack_credentials WHERE token_hash=? AND owner_id=? AND workspace_id=? AND requester_id=? AND scope='directives:write' AND expires_at=? AND revoked=0)").bind(old.token_hash,m.tokenHash,m.ownerId,m.workspaceId,m.requesterId,m.expiresAt));
   await db.batch(statements);
  }
  row=await read(m.tokenHash);
  if(!row||!same(row,m)||row.expires_at!==m.expiresAt||row.revoked!==(m.action==='revoke'?1:0))return reply({error:'reconcile_required'},409);
  return reply({state:row.revoked?'revoked':'active',matches:true});
 }catch{return reply({error:'provisioning_unavailable'},503)}
}
