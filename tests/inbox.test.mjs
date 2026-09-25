import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

const root=fileURLToPath(new URL('..',import.meta.url));
const vite=await createServer({appType:'custom',configFile:false,root,resolve:{alias:{'@':root}},server:{middlewareMode:true}});
after(async()=>{await vite.close();});

const noop=()=>{};
const counts=(over={})=>({plans:0,ai:0,orders:0,followups:0,total:0,...over});
const action=(id,over={})=>({id,turnId:'turn-'+id,title:'제안 '+id,reason:'근거 '+id,expectedRevision:1,state:'pending',conversationId:'conv-'+id,createdAt:'2026-09-25T00:00:00Z',action:{type:'task.upsert',task:{id:'task-'+id,title:'할 일 '+id}},...over});

async function workspace(){
 const {emptyWorkspace}=await vite.ssrLoadModule('/lib/orbit/model.ts');
 const data=emptyWorkspace();
 data.tasks=[{id:'t-late',title:'LATE_TASK'},{id:'t-next',title:'NEXT_TASK'}].map(t=>({...t,projectId:'',status:'todo',duration:60}));
 data.notes=[{id:'note-1',title:'주간 회의록',kind:'meeting'}];
 data.proposals=[{id:'plan:2026-09-26',date:'2026-09-26',budget:0,energy:'normal',unscheduled:[],items:[
  {id:'i-late',taskId:'t-late',start:540,end:600,reason:'',state:'pending'},
  {id:'i-next',taskId:'t-next',start:900,end:960,reason:'오후에 둡니다',state:'pending'},
 ]}];
 return data;
}
async function render(props){
 const {InboxPanel}=await vite.ssrLoadModule('/components/orbit/inbox/inbox-panel.tsx');
 const {splitProposals}=await vite.ssrLoadModule('/lib/orbit/inbox-backlog.ts');
 const data=props.data??await workspace();
 const split=splitProposals(props.actions??[],data.notes,'2026-09-26');
 return renderToStaticMarkup(React.createElement(InboxPanel,{data,snapshot:{data},today:'2026-09-26',nowMinute:720,counts:counts(),orders:[],actions:[],split,aiLoading:false,news:null,busy:false,demo:false,perform:async()=>true,onProposal:noop,onOrder:noop,onFollowup:noop,onNews:noop,onOpenNote:noop,onOpenConversation:noop,onAskOrbit:noop,...props}));
}

test('a plan item whose start has passed cannot be approved and is routed to re-planning',async()=>{
 const html=await render({counts:counts({plans:2,total:2})});
 const late=html.slice(html.indexOf('LATE_TASK'),html.indexOf('NEXT_TASK'));
 assert.match(late,/대안 다시 계산/);
 assert.doesNotMatch(late,/>승인</);
 assert.match(html.slice(html.indexOf('NEXT_TASK')),/승인/);
});

test('Orbit proposals are decided in place and meeting cards are grouped under their meeting',async()=>{
 const actions=[
  action('m1',{guard:{meeting:{noteId:'note-1',revision:1},version:1,actionHash:'h',values:{}}}),
  action('m2',{guard:{meeting:{noteId:'note-1',revision:1},version:1,actionHash:'h',values:{}}}),
  action('c1'),
  action('done',{state:'approved'}),
  action('later',{state:'deferred'}),
 ];
 const html=await render({actions,counts:counts({ai:3,total:3})});
 assert.equal((html.match(/회의 결재 · 주간 회의록/g)??[]).length,1,'one group per meeting');
 assert.match(html,/2건/);
 assert.equal((html.match(/승인하고 반영/g)??[]).length,1,'a chat proposal keeps its full card');
 // Meeting cards are the meeting note's own cards, loaded from its review; the group adds the bulk bar.
 assert.match(html,/전체 선택/);assert.match(html,/선택 0건 승인/);assert.match(html,/선택하지 않은 2건 반려/);
 assert.match(html,/대화 열기/,'a chat proposal links back to its conversation');
 assert.doesNotMatch(html,/제안 done/,'decided cards leave the inbox');
 assert.doesNotMatch(html,/제안 later/,'deferred cards wait for their revisit date');
 assert.match(html,/보류한 Orbit 제안 1건/,'but they stay reachable');
});

test('empty categories are hidden and 소식 is read-only without a red count',async()=>{
 const news={unread:2,items:[{id:'n1',kind:'completed',title:'NEWS_ONE',body:'끝났습니다',href:'/',createdAt:'2026-09-26T00:00:00Z',readAt:null}]};
 const html=await render({counts:counts({plans:2,total:2}),news});
 assert.match(html,/계획<span>2<\/span>/);
 assert.doesNotMatch(html,/AI 제안<span>/);
 assert.match(html,/aria-label="소식"/);
 assert.match(html,/읽지 않음 2/);
 assert.match(html,/NEWS_ONE/);
});

test('with nothing to decide the inbox says so and still shows news',async()=>{
 const data=await workspace();data.proposals=[];
 const news={unread:0,items:[{id:'n1',kind:'info',title:'NEWS_TWO',body:'',href:'/',createdAt:'2026-09-26T00:00:00Z',readAt:'2026-09-26T01:00:00Z'}]};
 const html=await render({data,news});
 assert.match(html,/지금 정할 일이 없습니다/);
 assert.match(html,/NEWS_TWO/);
});

test('a deferred proposal offers reconsideration instead of approval',async()=>{
 const {ActionCard}=await vite.ssrLoadModule('/components/orbit/agent/action-review.tsx');
 const data=await workspace();
 const review={acting:null,decide:async()=>{},openDefer:noop,notice:()=>null,deferDialog:null};
 const html=renderToStaticMarkup(React.createElement(ActionCard,{item:action('d1',{state:'deferred',note:'자료 대기',revisitDate:'2026-09-30'}),snapshot:{data},review}));
 assert.match(html,/다시 검토하기/);
 assert.match(html,/2026-09-30 다시 검토 · 자료 대기/);
 assert.doesNotMatch(html,/승인하고 반영/);
});

test('the inbox chip shows a count for decisions and only a dot for unread news',async()=>{
 const {AreaSections}=await vite.ssrLoadModule('/components/orbit/shell/app-navigation.tsx');
 const chip=(inboxCount,newsUnread)=>renderToStaticMarkup(React.createElement(AreaSections,{view:'inbox',navigate:noop,inboxCount,newsUnread}));
 assert.match(chip(3,5),/class="nav-badge"[^>]*>3</);
 assert.doesNotMatch(chip(3,5),/nav-dot/);
 assert.match(chip(0,5),/class="nav-dot"/);
 assert.doesNotMatch(chip(0,0),/nav-(badge|dot)/);
});

test('old meeting proposals leave the badge and wait in a backlog that can be deferred in bulk',async()=>{
 const data=await workspace();
 data.notes=[{id:'old',title:'09-04 주간 회의',kind:'meeting',projectId:'',summary:'',body:'',tags:[],updated:'2026-09-24',source:{provider:'plaud',externalId:'old',date:'2026-09-04'}}];
 const old=over=>({guard:{meeting:{noteId:'old',revision:1},version:1,actionHash:'h',values:{}},createdAt:'2026-09-10T00:00:00Z',...over});
 const html=await render({data,actions:[action('o1',old()),action('o2',old()),action('new')],counts:counts({ai:1,total:1})});
 assert.match(html,/쌓인 회의 결재 <em>2<\/em>건/);
 assert.match(html,/09-04 주간 회의/);
 assert.match(html,/이 회의 보류/);
 assert.match(html,/전체 보류/);
 assert.equal((html.match(/승인하고 반영/g)??[]).length,1,'only the fresh proposal is laid out as a card; old ones stay folded');
});

test('while Orbit proposals load the inbox says so instead of showing a partial count as final',async()=>{
 const data=await workspace();data.proposals=[];
 const html=await render({data,aiLoading:true});
 assert.match(html,/Orbit 제안을 불러오는 중/);
 assert.match(html,/정할 일을 확인하는 중/);
 assert.doesNotMatch(html,/모두 처리됐습니다|지금 정할 일이 없습니다/,'nothing claims to be done before the proposals arrive');
 const partial=await render({aiLoading:true,counts:counts({plans:2,total:2})});
 assert.match(partial,/지금까지 <em>2<\/em>건/);
});


test('a meeting proposal without a due date offers "마감일 지정하고 승인", never a bare approve, and shows the due as undecided',async()=>{
 const {ActionCard}=await vite.ssrLoadModule('/components/orbit/agent/action-review.tsx');
 const data=await workspace();
 const review={acting:null,decide:noop,openDefer:noop,notice:()=>null};
 const undated=action('u',{guard:{meeting:{noteId:'note-1',revision:1,needsDue:true},version:1,actionHash:'h',values:{}},action:{type:'task.upsert',task:{id:'task-u',title:'라라 협업안',due:'2026-09-24',duration:30}}});
 const html=renderToStaticMarkup(React.createElement(ActionCard,{item:undated,snapshot:{data},review}));
 assert.doesNotMatch(html,/승인하고 반영/);
 assert.match(html,/마감일 지정하고 승인/);assert.match(html,/type="date"/);
 assert.match(html,/미정 · 승인 전 지정/);assert.doesNotMatch(html,/2026-09-24/,'the placeholder due is not shown as if decided');
 const dated=renderToStaticMarkup(React.createElement(ActionCard,{item:action('d'),snapshot:{data},review}));
 assert.match(dated,/승인하고 반영/);assert.doesNotMatch(dated,/마감일 지정하고 승인/);
});

test('only the first five meeting groups are laid out with cards; the rest open on demand',async()=>{
 const data=await workspace();
 data.notes=Array.from({length:7},(_,i)=>({id:'n'+i,title:'회의 '+i,kind:'meeting',projectId:'',summary:'',body:'',tags:[],updated:'2026-09-25'}));
 const meeting=(id,noteId)=>action(id,{guard:{meeting:{noteId,revision:1},version:1,actionHash:'h',values:{}}});
 const html=await render({data,actions:data.notes.map((n,i)=>meeting('c'+i,n.id)),counts:counts({ai:7,total:7})});
 assert.equal((html.match(/meeting-review-focus/g)??[]).length,5,'cards of the first five meetings');
 assert.equal((html.match(/회의 결재 · 회의/g)??[]).length,7,'every meeting still has its group');
 assert.match(html,/결재안 펼치기/);
});
