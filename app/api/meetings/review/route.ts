import {env} from 'cloudflare:workers';
import {after} from 'next/server';
import {z} from 'zod';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {requestMeetingReview,processMeetingReviews,meetingReviewDetail,setMeetingDue} from '@/lib/orbit/meetings/review-runtime';
export const dynamic='force-dynamic';
const input=z.object({noteId:z.string().min(1).max(100),retry:z.boolean().optional()}).strict();
async function drive(user:string,noteId:string){await processMeetingReviews(getDatabase(),user,env,noteId);}
export async function GET(request:Request){try{const user=await owner(),noteId=new URL(request.url).searchParams.get('noteId');if(!noteId||noteId.length>100)throw new AgentError('회의록을 선택해 주세요.');const detail=await meetingReviewDetail(getDatabase(),user.id,noteId);if(['not_started','queued','running'].includes(detail.status)||detail.stale)after(()=>drive(user.id,noteId).catch(()=>{}));return json(detail)}catch(e){return failure(e)}}
export async function POST(request:Request){try{const user=await owner(request),parsed=input.safeParse(await body(request,1000));if(!parsed.success)throw new AgentError('회의록 요청을 확인해 주세요.');await requestMeetingReview(getDatabase(),user.id,parsed.data.noteId,parsed.data.retry);after(()=>drive(user.id,parsed.data.noteId).catch(()=>{}));return json(await meetingReviewDetail(getDatabase(),user.id,parsed.data.noteId))}catch(e){return failure(e)}}

export async function PATCH(request:Request){try{const user=await owner(request),parsed=z.object({noteId:z.string().min(1).max(100),actionId:z.string().uuid(),due:z.string().max(10)}).strict().safeParse(await body(request,1000));if(!parsed.success)throw new AgentError('결재안 수정 내용을 확인해 주세요.');await setMeetingDue(getDatabase(),user.id,parsed.data.noteId,parsed.data.actionId,parsed.data.due);return json(await meetingReviewDetail(getDatabase(),user.id,parsed.data.noteId))}catch(e){return failure(e)}}
