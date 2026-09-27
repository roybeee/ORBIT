import {minuteInZone,todayInZone} from '../dates.ts';

// What the owner sees for one saved Slack request. The stored status says where the request is in
// its life; the approval cards of a finished resume decide whether it still needs the owner.
export type RequestStatus='received'|'waiting'|'processing'|'needs_review'|'completed'|'partial'|'expired'|'failed'|'unconfirmed';
export type ReasonKind=''|'quota'|'rate_limit'|'auth'|'other';
export type RequestCounts={total:number;pending:number;approved:number;rejected:number;expired:number};
export interface SlackRequestItem {id:string;createdAt:string;channelId:string;messageTs:string;summary:string;permalink:string;status:RequestStatus;statusLabel:string;reasonKind:ReasonKind;holdId:string;nextCheckAt:number;conversationId:string;counts:RequestCounts;deliveries:number;text?:never}

export const SLACK_REQUEST_CONVERSATION='slack-request:';
// Slack redirects this address to the message in whichever workspace the viewer is signed in to.
export const slackPermalink=(channelId:string,messageTs:string)=>`https://slack.com/archives/${encodeURIComponent(channelId)}/p${messageTs.replace('.','')}`;
// The list never shows the whole message: one line, cut at 60 characters.
export function summarize(text:string){const line=text.replace(/\s+/g,' ').trim();return line.length>60?line.slice(0,59)+'…':line}

const causes:Record<ReasonKind,string>={quota:'AI 사용량 한도 소진',rate_limit:'일시적 요청 제한',auth:'AI 제공자 인증 실패',other:'AI 처리 실패','':''};
const at=(ms:number,timeZone:string)=>new Intl.DateTimeFormat('ko-KR',{timeZone,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(ms));
export function statusLabel(status:RequestStatus,reasonKind:ReasonKind,nextCheckAt:number,counts:RequestCounts,timeZone='Asia/Seoul'){
 switch(status){
  case 'received':return '요청 보관됨 · Slack 처리 결과 확인 중';
  case 'waiting':return `요청 보관됨 · ${causes[reasonKind]||'AI 사용량 한도'} · 회복 대기${nextCheckAt?` (${at(nextCheckAt,timeZone)} 다시 확인)`:''} · 아직 등록되지 않음`;
  case 'processing':return '처리 중 · 보관한 원문을 한 번만 해석하고 있습니다';
  case 'needs_review':return `확인 필요 · 초안 ${counts.pending}건${counts.expired?` (만료 ${counts.expired}건)`:''} · 승인 전에는 등록되지 않음`;
  case 'completed':return counts.approved?`완료 · ${counts.approved}건 등록`:'완료 · 등록할 항목 없음';
  case 'partial':return `일부 완료 · ${counts.approved}건 등록, 만료 ${counts.expired}건은 새 시간으로 다시 정해 주세요`;
  case 'expired':return `만료됨 · 예정 시간이 지나 자동 등록하지 않았습니다 (${counts.expired}건)`;
  case 'failed':return `처리 실패 · ${causes[reasonKind]||'AI 처리 실패'}`+(reasonKind==='auth'?' · 인증 정보를 확인한 뒤 다시 처리하세요':'');
  case 'unconfirmed':return '처리 결과 미확인 · Slack에서 답을 받았는지 확인한 뒤 다시 처리하거나 취소하세요';
 }
}

type Card={state:string;action:{type?:string;event?:{date?:string;start?:number}}};
// Event proposals that carry a start time: ORBIT events and direct Google Calendar events.
export const TIMED_ACTIONS=['event.upsert','google.event.create'];
// A proposed event whose start time has passed cannot be registered as proposed.
export function eventStarted(event:{date?:string;start?:number}|undefined,timeZone:string,now=new Date()){
 if(!event?.date||typeof event.start!=='number')return false;
 const today=todayInZone(timeZone,now);
 return event.date<today||event.date===today&&event.start<=minuteInZone(timeZone,now);
}
export function countCards(cards:Card[],timeZone:string,now=new Date()):RequestCounts{
 const open=cards.filter(c=>c.state==='pending'||c.state==='applying'),expired=open.filter(c=>TIMED_ACTIONS.includes(c.action.type??'')&&eventStarted(c.action.event,timeZone,now)).length;
 return {total:cards.length,pending:open.length-expired,approved:cards.filter(c=>c.state==='approved').length,rejected:cards.filter(c=>c.state==='rejected').length,expired};
}
const STORED:Record<string,RequestStatus>={received:'received',waiting_quota:'waiting',queued:'waiting',processing:'processing',failed:'failed',unconfirmed:'unconfirmed'};
export function displayStatus(stored:string,counts:RequestCounts):RequestStatus{
 if(stored!=='done')return STORED[stored]??'failed';
 if(counts.pending)return 'needs_review';
 if(counts.expired)return counts.approved?'partial':'expired';
 return 'completed';
}
