import {researchReply} from './order-research.ts';

// Recover presentation wrappers only. Never guess, repair or drop tool arguments.
function objectText(text:string){
 const candidates:string[]=[];let depth=0,start=-1,quoted=false,escaped=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(depth===0){if(c==='{'){start=i;depth=1;quoted=false;escaped=false;}continue;}
  if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
  if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0)candidates.push(text.slice(start,i+1));
 }
 if(depth||candidates.length!==1)throw new Error('JSON 객체는 정확히 하나여야 합니다.');
 return candidates[0];
}
export function parseResearchResponse(output:unknown){
 let value=output;
 if(typeof output==='string'){
  if(output.length>250000)throw new Error('응답이 250,000자를 초과했습니다. notes는 40,000자, report는 100,000자 이내로 나누세요.');
  const text=output.trim().replace(/^\uFEFF/,'');
  try{value=JSON.parse(text);}catch{try{value=JSON.parse(objectText(text));}catch{throw new Error('유효한 단일 JSON 객체가 아닙니다. 닫는 괄호와 문자열 이스케이프를 확인하세요.');}}
 }
 const result=researchReply.safeParse(value);
 if(!result.success)throw new Error(result.error.issues.slice(0,8).map(i=>`${i.path.join('.')||'response'}: ${i.code} (${i.message})`).join('; '));
 return result.data;
}
