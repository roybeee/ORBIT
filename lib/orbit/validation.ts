import {z} from 'zod';
import {validDate} from './dates.ts';
const id=z.string().min(1).max(100);
export const dateSchema=z.string().refine(validDate,'유효한 날짜를 입력해 주세요.');
const title=z.string().trim().min(1,'제목을 입력해 주세요.').max(160);
export const projectSchema=z.object({id,name:title,color:z.string().regex(/^#[0-9a-fA-F]{6}$/),symbol:z.string().min(1).max(3),goal:z.string().max(4000),due:dateSchema,priority:z.number().int().min(1).max(5)}).strict();
export const taskSchema=z.object({id,title,projectId:id,status:z.enum(['todo','doing','waiting','done']),duration:z.number().int().min(5).max(480),due:dateSchema,impact:z.number().int().min(1).max(5),focus:z.boolean(),focusDate:dateSchema.optional(),definition:z.string().max(4000),noteId:id.optional(),noteCitation:z.object({revision:z.number().int().positive(),line:z.number().int().positive(),quote:z.string().max(2000)}).strict().optional(),blocker:z.string().max(2000).optional(),checkDate:dateSchema.optional(),completedOn:dateSchema.optional(),dependsOn:z.array(id).max(30).optional(),result:z.string().max(4000).optional(),planHoldUntil:dateSchema.optional(),planHoldReason:z.string().max(2000).optional(),planHoldProposalId:id.optional()}).strict();
export const noteSchema=z.object({id,title,kind:z.enum(['meeting','wiki','knowledge']),projectId:id,summary:z.string().max(500),body:z.string().max(100000),tags:z.array(z.string().max(40)).max(20),updated:dateSchema}).strict();
export const eventSchema=z.object({id,title,date:dateSchema,start:z.number().int().min(0).max(1439),end:z.number().int().min(1).max(1440),kind:z.enum(['meeting','focus','break']),projectId:id.optional(),taskId:id.optional()}).strict().refine(e=>e.end>e.start,'종료 시간은 시작 시간보다 늦어야 합니다.');
export const preferencesSchema=z.object({timeZone:z.string().refine(value=>{try{new Intl.DateTimeFormat('ko',{timeZone:value});return true}catch{return false}},'시간대를 확인해 주세요.'),workStart:z.number().int().min(0).max(1439),workEnd:z.number().int().min(1).max(1440),workDays:z.array(z.number().int().min(0).max(6)).min(1).max(7),focusLimit:z.number().int().min(1).max(5),breakMinutes:z.number().int().min(0).max(60),bufferFraction:z.number().min(.1).max(.5)}).strict().refine(p=>p.workEnd>p.workStart,'업무 종료 시간은 시작 시간 이후여야 합니다.');
const energy=z.enum(['low','normal','high']);
const review=z.object({date:dateSchema,win:z.string().max(6000),block:z.string().max(6000),energy}).strict();
export const actionSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('project.upsert'),project:projectSchema}).strict(),
 z.object({type:z.literal('project.delete'),id}).strict(),
 z.object({type:z.literal('task.upsert'),task:taskSchema}).strict(),
 z.object({type:z.literal('task.status'),id,status:z.enum(['todo','doing','waiting','done'])}).strict(),
 z.object({type:z.literal('task.focus'),id,focus:z.boolean()}).strict(),
 z.object({type:z.literal('task.delete'),id}).strict(),
 z.object({type:z.literal('note.upsert'),note:noteSchema,expectedNoteRevision:z.number().int().positive().optional()}).strict(),
 z.object({type:z.literal('note.delete'),id}).strict(),
 z.object({type:z.literal('note.restore'),id,revision:z.number().int().positive(),expectedNoteRevision:z.number().int().positive()}).strict(),
 z.object({type:z.literal('meeting.acceptActions'),noteId:id,expectedNoteRevision:z.number().int().positive(),items:z.array(z.object({id,line:z.number().int().positive(),title,definition:z.string().max(4000),due:dateSchema,duration:z.number().int().min(5).max(480)}).strict()).min(1).max(20)}).strict(),
 z.object({type:z.literal('event.upsert'),event:eventSchema}).strict(),
 z.object({type:z.literal('event.delete'),id}).strict(),
 z.object({type:z.literal('review.saveGenerate'),review}).strict(),
 z.object({type:z.literal('proposal.generate'),date:dateSchema,energy}).strict(),
 z.object({type:z.literal('proposal.approve'),date:dateSchema,itemId:id}).strict(),
 z.object({type:z.literal('proposal.defer'),date:dateSchema,itemId:id,reason:z.string().trim().min(1).max(2000),revisitDate:dateSchema}).strict(),
 z.object({type:z.literal('proposal.reconsider'),date:dateSchema,itemId:id}).strict(),
 z.object({type:z.literal('proposal.revoke'),date:dateSchema,itemId:id}).strict(),
 z.object({type:z.literal('preferences.update'),preferences:preferencesSchema}).strict(),
]);
export type WorkspaceAction=z.infer<typeof actionSchema>;
export const commandSchema=z.object({operationId:z.string().uuid(),expectedRevision:z.number().int().nonnegative(),action:actionSchema}).strict();
