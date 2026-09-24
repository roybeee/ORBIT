import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {goalLadder} from '../lib/orbit/goal-ladder.ts';

const goal=(id,kind,over={})=>({id,kind,sentence:id.toUpperCase(),...over});
const project=(id,over={})=>({id,name:'P_'+id,status:'active',color:'#000',symbol:'O',goal:'',due:'2026-12-31',priority:3,...over});

test('the ladder follows the nearest short-term goal up to its dream',()=>{
 const data=emptyWorkspace();
 data.goals=[goal('life','life'),goal('mid-a','mid',{parentId:'life'}),goal('mid-b','mid'),goal('late','short',{parentId:'mid-b',deadline:'2026-12-01'}),goal('soon','short',{parentId:'mid-a',deadline:'2026-10-31'}),goal('past','short',{deadline:'2026-09-01'})];
 data.projects=[project('a',{goalId:'soon'}),project('b',{goalId:'mid-a'}),project('c',{goalId:'soon',status:'completed'}),project('d')];
 data.dominoProjectId='a';
 const ladder=goalLadder(data,'2026-09-26');
 assert.deepEqual([ladder.life?.id,ladder.mid?.id,ladder.short?.id],['life','mid-a','soon']);
 assert.equal(ladder.domino?.id,'a');
 assert.equal(ladder.linkedProjects,2,'active projects linked to the short or mid goal');
 assert.equal(ladder.empty,false);
});

test('paused and achieved goals are skipped and missing parents fall back by kind',()=>{
 const data=emptyWorkspace();
 data.goals=[goal('dream','life'),goal('old','mid',{status:'achieved'}),goal('mid','mid'),goal('s','short',{status:'paused'}),goal('s2','short')];
 const ladder=goalLadder(data,'2026-09-26');
 assert.deepEqual([ladder.life?.id,ladder.mid?.id,ladder.short?.id],['dream','mid','s2']);
 assert.equal(ladder.domino,undefined);
});

test('projects without a status are active, as everywhere else in ORBIT',()=>{
 const data=emptyWorkspace();
 data.goals=[goal('s','short')];
 const {status,...unset}=project('a',{goalId:'s'});
 data.projects=[unset];data.dominoProjectId='a';
 const ladder=goalLadder(data,'2026-09-26');
 assert.equal(ladder.domino?.id,'a');
 assert.equal(ladder.linkedProjects,1);
});

test('the ladder stays on the short goal\'s own chain when a level is skipped or paused',()=>{
 const data=emptyWorkspace();
 data.goals=[goal('L1','life'),goal('L2','life'),goal('M2','mid',{parentId:'L2'}),goal('Mp','mid',{parentId:'L1',status:'paused'}),goal('S','short',{parentId:'Mp'})];
 data.projects=[project('other',{goalId:'M2'})];
 const ladder=goalLadder(data,'2026-09-26');
 assert.equal(ladder.life?.id,'L1','the dream above the short goal, not another chain');
 assert.equal(ladder.mid,undefined,'no unrelated mid-term goal is borrowed');
 assert.equal(ladder.linkedProjects,0,'projects of another chain are not counted');
});

test('when every short goal is overdue the most recent deadline leads',()=>{
 const data=emptyWorkspace();
 data.goals=[goal('old','short',{deadline:'2026-06-30'}),goal('recent','short',{deadline:'2026-09-15'})];
 assert.equal(goalLadder(data,'2026-09-26').short?.id,'recent');
});

test('a workspace without goals asks to build the ladder',()=>{
 const ladder=goalLadder(emptyWorkspace(),'2026-09-26');
 assert.equal(ladder.empty,true);
 assert.equal(ladder.linkedProjects,0);
});

test('a finished domino project is not shown as the domino',()=>{
 const data=emptyWorkspace();
 data.goals=[goal('s','short')];data.projects=[project('x',{status:'completed'})];data.dominoProjectId='x';
 assert.equal(goalLadder(data,'2026-09-26').domino,undefined);
});

import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {after} from 'node:test';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const vite=await createServer({appType:'custom',configFile:false,root,resolve:{alias:{'@':root}},server:{middlewareMode:true}});
after(async()=>{await vite.close();});
const noop=()=>{};

test('the 프로젝트 tab opens with the ladder, or an invitation to build it',async()=>{
 const {GoalLadderStrip}=await vite.ssrLoadModule('/components/orbit/projects/goal-ladder-strip.tsx');
 const render=data=>renderToStaticMarkup(React.createElement(GoalLadderStrip,{data,today:'2026-09-26',onGoals:noop,onManage:noop,onProject:noop}));
 assert.match(render(emptyWorkspace()),/목표 사다리 만들기/);
 const data=emptyWorkspace();
 data.goals=[goal('life','life',{sentence:'DREAM'}),goal('mid','mid',{parentId:'life',sentence:'MIDTERM'}),goal('s','short',{parentId:'mid',sentence:'SHORT',deadline:'2026-10-31'})];
 data.projects=[project('a',{goalId:'s'})];data.dominoProjectId='a';
 const html=render(data);
 assert.match(html,/DREAM[\s\S]*MIDTERM[\s\S]*SHORT/,'dream, mid-term and short-term in order');
 assert.match(html,/2026\.10까지/);
 assert.match(html,/도미노 · P_a/);
 assert.match(html,/진행 중 프로젝트 1개/);
});

test('a project detail separates meetings and decisions from records and offers Orbit',async()=>{
 const {ProjectDetailPanel}=await vite.ssrLoadModule('/components/orbit/project-detail.tsx');
 const {CityThemeProvider}=await vite.ssrLoadModule('/components/orbit/city-themes.tsx');
 const data=emptyWorkspace();
 const p=project('a');data.projects=[p];
 const html=renderToStaticMarkup(React.createElement(CityThemeProvider,{preferences:data.preferences,view:'projects',title:'프로젝트',busy:false,perform:async()=>true,demo:true},React.createElement(ProjectDetailPanel,{project:p,data,today:'2026-09-26',busy:false,perform:async()=>true,onOpen:noop,onCreate:noop,onEdit:noop,onDelete:noop,onChat:noop,onManage:noop,onEditing:noop,followup:React.createElement('div',null,'FOLLOWUP')})));
 const tabs=[...html.matchAll(/role="tab"[^>]*>([^<]+)/g)].map(m=>m[1].trim());
 assert.deepEqual(tabs.map(t=>t.replace(/\s*\d+$/,'')),['할 일','회의·결정','기록','개요·관리']);
 assert.match(html,/Orbit과 대화/);
 assert.doesNotMatch(html,/대화 열기/,'the conversation button moved to the top bar');
});
