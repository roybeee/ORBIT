import {getDatabase} from '@/db/storage';
import {handleSlackRequest} from '@/lib/orbit/slack/requests';
export const dynamic='force-dynamic';
export const POST=(request:Request)=>handleSlackRequest(getDatabase(),request);
