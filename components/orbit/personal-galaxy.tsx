'use client';

import {useState, type CSSProperties} from 'react';
import {Orbit, ArrowUpRight, FolderKanban, BookOpen, CheckCheck, Network} from 'lucide-react';
import type {WorkspaceData, View} from '@/lib/orbit/model';
import {projectBuckets} from '@/lib/orbit/project-management';

const positions = [[25,22],[75,22],[77,65],[50,85],[23,65]];

/** A view of canonical workspace records; selecting a satellite opens that record. */
export function PersonalGalaxy({data,navigate,onOpen}:{data:WorkspaceData;navigate:(view:View)=>void;onOpen:(target:{kind:'project';id:string})=>void}) {
  const [focused,setFocused]=useState<string|null>(null);
  const activeProjects=projectBuckets(data.projects,data.tasks).active;
  const projects=[...activeProjects].sort((a,b)=>b.priority-a.priority).slice(0,5);
  const remaining=data.tasks.filter(t=>t.status!=='done').length;
  return <section className="personal-galaxy" aria-labelledby="galaxy-title">
    <div className="galaxy-heading"><div><span className="galaxy-kicker"><Orbit size={15}/> MY UNIVERSE</span><h2 id="galaxy-title">나를 중심으로, 더 넓은 연결.</h2></div><button className="icon-button" aria-label="전체 프로젝트 열기" onClick={()=>navigate('projects')}><Network size={18}/></button></div>
    <div className={'galaxy-map '+(!projects.length?'is-empty':'')}>
      <svg className="galaxy-paths" viewBox="0 0 600 310" preserveAspectRatio="none" aria-hidden="true">
        <ellipse className="galaxy-ring-inner cosmic-motion" cx="300" cy="149" rx="124" ry="64"/><ellipse className="galaxy-ring-outer cosmic-motion" cx="300" cy="149" rx="233" ry="118"/>
        {projects.map((p,i)=><line key={p.id} className={focused===p.id?'is-focused':''} x1="300" y1="149" x2={positions[i][0]*6} y2={positions[i][1]*3.1}/>)}
        {projects.map((p,i)=><line key={'signal-'+p.id} className={'galaxy-signal cosmic-motion '+(focused===p.id?'is-focused':'')} pathLength={100} style={{'--signal-delay':-i*1.3+'s'} as CSSProperties} x1="300" y1="149" x2={positions[i][0]*6} y2={positions[i][1]*3.1}/>)}
      </svg>
      <button className="galaxy-self cosmic-core" onClick={()=>navigate('goals')} aria-label="나의 목표 열기"><span className="galaxy-core-ring cosmic-motion" aria-hidden="true"/><span className="galaxy-core-ring is-outer cosmic-motion" aria-hidden="true"/><Orbit size={29}/><strong>나</strong><span>모든 연결의 시작</span></button>
      {projects.map((p,i)=>{const tasks=data.tasks.filter(t=>t.projectId===p.id),done=tasks.filter(t=>t.status==='done').length;return <button key={p.id} className={'galaxy-satellite '+(focused===p.id?'is-focused':'')} style={{'--node-x':positions[i][0]+'%','--node-y':positions[i][1]+'%'} as CSSProperties} onMouseEnter={()=>setFocused(p.id)} onMouseLeave={()=>setFocused(null)} onFocus={()=>setFocused(p.id)} onBlur={()=>setFocused(null)} onClick={()=>onOpen({kind:'project',id:p.id})} aria-label={`${p.name}, 등록 업무 ${tasks.length}개 중 ${done}개 완료, 프로젝트 열기`}><span className="satellite-icon"><FolderKanban size={16}/></span><span className="satellite-copy"><strong>{p.name}</strong><small>{done}/{tasks.length} 완료</small></span><ArrowUpRight size={12}/></button>})}
      {!projects.length&&<p className="galaxy-empty">진행 중인 프로젝트가 없어요.<br/>프로젝트를 시작하면 여기에 표시됩니다.</p>}
    </div>
    <div className="galaxy-footer"><button onClick={()=>navigate('projects')}><FolderKanban size={15}/><strong>{activeProjects.length}</strong> 진행 중</button><button onClick={()=>navigate('tasks')}><CheckCheck size={15}/><strong>{remaining}</strong> 남은 실행</button><button onClick={()=>navigate('wiki')}><BookOpen size={15}/><strong>{data.notes.length}</strong> 기록</button></div>
    {activeProjects.length>5&&<button className="galaxy-more text-button" onClick={()=>navigate('projects')}>진행 중인 프로젝트 {activeProjects.length}개 보기 <ArrowUpRight size={14}/></button>}
  </section>;
}
