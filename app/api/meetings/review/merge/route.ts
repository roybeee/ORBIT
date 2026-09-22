import {z} from 'zod';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {meetingReviewDetail} from '@/lib/orbit/meetings/review-runtime';
import {mergeMeetingProposals} from '@/lib/orbit/meetings/merge';
export const dynamic='force-dynamic';
const target=z.union([z.object({kind:z.literal('proposal'),id:z.string().uuid()}).strict(),z.object({kind:z.enum(['task','event']),id:z.string().min(1).max(100)}).strict()]);
const input=z.object({noteId:z.string().min(1).max(100),actionId:z.string().uuid(),target}).strict();
export async function POST(request:Request){try{const user=await owner(request),parsed=input.safeParse(await body(request,1000));if(!parsed.success)throw new AgentError('통합할 결재안을 확인해 주세요.');await mergeMeetingProposals(getDatabase(),user.id,parsed.data.noteId,parsed.data.actionId,parsed.data.target);return json(await meetingReviewDetail(getDatabase(),user.id,parsed.data.noteId))}catch(e){return failure(e)}}
