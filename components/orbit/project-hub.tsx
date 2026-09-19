'use client';
import {useMemo,useState} from 'react';
import {Search,Plus,ChevronRight,Flag,Clock3,CheckCheck,FolderKanban,MoreHorizontal,Target} from 'lucide-react';
import type {ProjectStatus,WorkspaceData} from '@/lib/orbit/model';
import {projectSummary,projectStatus,projectStatusLabel,projectBuckets,type ProjectBucket} from '@/lib/orbit/project-management';
import {Progress} from '@/components/ui/progress';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {useProjectPress} from './use-project-press';
import type {ProjectIntent} from './project-actions';
type Filter='all'|ProjectStatus|'attention';
type Props={data:WorkspaceData;today:string;busy:boolean;onOpen:(id:string,intent?:ProjectIntent)=>void;onOpenTask:(id:string)=>void;onCreateTask:(id:string)=>void;onCreateProject:()=>void;onManage:(id:string)=>void;onTrash:()=>void};
export function ProjectHub({data,today,busy,onOpen,onOpenTask,onCreateTask,onCreateProject,onManage,onTrash}:Props){
  const [query,setQuery]=useState(''),[bucket,setBucket]=useState<ProjectBucket>('active'),[filter,setFilter]=useState<Filter>('all'),[sort,setSort]=useState('attention');
  const {root,holding}=useProjectPress({disabled:busy,onManage});
  const items=useMemo(()=>data.projects.map(project=>({project,summary:projectSummary(data,project,today)})),[data,today]);
  const groups=useMemo(()=>projectBuckets(data.projects),[data.projects]);
  const bucketIds=new Set(groups[bucket].map(p=>p.id));
  const attention=items.filter(i=>i.summary.attention).length;
  const visible=items.filter(({project,summary})=>bucketIds.has(project.id)&&(filter==='all'||filter==='attention'?filter!=='attention'||summary.attention:projectStatus(project)===filter)&&`${project.name} ${project.goal} ${(project.keywords??[]).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a,b)=>(sort==='name'?a.project.name.localeCompare(b.project.name,'ko'):sort==='priority'?b.project.priority-a.project.priority:sort==='due'?a.project.due.localeCompare(b.project.due):bucket==='completed'?(b.project.completedOn??'').localeCompare(a.project.completedOn??''):Number(b.summary.attention)-Number(a.summary.attention)||b.project.priority-a.project.priority)||a.project.due.localeCompare(b.project.due)||a.project.id.localeCompare(b.project.id));
  const filters:[Filter,string][]=bucket==='pending'?[['all','전체'],['planned','준비'],['paused','보류']]:[['all','전체'],['attention','확인 필요']];
  const bucketLabel=bucket==='active'?'진행 중인 프로젝트':bucket==='completed'?'완료된 프로젝트':'준비·보류 프로젝트';
  const narrowed=!!query.trim()||filter!=='all';
  return <section className="project-hub project-hub-compact" aria-label="프로젝트 관리">
    <Tabs className="project-status-tabs" value={bucket} onValueChange={value=>{setBucket(value as ProjectBucket);setFilter('all')}}>
      <TabsList aria-label="프로젝트 진행 상태">
        <TabsTrigger value="active">진행 중 <span>{groups.active.length}</span></TabsTrigger>
        <TabsTrigger value="completed">완료 <span>{groups.completed.length}</span></TabsTrigger>
        <TabsTrigger value="pending">준비·보류 <span>{groups.pending.length}</span></TabsTrigger>
      </TabsList>
      <TabsContent value={bucket}>
    <div className="project-hub-toolbar"><label className="project-search"><Search size={18}/><input aria-label="프로젝트 검색" placeholder={`${bucketLabel} 검색`} value={query} onChange={e=>setQuery(e.target.value)}/></label>{bucket!=='completed'&&<select aria-label="프로젝트 상태 필터" value={filter} onChange={e=>setFilter(e.target.value as Filter)}>{filters.map(([value,label])=><option key={value} value={value}>{label} {value==='all'?groups[bucket].length:value==='attention'?attention:items.filter(i=>projectStatus(i.project)===value).length}</option>)}</select>}</div>
    <div className="project-list-caption"><span>{bucketLabel} <strong>{visible.length}</strong></span><div><select aria-label="프로젝트 정렬" value={sort} onChange={e=>setSort(e.target.value)}><option value="attention">{bucket==='completed'?'최근 완료순':'확인 필요순'}</option><option value="due">마감순</option><option value="priority">우선순위순</option><option value="name">이름순</option></select><button className="text-button" onClick={onTrash}>휴지통</button></div></div>
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
    {!visible.length&&<div className="project-hub-empty"><FolderKanban size={30}/><h2>{narrowed?'조건에 맞는 프로젝트가 없어요':`${bucketLabel}가 없어요`}</h2><p>{narrowed?'검색어나 필터를 바꿔 보세요.':bucket==='completed'?'완료 처리한 프로젝트와 결과를 이곳에서 확인할 수 있어요.':bucket==='pending'?'준비하거나 잠시 보류한 프로젝트가 이곳에 표시됩니다.':'새 프로젝트를 시작하거나 준비·보류 탭에서 다시 진행해 보세요.'}</p><button className="secondary-button" disabled={busy} onClick={()=>narrowed?(setQuery(''),setFilter('all')):bucket==='completed'?setBucket('active'):onCreateProject()}>{narrowed?'검색·필터 초기화':bucket==='completed'?'진행 중 보기':'프로젝트 추가'}</button>{!narrowed&&bucket==='active'&&groups.completed.length>0&&<button className="text-button" onClick={()=>setBucket('completed')}>완료된 프로젝트 {groups.completed.length}개 보기</button>}</div>}
      </TabsContent>
    </Tabs>
  </section>;
}
