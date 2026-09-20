import type {WorkspaceData} from './model.ts';
import type {ExecutionRecord} from './phase4-schema.ts';
export function executionSamples(data:Pick<WorkspaceData,'tasks'|'executionHistory'>,from:string,through:string){
 const records=(data.executionHistory??[]).filter(r=>r.date>=from&&r.date<=through).sort((a,b)=>a.at.localeCompare(b.at));
 const legacy:ExecutionRecord[]=data.tasks.filter(t=>t.outcome&&(t.outcomeOn??t.completedOn)&&(t.outcomeOn??t.completedOn)!>=from&&(t.outcomeOn??t.completedOn)!<=through&&!records.some(r=>r.taskId===t.id&&r.date===(t.outcomeOn??t.completedOn))).map(t=>({id:'legacy:'+t.id,taskId:t.id,title:t.title,projectId:t.projectId,date:(t.outcomeOn??t.completedOn)!,at:(t.outcomeOn??t.completedOn)!+'T00:00:00Z',due:t.due,outcome:t.outcome!,reason:t.outcomeReason??'',estimate:t.outcomeEstimateMinutes??t.duration,actual:t.actualMinutes??null,impact:t.impact,buffer:null}));
 const latest=new Map<string,ExecutionRecord>();for(const r of [...records,...legacy])latest.set(r.taskId+':'+r.date,r);return {records,legacy,rows:[...latest.values()]};
}
