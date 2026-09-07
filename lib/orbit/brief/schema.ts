import {z} from 'zod';
const text=(max:number)=>z.string().trim().min(1).max(max);
const evidence=z.array(text(180)).min(1).max(6);
export const briefContentSchema=z.object({
 headline:text(180),assessment:text(700),
 progress:z.array(z.object({text:text(260),evidence}).strict()).max(4),
 priorities:z.array(z.object({projectId:text(100),taskId:text(100).optional(),title:text(160),outcome:text(400),whyNow:text(400),approach:z.array(text(240)).min(1).max(3),minutes:z.number().int().min(5).max(480),cognition:z.enum(['high','mid','low','external']).optional(),quadrant:z.enum(['A','B','C','D']).optional(),evidence}).strict()).max(3),
 tradeoffs:z.array(z.object({title:text(160),reason:text(300),evidence}).strict()).max(3),
 risks:z.array(z.object({risk:text(240),response:text(300),evidence}).strict()).max(3),
 success:text(400),questions:z.array(text(200)).max(3),
}).strict();
export type BriefContent=z.infer<typeof briefContentSchema>;
export interface BriefEvidence {id:string;kind:'project'|'task'|'note'|'review'|'event'|'conversation'|'plaud';recordId:string;title:string;date?:string;revision?:number;excerpt?:string}
export interface BriefCoverage {projects:number;tasks:number;completed:number;incomplete:number;notes:number;noteBodies:number;reviews:number;events:number;conversations:number;warnings:string[];google:string;plaud:string}
export interface DailyBrief extends BriefContent {date:string;cutoff:string;generatedAt:string;sourceRevision:number;sourceTurnId:string;coverage:BriefCoverage;evidence:BriefEvidence[]}
export interface PlanningRequest {date:string;energy:'low'|'normal'|'high'}
export interface BriefRun {id:string;status:'running'|'completed'|'failed';progress?:string;error?:string}
export const briefMessage=(request:PlanningRequest)=>`원페이지 실행 제안 · ${request.date} · ${request.energy}`;
