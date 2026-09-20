'use client';
import {useEffect,useMemo,useState} from 'react';
import {createPortal} from 'react-dom';
import {Search,Plus,ChevronRight,ChevronLeft,CheckCheck,FolderKanban,MoreHorizontal,SlidersHorizontal,ArrowRight,GripVertical,LockKeyhole} from 'lucide-react';
import type {WorkspaceData} from '@/lib/orbit/model';
import {projectSummary,projectStatus,projectDisplayStatus,projectStatusLabel,projectBuckets,type ProjectBucket} from '@/lib/orbit/project-management';
import {Progress} from '@/components/ui/progress';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {illustrationTheme,screenIllustration} from '@/lib/orbit/city-themes';
import {projectWorld} from '@/lib/orbit/project-world';
import {useProjectReorder} from './use-project-reorder';
import type {ProjectIntent} from './project-actions';

type Props={data:WorkspaceData;today:string;busy:boolean;onOpen:(id:string,intent?:ProjectIntent)=>void;onOpenTask:(id:string)=>void;onCreateTask:(id:string)=>void;onCreateProject:()=>void;onManage:(id:string)=>void;onTrash:()=>void;onReorder:(ids:string[])=>Promise<boolean>};
export function ProjectHub({data,today,busy,onOpen,onCreateTask,onCreateProject,onManage,onTrash,onReorder}:Props){
  const [query,setQuery]=useState(''),[bucket,setBucket]=useState<ProjectBucket>('active');
  const [filter,setFilter]=useState('all'),[sort,setSort]=useState('manual'),[toolsOpen,setToolsOpen]=useState(false),[index,setIndex]=useState(0);
  const items=useMemo(()=>data.projects.map(project=>({project,summary:projectSummary(data,project,today)})),[data,today]);
  const groups=useMemo(()=>projectBuckets(data.projects,data.tasks),[data.projects,data.tasks]);
  const bucketIds=new Set(groups[bucket].map(p=>p.id));
  const attention=items.filter(i=>i.summary.attention).length;
  const visible=items.filter(({project,summary})=>bucketIds.has(project.id)
    &&(filter==='all'||filter==='attention'&&summary.attention||projectStatus(project)===filter)
    &&`${project.name} ${project.goal} ${(project.keywords??[]).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a,b)=>Number(b.project.id===data.dominoProjectId)-Number(a.project.id===data.dominoProjectId)||(sort==='manual'?0:(sort==='name'?a.project.name.localeCompare(b.project.name,'ko'):sort==='priority'?b.project.priority-a.project.priority:sort==='due'?a.project.due.localeCompare(b.project.due):bucket==='completed'?(b.project.completedOn??'').localeCompare(a.project.completedOn??''):Number(b.summary.attention)-Number(a.summary.attention)||b.project.priority-a.project.priority)||a.project.due.localeCompare(b.project.due)||a.project.id.localeCompare(b.project.id)));
  const reorder=useProjectReorder({ids:visible.map(i=>i.project.id),coreId:data.dominoProjectId,scope:[bucket,query,filter,sort].join('|'),disabled:busy,onManage,onSave:async ids=>{const ok=await onReorder(ids);if(ok)setSort('manual');return ok}});
  const {root}=reorder;
  const ordered=reorder.order?visible.slice().sort((a,b)=>Number(b.project.id===data.dominoProjectId)-Number(a.project.id===data.dominoProjectId)||(reorder.order!.indexOf(a.project.id)-reorder.order!.indexOf(b.project.id))):visible;
  const visibleKey=visible.map(i=>i.project.id).join('|');
  useEffect(()=>{if(reorder.editing)return;setIndex(0);root.current?.scrollTo({left:0,behavior:'instant'})},[visibleKey,bucket,root]);
  const bucketLabel=bucket==='active'?'진행 중인 프로젝트':bucket==='completed'?'완료된 프로젝트':'준비·보류 프로젝트';
  const narrowed=!!query.trim()||filter!=='all';
  function scrollCard(next:number){
    const track=root.current,card=track?.children[next] as HTMLElement|undefined,first=track?.firstElementChild as HTMLElement|null;
    if(track&&card&&first){track.scrollTo({left:card.offsetLeft-first.offsetLeft,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});setIndex(next)}
  }
  return <section className="project-hub project-flow" aria-label="프로젝트 관리">
    <div className="project-universe-banner"><img src={illustrationTheme(screenIllustration(data.preferences,'projects')).image} width="1536" height="864" alt=""/><div><span>MY CITY, MY PROJECTS</span><h2>나의 도시에서<br/>한 걸음씩 앞으로</h2><p>진행 중 <strong>{groups.active.length}</strong> · 완료 <strong>{groups.completed.length}</strong></p></div></div>
    <div className="project-flow-summary"><p>진행 중 <strong>{groups.active.length}</strong><span>·</span>확인 필요 <strong>{attention}</strong></p><button className="text-button" aria-expanded={toolsOpen} aria-controls="project-search-tools" onClick={()=>setToolsOpen(v=>!v)}><SlidersHorizontal size={17}/><span>검색·정렬</span></button></div>
    <Tabs className="project-status-tabs" value={bucket} onValueChange={value=>{if(reorder.editing)return;setBucket(value as ProjectBucket);setFilter('all');setQuery('')}}>
      <TabsList aria-label="프로젝트 진행 상태">
        <TabsTrigger disabled={reorder.editing} value="active">진행 중 <span>{groups.active.length}</span></TabsTrigger>
        <TabsTrigger disabled={reorder.editing} value="completed">완료 <span>{groups.completed.length}</span></TabsTrigger>
        <TabsTrigger disabled={reorder.editing} value="pending">준비·보류 <span>{groups.pending.length}</span></TabsTrigger>
      </TabsList>
      <TabsContent value={bucket}>
        {toolsOpen&&<div id="project-search-tools" className="project-flow-tools">
          <label className="project-search"><Search size={18}/><input aria-label="프로젝트 검색" disabled={reorder.editing} placeholder={`${bucketLabel} 검색`} value={query} onChange={e=>setQuery(e.target.value)}/></label>
          <div>{bucket!=='completed'&&<select disabled={reorder.editing} aria-label="프로젝트 상태 필터" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">전체</option>{bucket==='pending'?<><option value="planned">준비</option><option value="paused">보류</option></>:<option value="attention">확인 필요</option>}</select>}
          <select disabled={reorder.editing} aria-label="프로젝트 정렬" value={sort} onChange={e=>setSort(e.target.value)}><option value="manual">내 순서</option><option value="attention">{bucket==='completed'?'최근 완료순':'확인 필요순'}</option><option value="due">마감순</option><option value="priority">우선순위순</option><option value="name">이름순</option></select><button className="text-button" onClick={onTrash} disabled={reorder.editing}>휴지통</button><button className="text-button" disabled={busy||reorder.editing||visible.filter(i=>i.project.id!==data.dominoProjectId).length<2} onClick={reorder.startEditing}><GripVertical size={16}/>순서 편집</button></div>
        </div>}
        {narrowed&&<p className="project-search-count">검색 결과 {visible.length}개<button disabled={reorder.editing||reorder.saving} className="text-button" onClick={()=>{setQuery('');setFilter('all')}}>초기화</button></p>}
        <div ref={root} className={`project-poster-track ${reorder.editing?'is-reordering':''}`} aria-label={bucketLabel} onScroll={e=>{const track=e.currentTarget,cards=Array.from(track.children) as HTMLElement[];const first=cards[0];if(first){let closest=0;cards.forEach((card,i)=>{if(Math.abs(card.offsetLeft-first.offsetLeft-track.scrollLeft)<Math.abs(cards[closest].offsetLeft-first.offsetLeft-track.scrollLeft))closest=i});setIndex(closest)}}}>
          {ordered.map(({project:p,summary:s})=>{
            const state=projectDisplayStatus(p,data.tasks),finalized=projectStatus(p)==='completed';
            const label=state==='completed'?(finalized?'완료 결과 보기':'완료한 할 일 보기'):state!=='active'?'프로젝트 진행하기':!s.tasks.length?'첫 할 일 추가':'다음 할 일 확인';
            const action=()=>state==='completed'?onOpen(p.id,finalized?'overview':'tasks'):state!=='active'?onOpen(p.id,'resume'):!s.tasks.length?onCreateTask(p.id):onOpen(p.id,'tasks');
            return <article data-project-card={p.id} className={`project-poster project-state-${state} ${reorder.editing&&p.id!==data.dominoProjectId?'is-wiggling':''} ${reorder.drag?.id===p.id?'is-dragging':''}`} key={p.id} aria-label={`${p.name} 프로젝트`}>
              {reorder.editing&&<div className="project-reorder-card-tools">{p.id===data.dominoProjectId?<span><LockKeyhole size={14}/>코어 · 고정</span>:<><span><GripVertical size={16}/>끌어서 이동</span><button data-reorder-control disabled={busy||reorder.saving||reorder.order?.indexOf(p.id)===0} aria-label={`${p.name} 앞으로 이동`} onClick={()=>reorder.step(p.id,-1)}><ChevronLeft size={19}/></button><button data-reorder-control disabled={busy||reorder.saving||reorder.order?.indexOf(p.id)===(reorder.order?.length??0)-1} aria-label={`${p.name} 뒤로 이동`} onClick={()=>reorder.step(p.id,1)}><ChevronRight size={19}/></button></>}</div>}
              <div className="project-poster-art"><button data-project-title disabled={busy} onClick={()=>onOpen(p.id)} aria-label={`${p.name} 프로젝트 열기`}><img src={projectWorld(p.id,data.preferences).image} width="960" height="720" loading="lazy" alt="" draggable={false}/></button><button className="project-poster-menu" disabled={busy||reorder.editing} aria-label={`${p.name} 관리 메뉴`} aria-haspopup="dialog" onClick={()=>onManage(p.id)}><MoreHorizontal size={22}/></button></div>
              <div className="project-poster-meta"><span>{data.dominoProjectId===p.id?'CORE PROJECT':'ORBIT PROJECT'}</span><span>{state==='completed'?'완료':s.dueOver?'기한 지남':p.due.slice(5).replace('-','/')+' 목표'}</span></div>
              <button data-project-title className="project-poster-title" disabled={busy} onClick={()=>onOpen(p.id)}><h2>{p.name}</h2></button>
              <p className="project-poster-goal">{p.goal||'첫 목표를 정해 보세요.'}</p>
              <div className="project-poster-progress"><span>{s.tasks.length?`${s.done} / ${s.tasks.length} 완료`:'첫 할 일을 기다리고 있어요'}</span><strong>{s.progress===null?'—':`${s.progress}%`}</strong></div>
              <Progress value={s.progress??0} aria-label={`${p.name} 할 일 ${s.done}/${s.tasks.length} 완료`}/>
              <button className="project-poster-action" disabled={busy||reorder.editing} onClick={action}>{state==='completed'?<CheckCheck size={18}/>:!s.tasks.length?<Plus size={18}/>:null}<span>{label}</span><ArrowRight size={18}/></button>
              <span className="sr-only">{projectStatusLabel[state]}</span>
            </article>;
          })}
        </div>
        {!!visible.length&&<div className="project-carousel-controls"><button aria-label="이전 프로젝트" disabled={index===0} onClick={()=>scrollCard(index-1)}><ChevronLeft size={19}/></button><span aria-live="polite">{String(index+1).padStart(2,'0')} <span>/ {String(visible.length).padStart(2,'0')}</span></span><button aria-label="다음 프로젝트" disabled={index>=visible.length-1} onClick={()=>scrollCard(index+1)}><ChevronRight size={19}/></button></div>}
        {!visible.length&&<div className="project-hub-empty"><FolderKanban size={30}/><h2>{narrowed?'조건에 맞는 프로젝트가 없어요':`${bucketLabel}가 없어요`}</h2><p>{narrowed?'검색어나 필터를 바꿔 보세요.':bucket==='completed'?'할 일을 모두 마치거나 완료 처리한 프로젝트가 이곳에 모입니다.':bucket==='pending'?'준비하거나 잠시 보류한 프로젝트가 이곳에 표시됩니다.':'새 프로젝트를 시작해 보세요.'}</p><button className="secondary-button" disabled={busy} onClick={()=>narrowed?(setQuery(''),setFilter('all')):bucket==='completed'?setBucket('active'):onCreateProject()}>{narrowed?'검색·필터 초기화':bucket==='completed'?'진행 중 보기':'프로젝트 추가'}</button>{!narrowed&&bucket==='active'&&groups.completed.length>0&&<button className="text-button" onClick={()=>setBucket('completed')}>완료된 프로젝트 {groups.completed.length}개 보기</button>}</div>}
      </TabsContent>
    </Tabs>
    <p className="project-press-hint">길게 눌러 순서 변경 · 코어 프로젝트는 고정 · 수정·삭제는 ⋯</p>
    <p className="sr-only" role="status">{reorder.message}</p>
    {reorder.editing&&createPortal(<div className="project-reorder-bar" role="region" aria-label="프로젝트 순서 편집"><div><strong>프로젝트 순서 편집</strong><span>{reorder.saving?'저장 중…':'끌어서 이동한 뒤 저장하세요'}</span></div><button className="secondary-button" disabled={busy||reorder.saving} onClick={reorder.cancel}>취소</button><button className="primary-button" disabled={busy||reorder.saving} onClick={()=>void reorder.save()}>순서 저장</button></div>,document.body)}
    {reorder.drag&&createPortal(<div className="project-drag-ghost" style={{left:reorder.drag.x,top:reorder.drag.y}} aria-hidden="true"><GripVertical size={20}/><strong>{data.projects.find(p=>p.id===reorder.drag?.id)?.name}</strong></div>,document.body)}
  </section>;
}
