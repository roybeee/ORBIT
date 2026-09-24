import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

const root=fileURLToPath(new URL('..',import.meta.url));
const vite=await createServer({appType:'custom',configFile:false,root,resolve:{alias:{'@':root}},server:{middlewareMode:true}});
after(async()=>{await vite.close();});
const noop=()=>{};

async function dock(mode){
 const {OrbitDock}=await vite.ssrLoadModule('/components/orbit/shell/orbit-dock.tsx');
 return renderToStaticMarkup(React.createElement(OrbitDock,{mode,context:'프로젝트 · 맵달',onAttachContext:noop,onClose:noop,onExpand:noop},React.createElement('div',{id:'chat-instance'},'CHAT')));
}

test('the dock shows the chat beside the current screen with its context and a way out',async()=>{
 const html=await dock('dock');
 assert.match(html,/class="orbit-dock is-dock"/);
 assert.match(html,/맥락: 프로젝트 · 맵달/);
 assert.match(html,/aria-label="대화 전체 화면으로 열기"/);
 assert.match(html,/aria-label="Orbit 닫기"/);
 assert.match(html,/id="chat-instance"/);
});

test('the same chat element stays mounted as a page or hidden, without the dock chrome',async()=>{
 const page=await dock('page'),hidden=await dock('hidden');
 for(const html of [page,hidden]){
  assert.match(html,/id="chat-instance"/,'the chat is never unmounted');
  assert.doesNotMatch(html,/orbit-dock-head|orbit-dock-scrim/);
 }
 assert.match(hidden,/<div class="orbit-dock is-hidden" hidden=""/);
 assert.doesNotMatch(page,/hidden=""/);
});

test('the workspace keeps one chat instance and asks Orbit without leaving the screen',async()=>{
 const source=await readFile(new URL('../components/orbit/workspace.tsx',import.meta.url),'utf8');
 assert.equal((source.match(/<AgentWorkspace\b/g)??[]).length,1,'exactly one chat instance');
 assert.match(source,/<OrbitDock[\s\S]*?<AgentWorkspace[\s\S]*?<\/OrbitDock>/);
 assert.doesNotMatch(source,/navigate\('agent'\);window\.dispatchEvent\(new CustomEvent\('orbit:compose'/,'asking Orbit opens the dock instead of the 대화 page');
 assert.ok((source.match(/askOrbit\(text\)/g)??[]).length>=12);
});
