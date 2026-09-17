import type {WorkspaceData} from './model.ts';
import type {MonthlyReport,ExecutionRecord,Contact} from './phase4-schema.ts';
import {questReadiness} from './pacemaker.ts';
import {addDays} from './dates.ts';
export function monthlyReport(data:WorkspaceData,month:string,now:Date):MonthlyReport{
 const from=month+'-01',next=new Date(from+'T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);const through=addDays(next.toISOString().slice(0,10),-1);
 const {rows,records,legacy}=executionSamples(data,from,through);
 const late=rows.filter(r=>r.date>r.due&&r.outcome!=='skipped'),waiting=rows.filter(r=>r.reason==='waiting'),rework=rows.filter(r=>r.reason==='scope');
 const switches=records.slice(1).filter((r,i)=>r.date===records[i].date&&r.projectId!==records[i].projectId).length;
 const decisions=(data.decisions??[]).filter(d=>d.createdAt.slice(0,7)===month).length;
 const metrics={done:rows.filter(r=>r.outcome==='done').length,late:late.length,waiting:waiting.length,rework:rework.length,switches,decisions,minutes:rows.reduce((n,r)=>n+(r.actual??0),0)};
 const recommendations:MonthlyReport['recommendations']=[];
 const add=(kind:'stop'|'delegate'|'standardize',list:ExecutionRecord[],measure:'late'|'waiting'|'rework',title:(r:ExecutionRecord)=>string)=>{const counts=new Map<string,ExecutionRecord[]>();for(const r of list)counts.set(r.taskId,[...(counts.get(r.taskId)??[]),r]);for(const [taskId,rs] of [...counts].sort((a,b)=>b[1].length-a[1].length).slice(0,3))recommendations.push({id:kind+':'+(recommendations.length+1),kind,title:title(rs[0]),taskId,evidence:rs.slice(-5).map(r=>`${r.date} · ${r.title} · ${r.outcome} · ${r.reason||'기한 경과'}`),baseline:rs.length,measure,status:'suggested'});};
 add('stop',late.filter(r=>r.impact<=2),'late',r=>`‘${r.title}’의 다음 달 지속 필요성을 재검토하고 중요도가 낮다면 중단`);
 add('delegate',waiting,'waiting',r=>`‘${r.title}’의 자료 요청·확인 담당자를 정하고 회신 기한을 명시`);
 add('standardize',rework,'rework',r=>`‘${r.title}’의 완료 기준과 검토 순서를 체크리스트로 표준화`);
 return {id:month,createdAt:now.toISOString(),through,sampleCount:rows.length,coverage:`결과를 기록한 업무·날짜 ${rows.length}건. 과거 최신 결과 보충 ${legacy.length}건. 미기록 업무는 실패로 계산하지 않습니다. 재작업은 범위 변경 사유, 사업 전환은 연속 결과 기록의 프로젝트 변화로 근사하며 실제 앱 사용을 추적하지 않습니다.`,summary:rows.length?`완료 ${metrics.done}건, 기한 경과 ${metrics.late}건, 대기 사유 ${metrics.waiting}건, 범위 재조정 ${metrics.rework}건. 신규 결정 ${decisions}건. 제안은 근거가 있는 유형만 표시합니다.`:'해당 월의 실행 결과가 없어 개선 효과를 판단할 수 없습니다.',metrics,recommendations};
}
export function contactContext(data:WorkspaceData,c:Contact){
 const names=new Set([c.name,...c.aliases].map(n=>n.trim().toLocaleLowerCase()));
 return {projects:data.projects.filter(p=>c.projectIds.includes(p.id)),notes:data.notes.filter(n=>c.noteIds.includes(n.id)),decisions:(data.decisions??[]).filter(d=>c.decisionIds.includes(d.id)),promises:(data.delegations??[]).filter(d=>c.delegationIds.includes(d.id)||names.has(d.assignee.trim().toLocaleLowerCase())),meetings:data.events.filter(e=>c.eventIds.includes(e.id)).sort((a,b)=>a.date.localeCompare(b.date))};
}
export function morningScript(data:WorkspaceData,date:string){
 const plan=data.proposals.find(p=>p.date===date);const tasks=(plan?.items??[]).filter(i=>i.state==='approved').map(i=>data.tasks.find(t=>t.id===i.taskId)).filter(t=>t&&t.status!=='done');
 const first=tasks[0]??data.tasks.filter(t=>questReadiness(data,t,date).canStart).sort((a,b)=>a.due.localeCompare(b.due)||b.impact-a.impact)[0];
 const meetings=data.events.filter(e=>e.date===date&&e.kind==='meeting').sort((a,b)=>a.start-b.start);
 const due=(data.delegations??[]).filter(d=>d.checkDate<=date&&!['verified','cancelled'].includes(d.status));
 return `${date} 아침 브리핑입니다. ${tasks.length?`승인한 결과물은 ${tasks.slice(0,3).map(t=>t!.title).join(', ')}입니다.`:'오늘 승인한 실행 계획은 아직 없습니다.'} ${first?`첫 행동 후보는 ${first.title}입니다. 완료 기준은 ${first.definition||'실행 전 정해 주세요'}.`:'첫 행동을 정하려면 업무를 등록해 주세요.'} ${meetings.length?`오늘 회의 ${meetings.length}개, 첫 회의는 ${Math.floor(meetings[0].start/60)}시 ${meetings[0].start%60}분 ${meetings[0].title}입니다.`:'등록된 오늘 회의가 없습니다.'} ${due.length?`회신을 확인할 약속은 ${due.length}개입니다.`:''} ${data.reviews.find(r=>r.date===addDays(date,-1))?.energy==='low'?'어제 에너지가 낮았습니다. 회복 시간을 먼저 지키세요.':''} 최신 일정과 자료 수집 상태를 확인하고 시작하세요.`.slice(0,600);
}

export function executionSamples(data:WorkspaceData,from:string,through:string){
 const records=(data.executionHistory??[]).filter(r=>r.date>=from&&r.date<=through).sort((a,b)=>a.at.localeCompare(b.at));
 const legacy:ExecutionRecord[]=data.tasks.filter(t=>t.outcome&&t.outcomeOn&&t.outcomeOn>=from&&t.outcomeOn<=through&&!records.some(r=>r.taskId===t.id&&r.date===t.outcomeOn)).map(t=>({id:'legacy:'+t.id,taskId:t.id,title:t.title,projectId:t.projectId,date:t.outcomeOn!,at:t.outcomeOn!+'T00:00:00Z',due:t.due,outcome:t.outcome!,reason:t.outcomeReason??'',estimate:t.outcomeEstimateMinutes??t.duration,actual:t.actualMinutes??null,impact:t.impact,buffer:null}));
 const latest=new Map<string,ExecutionRecord>();for(const r of [...records,...legacy])latest.set(r.taskId+':'+r.date,r);return {records,legacy,rows:[...latest.values()]};
}
