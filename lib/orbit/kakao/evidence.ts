import {AgentError} from '../agent/errors.ts';
import {addDays,todayInZone,validDate} from '../dates.ts';
import type {KakaoCapture,KakaoCitation,KakaoMessage} from './types.ts';

export function messageRegistry(capture:KakaoCapture){
 return new Map(capture.rooms.flatMap(room=>room.messages.map(message=>[message.id,{...message,room:room.title}] as const)));
}
export function validateCitations(capture:KakaoCapture,citations:KakaoCitation[]){
 const registry=messageRegistry(capture);
 return citations.map(citation=>{
  const message=registry.get(citation.messageId);
  if(!message||!message.text.includes(citation.quote))throw new AgentError('분석 결과의 인용을 실제 수집한 대화와 대조하지 못했습니다. 변경은 반영하지 않았습니다.','KAKAO_EVIDENCE',422);
  return {...message,quote:citation.quote};
 });
}
function datesMentioned(message:KakaoMessage,quote:string){
 const base=message.sentOn??todayInZone('Asia/Seoul',new Date(message.sentAt!)),year=base.slice(0,4),dates:string[]=[];
 for(const match of quote.matchAll(/(?:(\d{4})\s*[-./년]\s*)?(\d{1,2})\s*[-./월]\s*(\d{1,2})(?:일)?/g)){
  const date=`${match[1]??year}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;if(validDate(date))dates.push(date);
 }
 for(const [word,offset] of [['오늘',0],['내일',1],['모레',2]] as const)if(quote.includes(word))dates.push(addDays(base,offset));
 return dates;
}
function minutesMentioned(quote:string){
 const values:number[]=[];
 for(const match of quote.matchAll(/(?:(오전|오후|AM|PM)\s*)?(\d{1,2})\s*:\s*(\d{2})/gi)){
  const hour=Number(match[2]),minute=Number(match[3]);if(hour>23||minute>59)continue;
  if(!match[1]&&hour>=1&&hour<=12&&!/24\s*(?:시간제|h|hour)/i.test(quote))continue;
  values.push((match[1]?hour%12+(/오후|PM/i.test(match[1])?12:0):hour)*60+minute);
 }
 for(const match of quote.matchAll(/(오전|오후)\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/g)){
  const hour=Number(match[2]),minute=Number(match[3]??0);if(hour>=1&&hour<=12&&minute<60)values.push((hour%12+(match[1]==='오후'?12:0))*60+minute);
 }
 return values;
}
/** A declared date/time must also be present in the cited text; model confidence is insufficient. */
export function assertGroundedDate(capture:KakaoCapture,citations:KakaoCitation[],date:string,start?:number,end?:number){
 const messages=validateCitations(capture,citations);
 if(!messages.some(m=>datesMentioned(m,m.quote).includes(date)))throw new AgentError('대화의 날짜 근거가 분석 결과와 일치하지 않습니다. 날짜를 직접 확인해 주세요.','KAKAO_EVIDENCE',422);
 if(start!==undefined&&end!==undefined){
  const minutes=messages.flatMap(m=>minutesMentioned(m.quote));
  if(!minutes.includes(start)||!minutes.includes(end))throw new AgentError('시작·종료 시각이 대화에 명확하지 않습니다. 시간을 확인해 주세요.','KAKAO_EVIDENCE',422);
 }
}
