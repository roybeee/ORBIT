import {env} from 'cloudflare:workers';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {orderInput} from '@/lib/orbit/agent/orders-schema';
import {listOrders,orderCapabilities,dispatchOrder,advanceOrder} from '@/lib/orbit/agent/orders';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await owner(),db=getDatabase();return json(new URL(request.url).searchParams.has('capabilities')?await orderCapabilities(db,user.id,env):{orders:await listOrders(db,user.id)})}catch(e){return failure(e)}}
export async function POST(request:Request){try{const user=await owner(request),input=orderInput.safeParse(await body(request));if(!input.success)throw new AgentError('업무 지시와 대상 항목을 확인해 주세요.');const value=input.data;return json({order:value.action==='dispatch'?await dispatchOrder(getDatabase(),user.id,value.id,value.order,env,value.conversationId):await advanceOrder(getDatabase(),user.id,value.id,env,value)})}catch(e){return failure(e)}}
