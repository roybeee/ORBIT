import {requireChatGPTUser} from '../chatgpt-auth';
import Workspace from '@/components/orbit/workspace';
export const dynamic='force-dynamic';
export default async function Demo(){const user=await requireChatGPTUser('/demo');return <Workspace demo displayName={user.fullName??user.email}/>}
