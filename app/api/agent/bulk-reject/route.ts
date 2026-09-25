import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {bulkRejectSchema,rejectActions,BULK_REJECT_LIMIT} from '@/lib/orbit/agent/bulk-reject';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{const user=await owner(request),parsed=bulkRejectSchema.safeParse(await body(request,BULK_REJECT_LIMIT*40+100));if(!parsed.success)throw new AgentError(`반려할 결재안을 ${BULK_REJECT_LIMIT}건 이내로 골라 주세요.`);return json(await rejectActions(getDatabase(),user.id,parsed.data.ids))}catch(e){return failure(e)}}
