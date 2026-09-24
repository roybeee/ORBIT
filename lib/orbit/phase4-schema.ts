import {z} from 'zod';
import {validDate} from './dates.ts';
const id=z.string().min(1).max(100),text=(n:number)=>z.string().trim().min(1).max(n),date=z.string().refine(validDate),month=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
// A null baseline means "not measured yet", never a measured 0. Adopt/retry/drop is the owner's call on a finished experiment.
const verdict=z.enum(['adopt','retry','drop']);
export const meetingBufferSchema=z.object({type:z.literal('meetingBuffer'),minutes:z.number().int().min(5).max(120)}).strict();
export const experimentSchema=z.object({id:z.string().min(1).max(80),title:text(160),projectId:id,noteId:id,noteRevision:z.number().int().positive(),hypothesis:text(2000),action:text(2000),metric:text(100),unit:text(30),baseline:z.number().finite().nullable(),target:z.number().finite(),direction:z.enum(['up','down']),from:date,through:date,minutes:z.number().int().min(5).max(480),parentId:z.string().min(1).max(80).optional(),baselineEvidence:text(2000).optional()}).strict();
export const storedExperimentSchema=experimentSchema.extend({taskId:id,status:z.enum(['active','completed','stopped']),createdAt:z.string().datetime(),result:z.object({value:z.number().finite(),evidence:text(2000),conclusion:text(2000),at:z.string().datetime(),met:z.boolean()}).optional(),baselineAt:z.string().datetime().optional(),decision:z.object({verdict,suggested:verdict.optional(),at:z.string().datetime(),ruleId:id.optional(),note:z.string().max(1000).optional()}).strict().optional()});
export const contactSchema=z.object({id,name:text(100),organization:z.string().max(150),role:z.string().max(100),aliases:z.array(text(100)).max(10),projectIds:z.array(id).max(30),noteIds:z.array(id).max(60),decisionIds:z.array(id).max(60),delegationIds:z.array(id).max(60),eventIds:z.array(id).max(60),memo:z.string().max(2000)}).strict();
export const storedContactSchema=contactSchema.extend({updatedAt:z.string().datetime()});
export const executionRecordSchema=z.object({id,taskId:id,title:text(160),projectId:id,date,at:z.string().datetime(),due:date,outcome:z.enum(['done','partial','skipped']),reason:z.string().max(30),estimate:z.number(),actual:z.number().nullable(),impact:z.number(),buffer:z.number().nullable()}).strict();
const recommendation=z.object({id,kind:z.enum(['stop','delegate','standardize']),title:text(500),evidence:z.array(text(500)).max(10),taskId:id.optional(),baseline:z.number(),measure:z.enum(['late','waiting','rework']),status:z.enum(['suggested','adopted','dismissed']),review:z.object({date,value:z.number().nonnegative(),note:text(1000)}).optional()}).strict();
export const monthlyReportSchema=z.object({id:month,createdAt:z.string().datetime(),through:date,sampleCount:z.number().int(),coverage:z.string(),summary:z.string(),metrics:z.object({done:z.number(),late:z.number(),waiting:z.number(),rework:z.number(),switches:z.number(),decisions:z.number(),minutes:z.number()}),recommendations:z.array(recommendation).max(9)}).strict();
export const phase4Actions=[
 z.object({type:z.literal('experiment.start'),experiment:experimentSchema}).strict(),
 z.object({type:z.literal('experiment.finish'),id,value:z.number().finite(),evidence:text(2000),conclusion:text(2000)}).strict(),
 z.object({type:z.literal('experiment.stop'),id}).strict(),
 z.object({type:z.literal('experiment.baseline'),id,value:z.number().finite(),evidence:text(2000),target:z.number().finite().optional()}).strict(),
 z.object({type:z.literal('experiment.decide'),id,verdict,note:z.string().max(1000).optional(),rule:z.object({id,rule:text(200),kind:z.enum(['buffer','placement','estimate','habit','decline','other']),effect:meetingBufferSchema.optional()}).strict().optional()}).strict(),
 z.object({type:z.literal('contact.upsert'),contact:contactSchema}).strict(),
 z.object({type:z.literal('contact.delete'),id}).strict(),
 z.object({type:z.literal('monthly.generate'),month}).strict(),
 z.object({type:z.literal('monthly.decide'),month,id,status:z.enum(['adopted','dismissed'])}).strict(),
 z.object({type:z.literal('monthly.review'),month,id,value:z.number().nonnegative(),note:text(1000)}).strict(),
] as const;
export type Experiment=z.infer<typeof storedExperimentSchema>;
export type Contact=z.infer<typeof storedContactSchema>;
export type ExecutionRecord=z.infer<typeof executionRecordSchema>;
export type MonthlyReport=z.infer<typeof monthlyReportSchema>;
