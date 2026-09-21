import type {WorkspaceData} from '../model.ts';
import {automaticProject,suggestProject} from '../classify.ts';

// Focus only when a project is unambiguous. Broad reviews retain the full catalog;
// workspace_search/read_note remain available for everything outside this view.
export function chatContextData(data:WorkspaceData,query:string,selectedProject?:string|null){
 if(/전체|모든|전반|프로젝트들|비교|우선순위|회고|하루|일주일|주간|월간/.test(query))return data;
 const lower=query.toLowerCase();
 const named=data.projects.filter(p=>p.name.trim().length>=2&&lower.includes(p.name.toLowerCase()));
 const match=automaticProject(query,data.projects);
 const ambiguous=suggestProject(query,data.projects).filter(p=>p.confidence==='high').length>1&&!match;
 const focused=ambiguous?null:match?.projectId??(named.length===1?named[0].id:named.length===0?selectedProject:null);
 if(!focused||!data.projects.some(p=>p.id===focused))return data;
 const tasks=data.tasks.filter(t=>t.projectId===focused),ids=new Set(tasks.flatMap(t=>t.dependsOn??[]));
 return {...data,projects:data.projects.filter(p=>p.id===focused),tasks:[...tasks,...data.tasks.filter(t=>ids.has(t.id)&&t.projectId!==focused)],notes:data.notes.filter(n=>n.projectId===focused)};
}
