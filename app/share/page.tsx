import {requireChatGPTUser} from '../chatgpt-auth';
import Workspace from '@/components/orbit/workspace';
export const dynamic='force-dynamic';
async function SharedWorkspace({draft}:{draft:string}){const user=await requireChatGPTUser('/share'+(draft?'?draft='+encodeURIComponent(draft):''));return <Workspace displayName={user.fullName??user.email}/>}
export default async function Page({searchParams}:{searchParams:Promise<{draft?:string}>}){const query=await searchParams,draft=typeof query.draft==='string'&&/^[0-9a-f-]{36}$/.test(query.draft)?query.draft:'';return <SharedWorkspace draft={draft}/>}
