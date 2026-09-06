import {requireChatGPTUser} from './chatgpt-auth';
import Workspace from '@/components/orbit/workspace';
export const dynamic='force-dynamic';
export default async function Page(){const user=await requireChatGPTUser('/');return <Workspace displayName={user.fullName??user.email}/>}
