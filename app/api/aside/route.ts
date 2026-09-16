import { getDatabase } from '@/db/storage';
import { owner, body, json, failure, AgentError } from '@/lib/orbit/agent/http';
import { asideInput, listAsideJobs, changeAsideJob } from '@/lib/orbit/aside/jobs';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await owner();return json({jobs:await listAsideJobs(getDatabase(),user.id)})}catch(error){return failure(error)}}
export async function POST(request:Request){try{const user=await owner(request),input=asideInput.safeParse(await body(request,100000));if(!input.success)throw new AgentError('업무 입력을 확인해 주세요.');return json({job:await changeAsideJob(getDatabase(),user.id,input.data)})}catch(error){return failure(error)}}
