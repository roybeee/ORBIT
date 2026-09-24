import {getDatabase} from '@/db/storage';
import {handleGotem} from '@/lib/orbit/slack/gotem-http';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>handleGotem(getDatabase(),request);
export const POST=(request:Request)=>handleGotem(getDatabase(),request);
