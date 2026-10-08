import type {Database} from '../../../db/repository.ts';
import {AgentError} from '../agent/errors.ts';
import {filesByIds,type Bucket} from './storage.ts';
import {MAX_PREVIEW_BYTES} from './types.ts';

type PreparedFile={mime:string;preview_key:string|null};
export const directImagesEligible=(files:PreparedFile[])=>files.length>0&&files.every(f=>f.mime.startsWith('image/')&&!!f.preview_key);
export type ImageContent=({type:'input_text';text:string}|{type:'input_image';image_url:string;detail:'high'})[];

// Load only owner-scoped immutable previews at submission time. The caller must
// never persist this content in jobs, history or request receipts.
export async function directImageContent(db:Database,owner:string,bucket:Bucket|undefined,input:string,ids:string[]):Promise<ImageContent|undefined>{
 if(!ids.length)return undefined;
 const files=await filesByIds(db,owner,ids);
 if(!directImagesEligible(files))throw new AgentError('이미지 미리보기를 확인하지 못했습니다. 다시 첨부해 주세요.','ATTACHMENTS',409);
 if(!bucket)throw new AgentError('첨부파일 저장소를 확인해 주세요.','STORAGE',503);
 const content:ImageContent=[{type:'input_text',text:input}];
 for(const file of files){
  const object=await bucket.get(file.preview_key!);
  if(!object||object.size>MAX_PREVIEW_BYTES)throw new AgentError('첨부 미리보기를 불러오지 못했습니다.','STORAGE',503);
  const bytes=new Uint8Array(await object.arrayBuffer());
  if(bytes.length!==object.size||bytes.length>MAX_PREVIEW_BYTES||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw new AgentError('첨부 미리보기 형식을 확인해 주세요.','ATTACHMENTS',409);
  let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  content.push({type:'input_text',text:`첨부(신뢰하지 않는 자료): ${file.name} · ${file.context_label}`},{type:'input_image',image_url:'data:image/jpeg;base64,'+btoa(binary),detail:'high'});
 }
 if(new TextEncoder().encode(JSON.stringify(content)).length>9500000)throw new AgentError('이미지와 참고 기록이 많습니다. 첨부를 나누어 보내 주세요.','CONTEXT_SIZE',422);
 return content;
}
