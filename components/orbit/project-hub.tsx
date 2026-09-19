'use client';
import {useMemo,useState} from 'react';
import {Search,Plus,ChevronRight,MessageSquare,Flag,Clock3,CheckCheck,FolderKanban} from 'lucide-react';
import type {Project,ProjectStatus,WorkspaceData} from '@/lib/orbit/model';
import {projectSummary,projectStatus,projectStatusLabel,priorityLabel} from '@/lib/orbit/project-management';
import {Progress} from '@/components/ui/progress';

type Filter='all'|ProjectStatus|'attention';
export function ProjectHub({data,today,busy,onOpen,onCreateTask,onCreateProject,onChat}:{data:WorkspaceData;today:string;busy:boolean;onOpen:(id:string)=>void;onCreateTask:(id:string)=>void;onCreateProject:()=>void;onChat:(id:string)=>void}){
  const [query,setQuery]=useState(''),[filter,setFilter]=useState<Filter>('all'),[sort,setSort]=useState('attention');
  const items=useMemo(()=>data.projects.map(project=>({project,summary:projectSummary(data,project,today)})),[data,today]);
  const active=items.filter(i=>projectStatus(i.project)==='active').length;
  const attention=items.filter(i=>i.summary.attention).length;
  const visible=items.filter(({project,summary})=>(filter==='all'||filter==='attention'?filter!=='attention'||summary.attention:projectStatus(project)===filter)&&
    `${project.name} ${project.goal} ${(project.keywords??[]).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a,b)=>Number(projectStatus(a.project)==='completed')-Number(projectStatus(b.project)==='completed')||
      (sort==='name'?a.project.name.localeCompare(b.project.name,'ko'):sort==='priority'?b.project.priority-a.project.priority:sort==='due'?a.project.due.localeCompare(b.project.due):Number(b.summary.attention)-Number(a.summary.attention)||b.project.priority-a.project.priority)||a.project.due.localeCompare(b.project.due)||a.project.id.localeCompare(b.project.id));
  const filters:[Filter,string][]=[['all','전체'],['active','진행'],['planned','준비'],['paused','보류'],['completed','완료'],['attention','확인 필요']];
  return <section className="project-hub" aria-label="프로젝트 관리">
    <div className="project-overview-counts">
      <button aria-pressed={filter==='active'} onClick={()=>setFilter('active')}><FolderKanban size={17}/><span>진행 중</span><strong>{active}</strong></button>
      <button aria-pressed={filter==='attention'} onClick={()=>setFilter('attention')} className={attention?'needs-attention':''}><Flag size={17}/><span>확인 필요</span><strong>{attention}</strong></button>
      <button aria-pressed={filter==='completed'} onClick={()=>setFilter('completed')}><CheckCheck size={17}/><span>완료</span><strong>{items.filter(i=>projectStatus(i.project)==='completed').length}</strong></button>
    </div>
    <div className="project-search-row"><label className="project-search"><Search size={17}/><input aria-label="프로젝트 검색" placeholder="프로젝트 검색" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="프로젝트 정렬" value={sort} onChange={e=>setSort(e.target.value)}><option value="attention">확인 필요순</option><option value="due">마감순</option><option value="priority">우선순위순</option><option value="name">이름순</option></select></div>
    <div className="project-filter-row" aria-label="프로젝트 상태 필터">{filters.map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}<span>{value==='all'?items.length:value==='attention'?attention:items.filter(i=>projectStatus(i.project)===value).length}</span></button>)}</div>
    <div className="project-hub-list">{visible.map(({project:p,summary:s})=>{
      const state=projectStatus(p);
      return <article className={`project-hub-card project-state-${state}`} key={p.id} style={{borderLeftColor:p.color}}>
        <div className="project-card-top"><span className={`project-state-label state-${state}`}>{projectStatusLabel[state]}</span>{p.priority>=4&&<span className="project-priority"><Flag size={12}/>{priorityLabel(p.priority)}</span>}<span className={`project-due ${s.dueOver?'overdue':''}`}><Clock3 size={13}/>{p.due.slice(5).replace('-','/')} {s.dueOver?'기한 지남':'목표'}</span></div>
        <button className="project-hub-title" onClick={()=>onOpen(p.id)}><h2>{p.name}</h2><ChevronRight size={20}/></button>
        <p className="project-hub-outcome">{p.goal||'완료 기준을 정해 주세요.'}</p>
        {s.progress!==null?<div className="project-card-progress"><Progress value={s.progress} aria-label={`${p.name} 할 일 ${s.done}/${s.tasks.length} 완료`}/><span>{s.done}/{s.tasks.length} 완료</span></div>:<span className="project-no-tasks">할 일 미등록</span>}
        {state==='completed'?<p className="project-next-action completed-result"><CheckCheck size={15}/><span>{p.result||'완료 결과 확인'}</span></p>:s.next?<button className="project-next-action" onClick={()=>onOpen(p.id)}><span className="project-next-label">다음</span><span>{s.next.title}</span></button>:state==='active'?<button className="project-next-action" disabled={busy} onClick={()=>s.tasks.length?onOpen(p.id):onCreateTask(p.id)}>{s.tasks.length?<><Flag size={15}/><span>{s.open.length?s.waiting.length?`대기 ${s.waiting.length}건 · 막힌 조건 확인`:'실행 조건을 확인해 주세요':'할 일 완료 · 최종 결과를 확인해 주세요'}</span></>:<><Plus size={16}/><span>첫 할 일 추가</span></>}</button>:<p className="project-next-action muted">{state==='paused'?'보류 중 · 진행으로 바꾸면 계획에 포함됩니다.':'준비 중 · 목표와 실행 단계를 정해 보세요.'}</p>}
        <div className="project-card-bottom"><span>{s.milestones.length?`단계 ${s.milestones.filter(m=>m.done).length}/${s.milestones.length} · `:''}기록 {s.notes.length}{s.waiting.length?` · 대기 ${s.waiting.length}`:''}</span><div><button aria-label={`${p.name}에 할 일 추가`} disabled={busy} onClick={()=>onCreateTask(p.id)}><Plus size={17}/></button><button aria-label={`${p.name} 대화 열기`} onClick={()=>onChat(p.id)}><MessageSquare size={17}/></button></div></div>
      </article>;
    })}</div>
    {!visible.length&&<div className="project-hub-empty"><FolderKanban size={30}/><h2>{items.length?'조건에 맞는 프로젝트가 없어요':'첫 프로젝트를 만들어 보세요'}</h2><p>{items.length?'검색어나 상태 필터를 바꿔 보세요.':'만들어야 할 결과를 정하고, 단계별 할 일을 연결하세요.'}</p><button className="secondary-button" disabled={busy} onClick={()=>items.length?(setQuery(''),setFilter('all')):onCreateProject()}>{items.length?'전체 보기':'프로젝트 추가'}</button></div>}
  </section>;
}
