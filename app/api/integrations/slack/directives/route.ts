import {getDatabase} from '@/db/storage';
import {handleDirective} from '@/lib/orbit/slack/directives';
export const GET=(request:Request)=>handleDirective(getDatabase(),request);
export const POST=(request:Request)=>handleDirective(getDatabase(),request);
