import {z} from 'zod';
import {readWorkspace,writeCommand,type Database} from '../../db/repository.ts';
import {readOda,odaRequest,ODA_ORIGIN} from './automation/connection.ts';
import type {Runtime} from './agent/integrations.ts';
import {recordSource} from './source-status.ts';
import {AgentError} from './agent/errors.ts';
import {digest} from './backup.ts';
import {validDate,todayInZone} from './dates.ts';
const response=z.object({version:z.literal(1),storeId:z.string(),month:z.string(),currency:z.literal('KRW'),status:z.enum(['missing','draft','finalized','paid']),recordVersion:z.number().int().nonnegative().optional(),updatedAt:z.string().optional(),period:z.object({from:z.string().refine(validDate),through:z.string().refine(validDate)}).optional(),values:z.object({revenue:z.number().finite().min(-1e15).max(1e15).optional(),expenses:z.number().finite().min(-1e15).max(1e15).optional(),profit:z.number().finite().min(-1e15).max(1e15).optional()}).nullable(),quality:z.object({finalized:z.boolean()}).passthrough().optional()});
export async function collectMetrics(db:Database,owner:string,env:Runtime,cursor=0){
 const snapshot=await readWorkspace(db,owner),all=(snapshot.data.operatingMetrics??[]).filter(m=>m.collector&&m.collector.enabled!==false);
 if(!all.length)return {count:0,detail:'지표의 ODA 매장·정산월을 먼저 연결하세요.'};
 const target=all[cursor%all.length],mapping=target.collector!,provider='oda_metric:'+target.id;
 try{
  const connection=await readOda(db,owner,env);if(!connection)throw new AgentError('서버 자동화에서 ODA 연결 키를 먼저 등록하세요.');
  const result=response.safeParse(await odaRequest(connection,`/metrics?storeId=${encodeURIComponent(mapping.storeId)}&month=${mapping.month}`));if(!result.success)throw new AgentError('ODA 수치 응답 버전을 확인할 수 없습니다.');const r=result.data;
  if(r.storeId!==mapping.storeId||r.month!==mapping.month)throw new AgentError('ODA 조회 범위와 응답이 다릅니다.');
  if(r.status==='missing'||r.status==='draft'){const detail=r.status==='missing'?'정산 자료가 없습니다. 0으로 기록하지 않았습니다.':'정산이 아직 미확정입니다. 확정 후 수집합니다.';await recordSource(db,owner,provider,{state:'partial',detail,count:0});return {count:0,detail};}
  const monthEnd=new Date(Date.UTC(Number(mapping.month.slice(0,4)),Number(mapping.month.slice(5,7)),0)).toISOString().slice(0,10);
  if(!r.quality?.finalized||r.recordVersion===undefined||!r.period||r.period.from!==mapping.month+'-01'||r.period.through!==monthEnd||r.period.through>todayInZone(snapshot.data.preferences.timeZone))throw new AgentError('확정된 정산 기간과 버전을 확인할 수 없습니다.');
  const value=r.values?.[mapping.field];if(value===undefined)throw new AgentError('현재 ODA 연결 키에 선택한 수치를 읽을 권한이 없습니다.');
  const current=await readWorkspace(db,owner),metric=current.data.operatingMetrics?.find(m=>m.id===target.id);if(!metric||JSON.stringify(metric)!==JSON.stringify(target))throw new AgentError('수집 중 지표 연결이 변경되었습니다. 다시 확인하세요.');
  const superseded=new Set(current.data.metricObservations?.map(o=>o.supersedesId));const old=current.data.metricObservations?.find(o=>o.metricId===metric.id&&o.from===r.period!.from&&o.through===r.period!.through&&!superseded.has(o.id));
  if(!old||old.value!==value){const id='oda:'+ (await digest([metric.id,mapping,r.recordVersion,r.updatedAt,value,old?.id])).slice(0,60);await writeCommand(db,owner,{operationId:id,expectedRevision:current.revision,action:{type:'metric.observe',observation:{id,metricId:metric.id,from:r.period.from,through:r.period.through,value,source:`ODA 확정 정산 · ${mapping.storeId} · ${mapping.month} · ${mapping.field} · v${r.recordVersion} · ${ODA_ORIGIN}`,supersedesId:old?.id}}});}
  const detail=`${metric.name} · ${mapping.month} 확정 수치 확인 · v${r.recordVersion}`;await recordSource(db,owner,provider,{state:'ok',detail,count:old?.value===value?0:1});return {count:old?.value===value?0:1,detail};
 }catch(e){await recordSource(db,owner,provider,{state:'error',detail:e instanceof AgentError?e.message:'수치 저장을 완료하지 못했습니다. 다음 수집에서 재확인합니다.'});throw e;}
}
