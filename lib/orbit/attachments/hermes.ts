import type {Database} from '../../../db/repository.ts';
import {AgentError} from '../agent/errors.ts';
import {filesByIds,type Bucket} from './storage.ts';
import {MAX_PREVIEW_BYTES} from './types.ts';
// Store only immutable IDs in durable jobs. Reconstruct the same native image
// request from saved bytes for each retry; never embed binaries in D1.
export async function hermesAttachmentInput(db:Database,owner:string,bucket:Bucket|undefined,request:{input:string;[key:string]:unknown},ids:string[]){
 let files;try{files=await filesByIds(db,owner,ids)}catch(error){if(error instanceof AgentError)throw error;throw new AgentError('첨부파일 정보를 다시 확인하고 있습니다.','STORAGE',503)}const images=files.filter(f=>f.preview_key);if(!images.length)return JSON.stringify(request);if(!bucket)throw new AgentError('첨부파일을 불러오지 못했습니다. 다시 요청해 주세요.','STORAGE',503);
 const content:unknown[]=[{type:'text',text:request.input}];
 for(const file of images){let object;try{object=await bucket.get(file.preview_key!)}catch{throw new AgentError('첨부파일 저장소의 응답을 기다리고 있습니다.','STORAGE',503)};if(!object||object.size>MAX_PREVIEW_BYTES)throw new AgentError('첨부 미리보기를 불러오지 못했습니다.','STORAGE',503);let bytes:Uint8Array;try{bytes=new Uint8Array(await object.arrayBuffer())}catch{throw new AgentError('첨부파일을 다시 읽고 있습니다.','STORAGE',503)}let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));content.push({type:'text',text:`첨부: ${file.name} · ${file.context_label}`},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+btoa(binary)}});}
 const body=JSON.stringify({...request,input:[{role:'user',content}]});if(new TextEncoder().encode(body).length>9500000)throw new AgentError('이미지와 참고 기록이 많습니다. 첨부를 나누어 보내 주세요.','CONTEXT_SIZE',422);return body;
}
