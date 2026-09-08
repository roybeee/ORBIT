import {z} from 'zod';

export const orderActionSchema=z.object({
 type:z.literal('agent.dispatch'),
 title:z.string().trim().min(1).max(160),
 instruction:z.string().trim().min(1).max(8000),
 projectId:z.string().min(1).max(100).nullable().default(null),
 taskIds:z.array(z.string().min(1).max(100)).max(12).default([]),
}).strict();
export type DispatchAction=z.infer<typeof orderActionSchema>;
export const orderInput=z.discriminatedUnion('action',[
 z.object({action:z.literal('dispatch'),id:z.string().uuid(),order:orderActionSchema,conversationId:z.string().min(1).max(100).optional()}).strict(),
 z.object({action:z.enum(['poll','stop']),id:z.string().uuid()}).strict(),
 z.object({action:z.literal('steer'),id:z.string().uuid(),input:z.string().trim().min(1).max(4000)}).strict(),
 z.object({action:z.literal('approval'),id:z.string().uuid(),requestId:z.string().min(1).max(200),choice:z.enum(['once','deny'])}).strict(),
]);
export type OrderStatus='queued'|'submitting'|'running'|'waiting_for_approval'|'stopping'|'completed'|'failed'|'cancelled'|'unknown';
export interface WorkOrder {
 id:string;title:string;instruction:string;projectId:string|null;taskIds:string[];conversationId:string|null;
 status:OrderStatus;runId:string|null;output:string;error:string;createdAt:string;updatedAt:string;
 approval:null|{id:string;description:string};
 controls:{steer:boolean;approval:boolean};
 activity:{at:string;text:string}[];
}
export const orderStatusLabel:Record<OrderStatus,string>={queued:'접수 대기',submitting:'접수 확인 중',running:'실행 중',waiting_for_approval:'실행 승인 대기',stopping:'중지 확인 중',completed:'실행 종료 · 결과 검토',failed:'실행 실패',cancelled:'중지됨',unknown:'실행 기록 확인 필요'};
export const orderActive=(status:OrderStatus)=>!['completed','failed','cancelled','unknown'].includes(status);
