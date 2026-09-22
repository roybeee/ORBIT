'use client';
import {useCallback,useEffect,useState} from 'react';
import {Check,RefreshCw,FileCheck2,Merge} from 'lucide-react';
import {agentRequest} from './agent/connections';
import {AgentRequestError} from '@/lib/orbit/agent/approval-feedback';
import type {AgentAction} from '@/lib/orbit/agent/types';
import {formatTime} from '@/lib/orbit/model';
type Review={status:string;summary:string;error?:string;progress?:string;revision:number;stale?:boolean;actions:AgentAction[];projects:{id:string;name:string;goal:string}[]};
export function MeetingReview({noteId,revision,demo,onChanged}:{noteId:string;revision:number;demo:boolean;onChanged?:()=>void}){
 const [dates,setDates]=useState<Record<string,string>>({}),[merging,setMerging]=useState(''),[targets,setTargets]=useState<Record<string,string>>({});
 const [data,setData]=useState<Review|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(''),[held,setHeld]=useState(''),[reason,setReason]=useState(''),[date,setDate]=useState(''),[notice,setNotice]=useState(''),[overlap,setOverlap]=useState<{id:string;overlapConfirmation:string;conflicts:{title:string;date:string;start:number;end:number}[]}|null>(null);
 const load=useCallback(async()=>{const d=await agentRequest('/api/meetings/review?noteId='+encodeURIComponent(noteId));setData(d);return d as Review},[noteId]);
 const reviewKey=noteId+':'+revision;
 const [loadedKey,setLoadedKey]=useState(reviewKey);
 if(loadedKey!==reviewKey){setLoadedKey(reviewKey);if(!demo){setData(null);setError('')}}
 useEffect(()=>{if(demo)return;let alive=true;const get=async()=>{try{const d=await agentRequest('/api/meetings/review?noteId='+encodeURIComponent(noteId));if(alive)setData(d)}catch(e){if(alive)setError((e as Error).message)}};void get();const timer=setInterval(()=>void get(),5000);return()=>{alive=false;clearInterval(timer)}},[noteId,revision,demo]);
 async function analyze(){setBusy('analysis');setError('');try{setData(await agentRequest('/api/meetings/review','POST',{noteId,retry:true}));setNotice('요약과 결재안을 준비하고 있습니다.')}catch(e){setError((e as Error).message)}finally{setBusy('')}}
 async function decide(item:AgentAction,decision:'approve'|'defer'|'reject'|'reconsider',confirmation?:string){
  if(busy)return;setBusy(item.id);setError('');setNotice('');
  try{await agentRequest('/api/agent','PATCH',{id:item.id,decision,...(decision==='defer'?{reason,revisitDate:date}:{}),...(confirmation?{overlapConfirmation:confirmation}:{})});setHeld('');setOverlap(null);setNotice(decision==='approve'?'승인한 내용을 등록했습니다. 연결된 프로젝트에도 반영됩니다.':decision==='defer'?'보류했습니다. 선택한 날짜에 다시 검토하세요.':decision==='reject'?'반려했습니다. 등록하지 않았습니다.':'다시 승인할 수 있습니다.');await load();onChanged?.();}
  catch(e){if(e instanceof AgentRequestError&&e.code==='CALENDAR_OVERLAP'&&e.details)setOverlap({id:item.id,...e.details} as typeof overlap);else setError((e as Error).message);await load().catch(()=>{});}finally{setBusy('')}
 }
 async function merge(item:AgentAction){const mergeId=targets[item.id];if(busy||!mergeId)return;setBusy(item.id);setError('');setNotice('');try{setData(await agentRequest('/api/meetings/review/merge','POST',{noteId,actionId:item.id,mergeId}));setMerging('');setTargets({...targets,[item.id]:''});setNotice('두 결재안을 하나로 합쳤습니다. 합친 내용을 확인하고 승인해 주세요.')}catch(e){setError((e as Error).message);await load().catch(()=>{})}finally{setBusy('')}}
 if(demo)return null;
 const running=data&&(['not_started','queued','running'].includes(data.status)||data.stale);
 return <section className="meeting-review" aria-label="회의 요약과 결재"><div className="section-title"><h3><FileCheck2 size={20}/> 회의 요약 · 결재</h3><span className="status status-blue">{data?.actions.filter(a=>a.state==='pending').length??0}건 승인 대기</span></div>
 <p className="form-hint">회의의 핵심과 실행할 일을 확인하세요. 승인한 항목만 일정·할 일·프로젝트에 등록합니다.</p>
 {running&&<p role="status"><RefreshCw size={16} className="animate-spin"/> {data.progress||'회의록을 분석하고 있습니다. 완료되면 알림함으로 알려드립니다.'}</p>}
 {data?.summary&&<div className="meeting-review-summary">{data.summary.split(/\n/).map((line,i)=>/^(?:#{1,4}\s*)?(회의 정보|안건별 요약|핵심 요약|결정 사항|향후 계획|다음 할 일|AI 제안|확인할 내용)/.test(line)?<h4 key={i}>{line.replace(/^#+\s*/,'')}</h4>:<p key={i}>{line||'\u00a0'}</p>)}</div>}
 {(error||data?.error)&&<p role="alert" className="note-error">{error||data?.error}</p>}{notice&&<p role="status">{notice}</p>}
 {data?.stale&&<p role="status">원문이 변경되었습니다. 최신 버전의 분석을 확인한 뒤 승인하세요.</p>}
 {data&&(!running)&&data.status!=='waiting_source'&&<button className="secondary-button" disabled={!!busy} onClick={()=>void analyze()}><RefreshCw size={15}/>{data.status==='completed'?'다시 분석':'분석 다시 시도'}</button>}
 {data?.status==='waiting_source'&&<p role="status">텍스트 원문이 들어오면 자동으로 요약과 결재안을 준비합니다.</p>}
 {data?.actions.map(item=>{const a=item.action,p=a.type==='task.upsert'?a.task.projectId:a.type==='event.upsert'?a.event.projectId:a.type==='project.upsert'?a.project.id:null,project=data.projects.find(x=>x.id===p),prerequisite=p&&!project&&a.type!=='project.upsert'?data.actions.find(x=>x.action.type==='project.upsert'&&x.action.project.id===p&&x.state!=='approved'):undefined;
 const candidates=item.state==='pending'&&(a.type==='task.upsert'||a.type==='event.upsert')?data.actions.filter(x=>x.id!==item.id&&x.state==='pending'&&x.action.type===a.type):[];
 return <article key={item.id} className="meeting-review-card"><div className="section-title"><strong>{item.title}</strong><span>{item.state==='approved'?'등록 완료':item.state==='rejected'?(item.note.startsWith('통합됨')?'통합됨':'반려'):item.state==='deferred'?'보류':item.state==='applying'?'등록 중':'승인 대기'}</span></div><p>{item.reason}</p>{item.state==='rejected'&&item.note.startsWith('통합됨')&&<p className="form-hint">{item.note}</p>}
 <dl><div><dt>분류</dt><dd>{a.type==='task.upsert'?'할 일':a.type==='event.upsert'?'일정':project?'프로젝트 내용 수정':'신규 프로젝트'}</dd></div><div><dt>프로젝트</dt><dd>{project?.name??(a.type==='project.upsert'?a.project.name:prerequisite?.title??'등록 시 자동 연결')}</dd></div>
 {a.type==='task.upsert'&&<><div><dt>마감일</dt><dd>{item.guard?.meeting?.needsDue?'미정 · 승인 전 지정':a.task.due}</dd></div><div><dt>예상 시간</dt><dd>{a.task.duration}분</dd></div><div><dt>완료 기준</dt><dd>{a.task.definition}</dd></div></>}
 {a.type==='event.upsert'&&<><div><dt>일시</dt><dd>{a.event.date} · {formatTime(a.event.start)}–{formatTime(a.event.end)}</dd></div>{a.event.description&&<div><dt>메모</dt><dd>{a.event.description}</dd></div>}</>}
 {a.type==='project.upsert'&&<><div><dt>이름</dt><dd>{a.project.name}</dd></div>{project&&<div><dt>기존 내용</dt><dd>{project.goal}</dd></div>}<div><dt>반영할 내용</dt><dd>{a.project.goal}</dd></div><div><dt>목표일</dt><dd>{item.guard?.meeting?.needsDue?'미정 · 승인 전 지정':a.project.due}</dd></div><div><dt>우선순위</dt><dd>{a.project.priority}</dd></div></>}
 </dl>{prerequisite&&<p className="form-hint">먼저 신규 프로젝트 제안을 승인해 주세요.</p>}
 {item.state==='pending'&&(a.type==='task.upsert'||a.type==='project.upsert')&&<form className="meeting-date-editor" onSubmit={async e=>{e.preventDefault();setBusy(item.id);setError('');try{setData(await agentRequest('/api/meetings/review','PATCH',{noteId,actionId:item.id,due:dates[item.id]}));setNotice('마감일을 저장했습니다. 내용을 확인하고 승인해 주세요.')}catch(err){setError((err as Error).message)}finally{setBusy('')}}}><label>{item.guard?.meeting?.needsDue?'마감일 지정':'마감일 변경'}<input aria-label={item.title+' 마감일'} className="form-field" type="date" required value={dates[item.id]??''} onChange={e=>setDates({...dates,[item.id]:e.target.value})}/></label><button className="secondary-button" disabled={!!busy||!dates[item.id]}>날짜 저장</button></form>}
 {item.state==='pending'&&<div className="sheet-actions"><button className="primary-button" disabled={!!busy||!!prerequisite||data.stale||item.guard?.meeting?.needsDue} onClick={()=>void decide(item,'approve')}><Check size={15}/>승인하고 등록</button><button className="secondary-button" disabled={!!busy} onClick={()=>setHeld(held===item.id?'':item.id)}>보류</button>{candidates.length>0&&<button className="secondary-button" disabled={!!busy} aria-expanded={merging===item.id} onClick={()=>setMerging(merging===item.id?'':item.id)}><Merge size={15}/>다른 일정과 통합</button>}<button className="text-button" disabled={!!busy} onClick={()=>void decide(item,'reject')}>반려</button></div>}
 {merging===item.id&&item.state==='pending'&&<form className="meeting-merge-editor" onSubmit={e=>{e.preventDefault();void merge(item)}}><label>이 카드에 합칠 결재안<select aria-label={item.title+'에 합칠 결재안'} className="form-field" required value={targets[item.id]??''} onChange={e=>setTargets({...targets,[item.id]:e.target.value})}><option value="">선택하세요</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label><p className="form-hint">선택한 결재안의 내용·근거가 이 카드에 합쳐지고, 선택한 카드는 통합됨으로 표시됩니다. 할 일은 예상 시간을 더하고 더 빠른 마감일을 쓰며, 같은 날 일정은 시간을 이어 붙입니다.</p><div className="sheet-actions"><button className="primary-button" disabled={!!busy||!targets[item.id]}><Merge size={15}/>통합</button><button type="button" className="text-button" disabled={!!busy} onClick={()=>setMerging('')}>취소</button></div></form>}
 {item.state==='deferred'&&<><p>{item.revisitDate} 다시 검토 · {item.note}</p><button className="text-button" disabled={!!busy} onClick={()=>void decide(item,'reconsider')}>보류 해제</button></>}
 {held===item.id&&<form onSubmit={e=>{e.preventDefault();void decide(item,'defer')}}><label>보류 이유<input className="form-field" value={reason} maxLength={2000} required onChange={e=>setReason(e.target.value)}/></label><label>다시 검토할 날짜<input className="form-field" type="date" value={date} required onChange={e=>setDate(e.target.value)}/></label><button className="secondary-button" disabled={!!busy}>보류 저장</button></form>}
 {overlap?.id===item.id&&<div role="alert"><p>기존 일정과 시간이 겹칩니다.</p>{overlap.conflicts.map((c,i)=><p key={i}>{c.title} · {c.date} {formatTime(c.start)}–{formatTime(c.end)}</p>)}<button className="primary-button" disabled={!!busy} onClick={()=>void decide(item,'approve',overlap.overlapConfirmation)}>겹침을 확인했고 등록합니다</button><button className="text-button" onClick={()=>setOverlap(null)}>취소</button></div>}
 </article>})}
 {data?.status==='completed'&&!data.actions.length&&<p>등록할 결재안이 없습니다. 요약의 확인할 내용을 검토해 주세요.</p>}
 </section>;
}
