'use client';
import {useEffect,useMemo,useState} from 'react';
import {Search,Plus,ChevronRight,ChevronLeft,CheckCheck,FolderKanban,MoreHorizontal,SlidersHorizontal,ArrowRight} from 'lucide-react';
import type {WorkspaceData} from '@/lib/orbit/model';
import {projectSummary,projectStatus,projectDisplayStatus,projectStatusLabel,projectBuckets,type ProjectBucket} from '@/lib/orbit/project-management';
import {Progress} from '@/components/ui/progress';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {useProjectPress} from './use-project-press';
import type {ProjectIntent} from './project-actions';

type Props={data:WorkspaceData;today:string;busy:boolean;onOpen:(id:string,intent?:ProjectIntent)=>void;onOpenTask:(id:string)=>void;onCreateTask:(id:string)=>void;onCreateProject:()=>void;onManage:(id:string)=>void;onTrash:()=>void};
export function ProjectHub({data,today,busy,onOpen,onCreateTask,onCreateProject,onManage,onTrash}:Props){
  const [query,setQuery]=useState(''),[bucket,setBucket]=useState<ProjectBucket>('active');
  const [filter,setFilter]=useState('all'),[sort,setSort]=useState('attention'),[toolsOpen,setToolsOpen]=useState(false),[index,setIndex]=useState(0);
  const {root,holding}=useProjectPress({disabled:busy,onManage});
  const items=useMemo(()=>data.projects.map(project=>({project,summary:projectSummary(data,project,today)})),[data,today]);
  const groups=useMemo(()=>projectBuckets(data.projects,data.tasks),[data.projects,data.tasks]);
  const bucketIds=new Set(groups[bucket].map(p=>p.id));
  const attention=items.filter(i=>i.summary.attention).length;
  const visible=items.filter(({project,summary})=>bucketIds.has(project.id)
    &&(filter==='all'||filter==='attention'&&summary.attention||projectStatus(project)===filter)
    &&`${project.name} ${project.goal} ${(project.keywords??[]).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a,b)=>(sort==='name'?a.project.name.localeCompare(b.project.name,'ko'):sort==='priority'?b.project.priority-a.project.priority:sort==='due'?a.project.due.localeCompare(b.project.due):bucket==='completed'?(b.project.completedOn??'').localeCompare(a.project.completedOn??''):Number(b.summary.attention)-Number(a.summary.attention)||b.project.priority-a.project.priority)||a.project.due.localeCompare(b.project.due)||a.project.id.localeCompare(b.project.id));
  const visibleKey=visible.map(i=>i.project.id).join('|');
  useEffect(()=>{setIndex(0);root.current?.scrollTo({left:0,behavior:'instant'})},[visibleKey,bucket,root]);
  const bucketLabel=bucket==='active'?'진행 중인 프로젝트':bucket==='completed'?'완료된 프로젝트':'준비·보류 프로젝트';
  const narrowed=!!query.trim()||filter!=='all';
  function scrollCard(next:number){
    const track=root.current,card=track?.children[next] as HTMLElement|undefined,first=track?.firstElementChild as HTMLElement|null;
    if(track&&card&&first){track.scrollTo({left:card.offsetLeft-first.offsetLeft,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});setIndex(next)}
  }
  return <section className="project-hub project-flow" aria-label="프로젝트 관리">
    <div className="project-flow-summary"><p>진행 중 <strong>{groups.active.length}</strong><span>·</span>확인 필요 <strong>{attention}</strong></p><button className="text-button" aria-expanded={toolsOpen} aria-controls="project-search-tools" onClick={()=>setToolsOpen(v=>!v)}><SlidersHorizontal size={17}/><span>검색·정렬</span></button></div>
    <Tabs className="project-status-tabs" value={bucket} onValueChange={value=>{setBucket(value as ProjectBucket);setFilter('all');setQuery('')}}>
      <TabsList aria-label="프로젝트 진행 상태">
        <TabsTrigger value="active">진행 중 <span>{groups.active.length}</span></TabsTrigger>
        <TabsTrigger value="completed">완료 <span>{groups.completed.length}</span></TabsTrigger>
        <TabsTrigger value="pending">준비·보류 <span>{groups.pending.length}</span></TabsTrigger>
      </TabsList>
      <TabsContent value={bucket}>
        {toolsOpen&&<div id="project-search-tools" className="project-flow-tools">
          <label className="project-search"><Search size={18}/><input aria-label="프로젝트 검색" placeholder={`${bucketLabel} 검색`} value={query} onChange={e=>setQuery(e.target.value)}/></label>
          <div>{bucket!=='completed'&&<select aria-label="프로젝트 상태 필터" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">전체</option>{bucket==='pending'?<><option value="planned">준비</option><option value="paused">보류</option></>:<option value="attention">확인 필요</option>}</select>}
          <select aria-label="프로젝트 정렬" value={sort} onChange={e=>setSort(e.target.value)}><option value="attention">{bucket==='completed'?'최근 완료순':'확인 필요순'}</option><option value="due">마감순</option><option value="priority">우선순위순</option><option value="name">이름순</option></select><button className="text-button" onClick={onTrash}>휴지통</button></div>
        </div>}
        {narrowed&&<p className="project-search-count">검색 결과 {visible.length}개<button className="text-button" onClick={()=>{setQuery('');setFilter('all')}}>초기화</button></p>}
        <div ref={root} className="project-poster-track" aria-label={bucketLabel} onScroll={e=>{const track=e.currentTarget,cards=Array.from(track.children) as HTMLElement[];const first=cards[0];if(first){let closest=0;cards.forEach((card,i)=>{if(Math.abs(card.offsetLeft-first.offsetLeft-track.scrollLeft)<Math.abs(cards[closest].offsetLeft-first.offsetLeft-track.scrollLeft))closest=i});setIndex(closest)}}}>
          {visible.map(({project:p,summary:s})=>{
            const state=projectDisplayStatus(p,data.tasks),finalized=projectStatus(p)==='completed';
            const label=state==='completed'?(finalized?'완료 결과 보기':'완료한 할 일 보기'):state!=='active'?'프로젝트 진행하기':!s.tasks.length?'첫 할 일 추가':'다음 할 일 확인';
            const action=()=>state==='completed'?onOpen(p.id,finalized?'overview':'tasks'):state!=='active'?onOpen(p.id,'resume'):!s.tasks.length?onCreateTask(p.id):onOpen(p.id,'tasks');
            return <article data-project-card={p.id} className={`project-poster project-state-${state} ${holding===p.id?'is-held':''}`} key={p.id} aria-label={`${p.name} 프로젝트`}>
              <div className="project-poster-art"><button data-project-title disabled={busy} onClick={()=>onOpen(p.id)} aria-label={`${p.name} 프로젝트 열기`}><img src="/orbit-projects/orbital-card.png" width="278" height="214" alt="" draggable={false}/></button><button className="project-poster-menu" disabled={busy} aria-label={`${p.name} 관리 메뉴`} aria-haspopup="dialog" onClick={()=>onManage(p.id)}><MoreHorizontal size={22}/></button></div>
              <div className="project-poster-meta"><span>{data.dominoProjectId===p.id?'CORE PROJECT':'ORBIT PROJECT'}</span><span>{state==='completed'?'완료':s.dueOver?'기한 지남':p.due.slice(5).replace('-','/')+' 목표'}</span></div>
              <button data-project-title className="project-poster-title" disabled={busy} onClick={()=>onOpen(p.id)}><h2>{p.name}</h2></button>
              <p className="project-poster-goal">{p.goal||'첫 목표를 정해 보세요.'}</p>
              <div className="project-poster-progress"><span>{s.tasks.length?`${s.done} / ${s.tasks.length} 완료`:'첫 할 일을 기다리고 있어요'}</span><strong>{s.progress===null?'—':`${s.progress}%`}</strong></div>
              <Progress value={s.progress??0} aria-label={`${p.name} 할 일 ${s.done}/${s.tasks.length} 완료`}/>
              <button className="project-poster-action" disabled={busy} onClick={action}>{state==='completed'?<CheckCheck size={18}/>:!s.tasks.length?<Plus size={18}/>:null}<span>{label}</span><ArrowRight size={18}/></button>
              <span className="sr-only">{projectStatusLabel[state]}</span>
            </article>;
          })}
        </div>
        {!!visible.length&&<div className="project-carousel-controls"><button aria-label="이전 프로젝트" disabled={index===0} onClick={()=>scrollCard(index-1)}><ChevronLeft size={19}/></button><span aria-live="polite">{String(index+1).padStart(2,'0')} <span>/ {String(visible.length).padStart(2,'0')}</span></span><button aria-label="다음 프로젝트" disabled={index>=visible.length-1} onClick={()=>scrollCard(index+1)}><ChevronRight size={19}/></button></div>}
        {!visible.length&&<div className="project-hub-empty"><FolderKanban size={30}/><h2>{narrowed?'조건에 맞는 프로젝트가 없어요':`${bucketLabel}가 없어요`}</h2><p>{narrowed?'검색어나 필터를 바꿔 보세요.':bucket==='completed'?'할 일을 모두 마치거나 완료 처리한 프로젝트가 이곳에 모입니다.':bucket==='pending'?'준비하거나 잠시 보류한 프로젝트가 이곳에 표시됩니다.':'새 프로젝트를 시작해 보세요.'}</p><button className="secondary-button" disabled={busy} onClick={()=>narrowed?(setQuery(''),setFilter('all')):bucket==='completed'?setBucket('active'):onCreateProject()}>{narrowed?'검색·필터 초기화':bucket==='completed'?'진행 중 보기':'프로젝트 추가'}</button>{!narrowed&&bucket==='active'&&groups.completed.length>0&&<button className="text-button" onClick={()=>setBucket('completed')}>완료된 프로젝트 {groups.completed.length}개 보기</button>}</div>}
      </TabsContent>
    </Tabs>
    <p className="project-press-hint">카드를 길게 누르거나 ⋯ 버튼으로 관리하세요.</p>
  </section>;
}
