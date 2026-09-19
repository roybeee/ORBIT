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
