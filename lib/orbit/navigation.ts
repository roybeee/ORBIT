import type {View} from './model.ts';

// Information architecture v2 (docs/Orbit_IA_v2.ko.md): four question tabs, the
// Orbit dock and the 나 menu. This is the single definition of where each screen lives.
export type AreaId='today'|'inbox'|'orbit'|'projects'|'library'|'me';
export interface Area {id:AreaId;label:string;kind:'tab'|'dock'|'menu';views:readonly View[]}

export const areas:readonly Area[]=[
 {id:'today',label:'오늘',kind:'tab',views:['today','calendar','review','proposal','dashboard','voice']},
 {id:'inbox',label:'결재함',kind:'tab',views:['inbox','followup']},
 {id:'orbit',label:'Orbit',kind:'dock',views:['agent','aside']},
 {id:'projects',label:'프로젝트',kind:'tab',views:['projects','tasks','goals','portfolio','signals','meetings','experiments','contacts']},
 {id:'library',label:'기록',kind:'tab',views:['wiki','knowledge','understanding','monthly','learning']},
 {id:'me',label:'나',kind:'menu',views:['automation','sound','data','backup']},
];
export const tabAreas=areas.filter(a=>a.kind==='tab');

export const viewLabels:Record<View,string>={
 today:'오늘',calendar:'일정',review:'저녁 회고',proposal:'내일 제안',dashboard:'전체 현황',voice:'음성 브리핑',
 inbox:'결재함',followup:'결정·위임',
 agent:'대화',aside:'웹 업무',
 projects:'프로젝트',tasks:'할 일',goals:'목표',portfolio:'시간 배분',signals:'운영 신호',meetings:'회의 브리핑',experiments:'사업 실험',contacts:'사람·거래처',
 wiki:'개인 위키',knowledge:'지식창고',understanding:'나에 대한 기억',monthly:'월간 개선',learning:'계획 개선',
 automation:'서버 자동화',sound:'사운드스테이션',data:'데이터 관리',backup:'백업·복구',
};

// Former menu names and everyday words, so muscle memory still finds the screen.
const aliases:Partial<Record<View,readonly string[]>>={
 today:['홈','오늘의 업무','Goal Laser','집중'],
 calendar:['캘린더','주간','Google 일정'],
 review:['회고','PAFI','하루 마무리'],
 proposal:['일별 실행 제안','원페이지','내일 계획'],
 dashboard:['나의 궤도','갤럭시','현황'],
 voice:['아침 브리핑','음성 지시'],
 inbox:['승인','보류','알림','소식','검토함','결재','확인할 제안'],
 followup:['결정·위임 추적','위임','확인일','팔로업'],
 agent:['AI 에이전트','채팅','Hermes','대화 보관함','업무 지시','실행실'],
 aside:['ASIDE 실행','브라우저 업무'],
 tasks:['투두','할일'],
 goals:['나의 목표','도미노','퀘스트'],
 portfolio:['사업별 시간 배분','포트폴리오'],
 signals:['지표','수치'],
 meetings:['회의','미팅'],
 experiments:['실험'],
 contacts:['거래처','연락처','사람'],
 wiki:['위키','회의록','기록'],
 knowledge:['자료','지식'],
 understanding:['나를 이해하는 기록','기억'],
 monthly:['월간 개선 보고','월간'],
 learning:['예상 시간 보정'],
 automation:['예약 실행','ODA','크론'],
 sound:['사운드','집중 사운드','ORBIT Sound'],
 data:['휴지통','데이터'],
 backup:['복구','내보내기'],
};

export function areaOf(view:View):Area{return areas.find(a=>a.views.includes(view))??areas[0];}

export interface SearchEntry {view:View;label:string;area:string;keywords:readonly string[]}
export function searchEntries():SearchEntry[]{
 return areas.flatMap(a=>a.views.map(view=>({view,label:viewLabels[view],area:a.label,keywords:aliases[view]??[]})));
}
const normalize=(s:string)=>s.toLowerCase().replace(/\s+/g,'');
export function searchScreens(query:string):SearchEntry[]{
 const q=normalize(query);
 const entries=searchEntries();
 if(!q)return entries;
 return entries.filter(e=>[e.label,e.area,...e.keywords].some(word=>normalize(word).includes(q)));
}

export interface InboxInput {
 today:string;
 proposals:readonly {date:string;items:readonly {state:string}[]}[];
 aiPending:number|null;
 orders:readonly {status:string}[];
 decisions?:readonly {status:string;reviewDate:string}[];
 delegations?:readonly {status:string;checkDate:string}[];
}
export interface InboxCounts {plans:number;ai:number;orders:number;followups:number;total:number}

// Only decisions the owner must make. Notifications are derived from these same
// records, so they are never added (they would double count).
// 결재함 holds decisions only. An order waiting for execution approval is one; a finished order is
// not — its result arrives as a 소식 notice and is reviewed (or reworked) in 업무 진행.
export const orderNeedsDecision=(o:{status:string})=>o.status==='waiting_for_approval';
export function inboxCounts(input:InboxInput):InboxCounts{
 const plans=input.proposals.filter(p=>p.date>=input.today).reduce((n,p)=>n+p.items.filter(i=>i.state==='pending').length,0);
 const ai=Math.max(0,input.aiPending??0);
 const orders=input.orders.filter(orderNeedsDecision).length;
 const followups=(input.decisions??[]).filter(d=>d.status!=='closed'&&d.reviewDate<=input.today).length
  +(input.delegations??[]).filter(d=>!['verified','cancelled'].includes(d.status)&&d.checkDate<=input.today).length;
 return {plans,ai,orders,followups,total:plans+ai+orders+followups};
}
export const badgeText=(n:number)=>n<=0?'':n>99?'99+':String(n);
