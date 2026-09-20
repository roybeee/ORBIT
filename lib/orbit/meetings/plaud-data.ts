import {normalize,projectTerms} from '../classify.ts';
import type {Project} from '../model.ts';

// Parse the documented MCP JSON response, never execute instructions in recording data.
export function mcpData(result:any):any {
 if(result?.isError)throw new Error('Plaud 조회 실패');
 if(result?.structuredContent)return result.structuredContent;
 if(!result?.content)return result;
 for(const block of result.content){if(block.type!=='text')continue;const text=String(block.text??'');
  try{return JSON.parse(text)}catch{}
  const wrapped=text.match(/<untrusted-user-data-([a-zA-Z0-9-]+)[^>]*>\s*([\s\S]*?)\s*<\/untrusted-user-data-\1>/);
  if(wrapped){try{return JSON.parse(wrapped[2])}catch{}}
 }
 throw new Error('Plaud 응답 형식을 확인하지 못했습니다.');
}
export interface Recording {id:string;title:string;started:string;duration:number;transcript:string;summary:string;pending:boolean}
const stamp=(ms:unknown)=>{const s=Math.max(0,Math.floor(Number(ms)/1000));return Number.isFinite(s)?`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`:'시간 미확인'};
export function recording(result:any):Recording{
 const data=mcpData(result),file=data?.data?.id?data.data:data;
 if(typeof file?.id!=='string'||!/^[-\w]{1,160}$/.test(file.id)||typeof file.name!=='string')throw new Error('녹음 식별자를 확인하지 못했습니다.');
 const sources=Array.isArray(file.source_list)?file.source_list:[],notes=Array.isArray(file.note_list)?file.note_list:[];
 const trans=sources.filter((s:any)=>s.data_type==='transaction'||s.data_type==='transcript');
 const text=trans.map((s:any)=>{if(!s.data_content)return '';let parts;try{parts=typeof s.data_content==='string'?JSON.parse(s.data_content):s.data_content}catch{throw new Error('전사 형식을 확인하지 못했습니다. 원문을 보존할 수 없어 수집을 보류합니다.')}
  if(!Array.isArray(parts))return '';
  return parts.map((p:any)=>`[${stamp(p.start_time)}–${stamp(p.end_time)}] ${String(p.speaker??'발화자 미확인')}: ${String(p.content??'')}`).join('\n');
 }).join('\n\n');
 const summary=notes.map((n:any)=>typeof n.data_content==='string'?n.data_content:'').filter(Boolean).join('\n\n');
 return {id:file.id,title:file.name.slice(0,160),started:String(file.start_at??file.created_at??''),duration:Number(file.duration)||0,transcript:text,summary,pending:!text.trim()||!summary.trim()};
}
export function listed(result:any):string[]{const data=mcpData(result),items=Array.isArray(data)?data:data?.data??data?.files;if(!Array.isArray(items))throw new Error('녹음 목록 형식을 확인하지 못했습니다.');return items.map((r:any)=>{if(typeof r.id!=='string'||!/^[-\w]{1,160}$/.test(r.id))throw new Error('녹음 목록 식별자를 확인하지 못했습니다.');return r.id})}
export function projectMatches(record:Recording,projects:Project[]){
 const text=normalize(record.title+' '+record.summary.slice(0,12000)+' '+record.transcript.slice(0,12000));
 return projects.filter(p=>p.id!=='plaud-inbox'&&p.status!=='completed').map(p=>{
  const matched=projectTerms(p).filter(t=>(t.manual||t.weight>=2)&&t.text.length>=(t.manual?2:3)&&text.includes(t.text)).map(t=>t.text);
  return {projectId:p.id,name:p.name,matched:[...new Set(matched)]};
 }).filter(p=>p.matched.length).slice(0,12);
}
export function meetingParts(record:Recording){
 const header=`Plaud 원본 ID: ${record.id}\n녹음 시각(원본 표기): ${record.started||'미확인'}\n\n`;
 const text=`## Plaud AI 요약 · 원문 확인 필요\n${record.summary||'요약 준비 중'}\n\n## 발화자·시간이 포함된 원문\n${record.transcript||'전사 준비 중'}\n`;
 const parts:string[]=[];for(let i=0;i<text.length;i+=88000)parts.push(header+(text.length>88000?`분할 원문 ${parts.length+1} · 전체 ${Math.ceil(text.length/88000)}개\n\n`:'')+text.slice(i,i+88000));
 return parts;
}
