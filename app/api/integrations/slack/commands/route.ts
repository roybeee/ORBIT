import {getDatabase} from '@/db/storage';
import {handleCommand} from '@/lib/orbit/slack/commands';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>handleCommand(getDatabase(),request);
export const POST=(request:Request)=>handleCommand(getDatabase(),request);
