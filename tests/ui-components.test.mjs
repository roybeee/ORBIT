import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

after(async () => {
  await vite.close();
});

async function readCssTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return readCssTree(entryPath);
      }
      return entry.name.endsWith(".css") ? readFile(entryPath, "utf8") : "";
    }),
  );
  return contents.join("\n");
}

test("emits the catalog's animation and scrolling utilities", async () => {
  const css = await readCssTree(path.join(root, "dist"));

  assert.match(css, /--tw-enter-opacity/);
  assert.match(css, /scrollbar-width:\s*thin/);
  assert.match(css, /scrollbar-width:\s*none/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.match(css, /scroll-fade-reveal-b/);
  assert.match(css, /mask-image:/);
  assert.match(css, /tw-shimmer/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("forwards progress semantics to the primitive", async () => {
  const { Progress } = await vite.ssrLoadModule("/components/ui/progress.tsx");
  const html = renderToStaticMarkup(React.createElement(Progress, { value: 37 }));

  assert.match(html, /aria-valuenow="37"/);
  assert.match(html, /aria-valuetext="37%"/);
  assert.match(html, /data-state="loading"/);
});

test("emits chart themes for the starter's media dark mode", async () => {
  const { ChartStyle } = await vite.ssrLoadModule("/components/ui/chart.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ChartStyle, {
      id: "contract",
      config: {
        latency: { theme: { light: "#ffffff", dark: "#000000" } },
      },
    }),
  );

  assert.match(html, /\[data-chart=contract\]/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.doesNotMatch(html, /\.dark/);
});

test("renders sidebar skeletons deterministically", async () => {
  const { SidebarMenuSkeleton } = await vite.ssrLoadModule(
    "/components/ui/sidebar.tsx",
  );
  const first = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));
  const second = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));

  assert.equal(first, second);
  assert.match(first, /--skeleton-width:70%/);
});

test('new workbench screens render stored records and honest empty states',async()=>{
 const {emptyWorkspace}=await vite.ssrLoadModule('/lib/orbit/model.ts');
 const {ExperimentsPanel,ContactsPanel,MonthlyPanel}=await vite.ssrLoadModule('/components/orbit/phase4/workbench.tsx');
 const {VoicePanel}=await vite.ssrLoadModule('/components/orbit/phase4/voice.tsx');
 const data=emptyWorkspace(),props={data,today:'2026-09-17',busy:false,perform:async()=>true,onOpen:()=>{},onAsk:()=>{}};
 for(const Panel of [ExperimentsPanel,ContactsPanel,MonthlyPanel,VoicePanel])assert.ok(renderToStaticMarkup(React.createElement(Panel,props)).length>100);
 const speech=renderToStaticMarkup(React.createElement(VoicePanel,props));assert.match(speech,/승인한 실행 계획은 아직 없습니다/);assert.match(speech,/disabled/);
 data.contacts=[{id:'c',name:'검토 담당자',organization:'사업',role:'책임자',aliases:[],projectIds:[],noteIds:[],decisionIds:[],delegationIds:[],eventIds:[],memo:'확인할 맥락',updatedAt:'2026-09-17T00:00:00Z'}];assert.match(renderToStaticMarkup(React.createElement(ContactsPanel,props)),/확인할 맥락/);
});

test('historical note view never flashes the latest body while loading its recorded revision',async()=>{
 const {NoteDetail}=await vite.ssrLoadModule('/components/orbit/note-detail.tsx');
 const html=renderToStaticMarkup(React.createElement(NoteDetail,{requestedRevision:1,meta:{id:'n',revision:2,bodyStored:false,title:'최신',body:'LATEST_BODY_MUST_NOT_APPEAR',kind:'wiki',updated:'2026-09-17',tags:[]},notes:[],tasks:[],demo:false,busy:false,defaultDue:'2026-09-17'}));
 assert.doesNotMatch(html,/LATEST_BODY_MUST_NOT_APPEAR/);assert.match(html,/불러오는 중/);
});

test('project management opens on active projects and home never displays completed project cards',async()=>{
 const {emptyWorkspace}=await vite.ssrLoadModule('/lib/orbit/model.ts');
 const {ProjectHub}=await vite.ssrLoadModule('/components/orbit/project-hub.tsx');
 const {TodayHome}=await vite.ssrLoadModule('/components/orbit/today-home.tsx');
 const {PersonalGalaxy}=await vite.ssrLoadModule('/components/orbit/personal-galaxy.tsx');
 const data=emptyWorkspace(),noop=()=>{},now=new Date('2026-09-19T01:00:00Z');
 data.projects=['active','completed','planned','paused'].map(status=>({id:status,name:`PROJECT_${status.toUpperCase()}`,status,color:'#7451dc',symbol:'O',goal:'검토한 결과 전달',due:'2026-09-30',priority:3}));
 const props={data,today:'2026-09-19',now,busy:false,demo:true,pendingAI:0,onOpen:noop,navigate:noop,perform:async()=>true,onOpenTask:noop,onCreateTask:noop,onCreateProject:noop,onManage:noop,onTrash:noop};
 for(const Component of [ProjectHub,TodayHome,PersonalGalaxy]){
  const html=renderToStaticMarkup(React.createElement(Component,props));
  assert.match(html,/PROJECT_ACTIVE/);
  assert.doesNotMatch(html,/PROJECT_(COMPLETED|PLANNED|PAUSED)/);
  if(Component===ProjectHub){assert.match(html,/role="tab"[^>]*aria-selected="true"[^>]*[\s\S]*?진행 중/);assert.match(html,/완료 <span>1<\/span>/);}
 }
 data.projects=data.projects.filter(p=>p.status!=='active');
 for(const Component of [ProjectHub,TodayHome,PersonalGalaxy]){
  const html=renderToStaticMarkup(React.createElement(Component,props));
  assert.match(html,/진행 중인 프로젝트가 없어요/);
  assert.doesNotMatch(html,/PROJECT_(COMPLETED|PLANNED|PAUSED)/);
 }
});

test('the home strip renders deterministically in demo/SSR',async()=>{
 const {emptyWorkspace}=await vite.ssrLoadModule('/lib/orbit/model.ts');
 const {TodayHome}=await vite.ssrLoadModule('/components/orbit/today-home.tsx');
 const data=emptyWorkspace(),noop=()=>{},now=new Date('2026-09-19T01:00:00Z');
 const props={data,today:'2026-09-19',now,busy:false,demo:true,pendingAI:0,onOpen:noop,navigate:noop,perform:async()=>true,onOpenTask:noop,onCreateTask:noop,onCreateProject:noop,onManage:noop,onTrash:noop};
 const html=renderToStaticMarkup(React.createElement(TodayHome,props));
 assert.match(html,/자료 수집/);assert.match(html,/계획 분석/);assert.match(html,/계획 준비 완료/);assert.match(html,/role="status"/);assert.match(html,/반영 기준 시각/);assert.match(html,/체험 화면/);
 assert.doesNotMatch(html,/undefined/);assert.doesNotMatch(html,/상태 확인 중/);
 assert.equal(html,renderToStaticMarkup(React.createElement(TodayHome,props)));
});

test('planSteps and localStamp are pure and deterministic',async()=>{
 const {planSteps,localStamp,formatAt,MORNING_HOUR}=await vite.ssrLoadModule('/lib/orbit/brief/status-model.ts');
 assert.equal(MORNING_HOUR,7);
 assert.equal(localStamp('2026-09-21T21:30:00Z','Asia/Seoul'),'2026-09-22T06:30');assert.equal(localStamp('2026-09-21T23:30:00Z','Asia/Seoul'),'2026-09-22T08:30');
 assert.ok(localStamp('2026-09-21T21:30:00Z','Asia/Seoul')<`2026-09-22T0${MORNING_HOUR}:00`);assert.equal(formatAt(null,'Asia/Seoul'),'—');assert.equal(formatAt('nope','Asia/Seoul'),'—');
 const demo=planSteps(null,true,'Asia/Seoul');assert.deepEqual(demo.map(s=>s.state),['idle','idle','idle']);assert.match(demo[0].summary,/체험 화면/);
 const pending=planSteps(null,false,'Asia/Seoul');assert.deepEqual(pending.map(s=>s.summary),['상태 확인 중','상태 확인 중','상태 확인 중']);
 const metrics={version:'v',inline:false,leaves:10,reused:8,analyzed:2,merges:2,mergeReused:1,posts:3,changes:{added:1,modified:0,deleted:0,keys:[]}};
 const status={now:'2026-09-22T02:40:00.000Z',target:{date:'2026-09-22',timeZone:'Asia/Seoul',eveningHour:21,afterEvening:false},
  collection:{state:'ok',lastProgressAt:'2026-09-22T02:39:10.000Z',sources:[],pending:{plaudQueue:0,plaudFailed:0,plaudImports:0,activityPending:0,activityQuarantined:0,meetingReviews:0,mail:0,total:0}},
  analysis:{state:'completed',turnId:'t',startedAt:'2026-09-21T17:01:00.000Z',lastProgressAt:'2026-09-21T17:20:00.000Z',progress:'',error:'',basisAt:'2026-09-21T17:01:05.000Z',sourceRevision:8,metrics},
  plan:{state:'ready',date:'2026-09-22',readyAt:'2026-09-21T17:20:00.000Z',basisAt:'2026-09-21T17:01:05.000Z',cutoff:'2026-09-21',sourceRevision:8,currentRevision:9,durationMs:1140000,metrics,unconfirmed:{workspaceRevisions:0,noteRevisions:0,conversations:0,collection:0,total:0}},history:[]};
 const ready=planSteps(status,false,'Asia/Seoul');assert.deepEqual(ready.map(s=>s.state),['done','done','done']);
 assert.equal(ready[0].summary,'수집 완료');assert.match(ready[1].summary,/^분석 완료 /);assert.equal(ready[1].detail,'재사용 9/12 · Hermes 3회');assert.match(ready[2].summary,/^오늘 계획 준비됨 · /);assert.match(ready[2].detail,/^반영 기준 시각 .* · 2026-09-21까지 기록$/);
 const stale=planSteps({...status,collection:{...status.collection,state:'partial',pending:{...status.collection.pending,plaudQueue:2,activityQuarantined:42,total:44}},plan:{...status.plan,state:'stale',unconfirmed:{workspaceRevisions:1,noteRevisions:0,conversations:0,collection:44,total:45}}},false,'Asia/Seoul');
 assert.equal(stale[0].state,'active');assert.equal(stale[0].summary,'수집 중 · 미확인 자료 44건');assert.match(stale[0].detail,/ · 회의록 2 · 대화 42$/);assert.doesNotMatch(stale[0].detail,/검토 대기|메일/);
 assert.equal(stale[2].state,'stale');assert.equal(stale[2].summary,'오늘 계획 준비됨 · 이후 변경 1건');
 const tomorrow=planSteps({...status,target:{...status.target,date:'2026-09-23',afterEvening:true},analysis:{...status.analysis,state:'idle',metrics:null},plan:{...status.plan,state:'none',basisAt:null,cutoff:null}},false,'Asia/Seoul');
 assert.equal(tomorrow[1].summary,'대기 중');assert.equal(tomorrow[1].detail,'21시 자동 준비');assert.equal(tomorrow[2].summary,'내일 계획 준비 전');assert.equal(tomorrow[2].detail,'반영 기준 시각 —');
 assert.deepEqual(planSteps(status,false,'Asia/Seoul'),ready);
});
