import type {WorkspaceData,View} from './model.ts';
import {planDataTrash,relatedRecords,recordsOf,type DataSelection} from './data-manager.ts';

// Only records owned by this project are candidates. References from elsewhere are blockers,
// never an instruction to recursively delete another project's work.
export function projectTrashPreview(data:WorkspaceData,projectId:string){
  const selection:DataSelection[]=[{category:'projects',id:projectId}];
  for(const category of ['tasks','notes','events','decisions','delegations'] as const)
    for(const record of recordsOf(data,category))if(record.projectId===projectId)selection.push({category,id:record.id});
  const counts={tasks:0,notes:0,events:0,decisions:0,delegations:0};
  for(const s of selection)if(s.category in counts)counts[s.category as keyof typeof counts]++;
  let error='',view:View='data';
  if(!data.projects.some(p=>p.id===projectId))error='프로젝트가 변경되었거나 이미 삭제되었습니다.';
  else if(data.tasks.some(t=>t.projectId===projectId&&t.startedAt)){error='진행 중인 집중을 먼저 종료해 주세요. 기록한 시간을 보존한 뒤 삭제할 수 있습니다.';view='today';}
  else if(data.events.some(e=>e.projectId===projectId&&e.id.startsWith('approved:'))){error='승인한 집중 일정이 연결되어 있습니다. 해당 일정의 승인을 취소한 뒤 삭제해 주세요.';view='proposal';}
  else if(data.events.some(e=>e.projectId===projectId&&e.id.startsWith('google:'))){error='Google 원본 일정이 연결되어 있습니다. 일정 화면에서 연결된 원본을 먼저 확인해 주세요.';view='calendar';}
  else if(selection.length>100)error='연결된 항목이 100개를 넘습니다. 데이터 관리에서 항목을 나누어 정리한 뒤 삭제해 주세요.';
  if(!error){
    const keys=new Set(selection.map(s=>s.category+':'+s.id));
    const external=selection.flatMap(s=>relatedRecords(data,s)).filter(s=>!keys.has(s.category+':'+s.id));
    if(external.length)error=`다른 기록이 이 프로젝트를 참조하고 있습니다: ${[...new Set(external.map(r=>r.title))].slice(0,3).join(', ')}. 데이터 관리에서 연결을 먼저 정리해 주세요.`;
  }
  if(!error){
    if(data.weeklyAllocations?.some(w=>w.allocations.some(a=>a.projectId===projectId))){error='주간 배분에 연결된 프로젝트입니다. 배분에서 이 프로젝트를 정리한 뒤 삭제해 주세요.';view='portfolio';}
    else if(data.experiments?.some(e=>e.projectId===projectId)){error='사업 실험에 연결된 프로젝트입니다. 실험의 근거와 연결을 먼저 확인해 주세요.';view='experiments';}
    else if(data.operatingMetrics?.some(m=>m.projectId===projectId)){error='운영 지표에 연결된 프로젝트입니다. 지표의 기록과 연결을 먼저 확인해 주세요.';view='signals';}
    else if(data.meetingRecords?.some(m=>m.projectId===projectId)){error='확정한 회의 결과에 연결되어 있습니다. 회의의 후속 기록을 먼저 확인해 주세요.';view='meetings';}
    else if(data.contacts?.some(c=>c.projectIds.includes(projectId))){error='사람·거래처 카드에 연결되어 있습니다. 해당 카드에서 프로젝트 연결을 해제한 뒤 삭제해 주세요.';view='contacts';}
  }
  if(!error)try{planDataTrash(data,selection)}catch(e){error=(e as Error).message;}
  return {selection,counts,error,view};
}
