'use client';
import {useMemo,useState} from 'react';
import {Search,Plus,ChevronRight,Flag,Clock3,CheckCheck,FolderKanban,MoreHorizontal,Target} from 'lucide-react';
import type {ProjectStatus,WorkspaceData} from '@/lib/orbit/model';
import {projectSummary,projectStatus,projectStatusLabel} from '@/lib/orbit/project-management';
import {Progress} from '@/components/ui/progress';
import {useProjectPress} from './use-project-press';
import type {ProjectIntent} from './project-actions';
type Filter='all'|ProjectStatus|'attention';
type Props={data:WorkspaceData;today:string;busy:boolean;onOpen:(id:string,intent?:ProjectIntent)=>void;onOpenTask:(id:string)=>void;onCreateTask:(id:string)=>void;onCreateProject:()=>void;onManage:(id:string)=>void;onTrash:()=>void};
export function ProjectHub({data,today,busy,onOpen,onOpenTask,onCreateTask,onCreateProject,onManage,onTrash}:Props){
  const [query,setQuery]=useState(''),[filter,setFilter]=useState<Filter>('all'),[sort,setSort]=useState('attention');
  const {root,holding}=useProjectPress({disabled:busy,onManage});
  const items=useMemo(()=>data.projects.map(project=>({project,summary:projectSummary(data,project,today)})),[data,today]);
  const attention=items.filter(i=>i.summary.attention).length;
  const visible=items.filter(({project,summary})=>(filter==='all'||filter==='attention'?filter!=='attention'||summary.attention:projectStatus(project)===filter)&&`${project.name} ${project.goal} ${(project.keywords??[]).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a,b)=>Number(projectStatus(a.project)==='completed')-Number(projectStatus(b.project)==='completed')||(sort==='name'?a.project.name.localeCompare(b.project.name,'ko'):sort==='priority'?b.project.priority-a.project.priority:sort==='due'?a.project.due.localeCompare(b.project.due):Number(b.summary.attention)-Number(a.summary.attention)||b.project.priority-a.project.priority)||a.project.due.localeCompare(b.project.due)||a.project.id.localeCompare(b.project.id));
  const filters:[Filter,string][]=[['all','전체'],['active','진행'],['planned','준비'],['paused','보류'],['completed','완료'],['attention','확인 필요']];
  return <section className="project-hub project-hub-compact" aria-label="프로젝트 관리">
    <div className="project-hub-toolbar"><label className="project-search"><Search size={18}/><input aria-label="프로젝트 검색" placeholder="프로젝트 검색" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="프로젝트 상태 필터" value={filter} onChange={e=>setFilter(e.target.value as Filter)}>{filters.map(([value,label])=><option key={value} value={value}>{label} {value==='all'?items.length:value==='attention'?attention:items.filter(i=>projectStatus(i.project)===value).length}</option>)}</select></div>
    <div className="project-list-caption"><span>프로젝트 <strong>{visible.length}</strong></span><div><select aria-label="프로젝트 정렬" value={sort} onChange={e=>setSort(e.target.value)}><option value="attention">확인 필요순</option><option value="due">마감순</option><option value="priority">우선순위순</option><option value="name">이름순</option></select><button className="text-button" onClick={onTrash}>휴지통</button></div></div>
    <div ref={root} className="project-hub-list">{visible.map(({project:p,summary:s})=>{
      const state=projectStatus(p),allDone=s.tasks.length>0&&!s.open.length;
      let action=()=>onOpen(p.id,'tasks'),label='',Icon=Target;
      if(state==='completed'){label='완료 결과 보기';Icon=CheckCheck;action=()=>onOpen(p.id)}
      else if(state!=='active'){label=state==='paused'?'보류 중 · 다시 진행하기':'준비 중 · 진행 시작하기';action=()=>onOpen(p.id,'resume')}
      else if(s.next){label=s.next.title;action=()=>onOpenTask(s.next!.id)}
      else if(!s.tasks.length){label='첫 할 일 추가';Icon=Plus;action=()=>onCreateTask(p.id)}
      else if(allDone){label='할 일 완료 · 최종 결과 기록';Icon=CheckCheck;action=()=>onOpen(p.id,'complete')}
      else {label=s.waiting.length?`대기 ${s.waiting.length}건 · 막힌 조건 확인`:'실행 조건 확인';Icon=Flag}
      return <article data-project-card={p.id} className={`project-hub-card project-state-${state} ${holding===p.id?'is-held':''}`} key={p.id} style={{borderLeftColor:p.color}} aria-label={`${p.name} 프로젝트`}>
        <div className="project-card-heading"><div><span className={`project-state-label state-${state}`}>{projectStatusLabel[state]}</span><button data-project-title className="project-hub-title" disabled={busy} onClick={()=>onOpen(p.id)}><h2>{p.name}</h2></button></div><button className="project-card-more" disabled={busy} aria-label={`${p.name} 관리 메뉴`} aria-haspopup="dialog" onClick={()=>onManage(p.id)}><MoreHorizontal size={22}/></button></div>
        <div className="project-card-facts"><button disabled={busy} className={`project-due ${s.dueOver?'overdue':''}`} onClick={()=>onOpen(p.id,'settings')}><Clock3 size={14}/>{p.due.slice(5).replace('-','/')} {s.dueOver?'기한 지남':'목표'}</button>{data.dominoProjectId===p.id&&<span><Target size={13}/>핵심 프로젝트</span>}<span>{s.tasks.length?`할 일 ${s.done}/${s.tasks.length}`:'할 일 없음'}{s.notes.length?` · 기록 ${s.notes.length}`:''}</span></div>
        {s.progress!==null&&<div className="project-card-progress"><Progress value={s.progress} aria-label={`${p.name} 할 일 ${s.done}/${s.tasks.length} 완료`}/><span>{s.progress}%</span></div>}
        <button className="project-next-action" disabled={busy} onClick={action}><Icon size={17}/><span>{s.next&&state==='active'&&<small>다음 할 일</small>}{label}</span><ChevronRight size={17}/></button>
      </article>;
    })}</div>
    {!!visible.length&&<p className="project-press-hint">길게 누르거나 ⋯ 버튼을 누르면 수정·삭제할 수 있습니다.</p>}
    {!visible.length&&<div className="project-hub-empty"><FolderKanban size={30}/><h2>{items.length?'조건에 맞는 프로젝트가 없어요':'첫 프로젝트를 만들어 보세요'}</h2><p>{items.length?'검색어나 상태 필터를 바꿔 보세요.':'만들어야 할 결과를 정하고 첫 할 일을 추가하세요.'}</p><button className="secondary-button" disabled={busy} onClick={()=>items.length?(setQuery(''),setFilter('all')):onCreateProject()}>{items.length?'전체 보기':'프로젝트 추가'}</button></div>}
  </section>;
}
