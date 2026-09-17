import {z} from 'zod';
import {validDate} from './dates.ts';
const id=z.string().min(1).max(100),text=(n:number)=>z.string().trim().min(1).max(n);
const date=z.string().refine(validDate,'유효한 날짜를 입력해 주세요.');
export const protectedBlockSchema=z.object({id,title:text(160),date,start:z.number().int().min(0).max(1439),end:z.number().int().min(1).max(1440)}).strict().refine(b=>b.end>b.start,'보호 시간의 시작과 종료를 확인해 주세요.');
export const allocationSchema=z.object({projectId:id,minutes:z.number().int().min(0).max(10080),stance:z.enum(['focus','maintain','pause']),reason:text(500)}).strict();
export const weeklyAllocationSchema=z.object({id,from:date,through:date,approvedAt:z.string().datetime(),active:z.boolean(),capacityAtApproval:z.number().int().nonnegative(),allocations:z.array(allocationSchema).max(500),protectedBlocks:z.array(protectedBlockSchema).max(21)}).strict();
export const metricSchema=z.object({collector:z.object({enabled:z.boolean().optional(),provider:z.literal('oda'),storeId:id,field:z.enum(['revenue','expenses','profit']),month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)}).strict().optional(),id,projectId:id,name:text(100),category:z.enum(['sales','cost','evidence','people','contract']),unit:text(20),badDirection:z.enum(['up','down']),thresholdPercent:z.number().min(0).max(10000),thresholdAbsolute:z.number().finite().min(0).max(1e15),maxAgeDays:z.number().int().min(1).max(366),assignee:z.string().trim().max(100)}).strict();
export const observationSchema=z.object({id,metricId:id,from:date,through:date,value:z.number().finite().min(-1e15).max(1e15),source:text(1000),noteId:id.optional(),noteRevision:z.number().int().positive().optional(),supersedesId:id.optional()}).strict();
export const signalFollowupSchema=z.object({id,metricId:id,observationId:id,baselineId:id,taskId:id.optional(),delegationId:id.optional(),question:text(1000),status:z.enum(['open','resolved','dismissed']),resolution:z.string().max(2000),createdAt:z.string().datetime(),updatedAt:z.string().datetime()}).strict();
export const meetingEventSchema=z.object({id:z.string().min(1).max(500),title:text(160),date,start:z.number().int().min(0).max(1439),end:z.number().int().min(1).max(1440)}).strict().refine(e=>e.end>e.start);
export const meetingRecordSchema=z.object({id,projectId:id,event:meetingEventSchema,noteId:id,noteRevision:z.number().int().positive(),summary:text(2000),changedConditions:z.string().max(2000),priorDecisions:z.array(z.object({id,title:text(160),choice:text(2000),updatedAt:z.string().datetime()}).strict()).max(12),decisionId:id.optional(),decisionSnapshot:z.object({choice:text(2000),rationale:text(2000)}).strict().optional(),taskIds:z.array(id).max(12),delegationIds:z.array(id).max(12),createdAt:z.string().datetime()}).strict();
export const phase3Actions=[
  z.object({type:z.literal('portfolio.approve'),week:date,basis:text(100),allocations:z.array(allocationSchema).max(500),protectedBlocks:z.array(protectedBlockSchema).max(21)}).strict(),
  z.object({type:z.literal('portfolio.release'),id}).strict(),
  z.object({type:z.literal('metric.upsert'),metric:metricSchema}).strict(),
  z.object({type:z.literal('metric.observe'),observation:observationSchema}).strict(),
  z.object({type:z.literal('signal.followup'),id:z.string().uuid(),metricId:id,observationId:id,baselineId:id,title:text(160),assignee:z.string().trim().max(100),due:date,question:text(1000)}).strict(),
  z.object({type:z.literal('signal.resolve'),id,status:z.enum(['resolved','dismissed']),resolution:text(2000)}).strict(),
  z.object({type:z.literal('meeting.finish'),id:z.string().uuid(),projectId:id,event:meetingEventSchema,summary:text(2000),changedConditions:z.string().max(2000),body:text(80000),decision:z.object({choice:text(2000),rationale:text(2000),reviewDate:date}).strict().optional(),actions:z.array(z.object({title:text(160),assignee:z.string().trim().max(100),due:date,minutes:z.number().int().min(5).max(480)}).strict()).max(12)}).strict(),
] as const;
