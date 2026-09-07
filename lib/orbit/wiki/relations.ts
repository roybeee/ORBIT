import type {Note,WorkspaceData} from '../model.ts';
import {normalize} from '../classify.ts';
import type {GraphNode,GraphEdge} from '../graph.ts';
const generic=new Set(['회사','개인','인물','사업부','파트너사','일정','회의','회의록','프로젝트','출처인덱스','통합연표','인물네트워크']);
export function wikiMatches(text:string,notes:Note[]) {
 const haystack=normalize(text);
 return notes.filter(n=>n.kind==='wiki').filter(n=>[n.title,...n.wiki?.aliases??[]].some(raw=>{
  const term=normalize(raw.replace(/ 프로젝트$/,''));return term.length>=3&&!generic.has(term)&&haystack.includes(term);
 })).map(n=>n.id);
}
export function wikiLinks(note:Note,notes:Note[]) {
 const explicit=[...note.body.matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)].flatMap(m=>{
  const match=notes.find(n=>n.title.normalize('NFC')===m[1].trim().normalize('NFC')||n.wiki?.aliases.includes(m[1].trim()));return match?[match.id]:[];
 });
 return [...new Set([...(note.wiki?.links??[]),...explicit])].filter(id=>id!==note.id&&notes.some(n=>n.id===id));
}
export interface WikiConnection {id:string;kind:'note'|'event'|'task';title:string;date:string;reason:string;wikiId:string;revision?:number;source?:string}
export function wikiConnections(data:WorkspaceData):WikiConnection[] {
 const wiki=data.notes.filter(n=>n.kind==='wiki'),out:WikiConnection[]=[];
 for(const n of data.notes.filter(n=>n.kind!=='wiki')) {
  for(const id of [...new Set([...(n.wikiMentionIds??[]).filter(id=>wiki.some(w=>w.id===id)),...wikiMatches(`${n.title} ${n.summary} ${n.tags.join(' ')} ${n.body}`,wiki)])])
   out.push({id:n.id,kind:'note',title:n.title,date:n.source?.date??n.updated,reason:'내용의 이름·별칭 일치',wikiId:id,revision:n.revision,source:n.source?.provider??(n.kind==='meeting'?'회의록':'참고 자료')});
 }
 for(const e of data.events) for(const id of wikiMatches(e.title,wiki))out.push({id:e.id,kind:'event',title:e.title,date:e.date,reason:'일정 제목의 이름·별칭 일치',wikiId:id,source:e.id.startsWith('google:')?'Google Calendar':'Orbit 일정'});
 for(const t of data.tasks) for(const id of wikiMatches(`${t.title} ${t.definition}`,wiki))out.push({id:t.id,kind:'task',title:t.title,date:t.completedOn??t.due,reason:'할 일의 이름·별칭 일치',wikiId:id,source:t.status==='done'?'완료한 할 일':'진행할 할 일'});
 return out.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
}
export function wikiGraph(data:WorkspaceData,focus?:string) {
 const wiki=data.notes.filter(n=>n.kind==='wiki'),edges:GraphEdge[]=[];
 for(const n of wiki){if(n.wiki?.parentId)edges.push({a:'note:'+n.wiki.parentId,b:'note:'+n.id,kind:'member'});for(const id of wikiLinks(n,wiki))edges.push({a:'note:'+n.id,b:'note:'+id,kind:'note'});}
 const ids=new Set(focus?[focus]:wiki.map(n=>n.id));
 if(focus)for(const e of edges){if(e.a==='note:'+focus)ids.add(e.b.slice(5));if(e.b==='note:'+focus)ids.add(e.a.slice(5));}
 const shown=wiki.filter(n=>ids.has(n.id)).slice(0,140);
 const nodes:GraphNode[]=shown.map(n=>({id:'note:'+n.id,refId:n.id,kind:'note',label:n.title,r:n.id===focus?14:n.wiki?.parentId?6:12,color:n.wiki?.private?'#bd669f':n.wiki?.confidential?'#97713c':'#6255dc'}));
 if(focus)for(const c of wikiConnections(data).filter(c=>c.wikiId===focus).slice(0,40)){
  const id='source:'+c.kind+':'+c.id;
  nodes.push({id,refId:c.id,kind:c.kind==='task'?'task':'note',recordKind:c.kind,label:c.title,r:4,color:'#409688'});
  edges.push({a:'note:'+focus,b:id,kind:'keyword'});
 }
 const included=new Set(nodes.map(n=>n.id));return {nodes,edges:edges.filter(e=>included.has(e.a)&&included.has(e.b)),total:wiki.length};
}
