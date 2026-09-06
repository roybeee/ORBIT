import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {getChatGPTUser,safeRelativeReturnPath} from '@/app/chatgpt-auth';
import {Orbit,ArrowRight,RefreshCw} from 'lucide-react';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Orbit · 계정 연결 확인'};

export default async function RecoverPage({searchParams}:{searchParams:Promise<{return_to?:string}>}){
 const params=await searchParams;
 const returnTo=safeRelativeReturnPath(typeof params.return_to==='string'?params.return_to:'/');
 return <Recovery returnTo={returnTo}/>;
}
async function Recovery({returnTo}:{returnTo:string}){
 if(await getChatGPTUser())redirect(returnTo);
 return <main className="account-recovery"><div className="install-logo"><Orbit size={36}/></div><h1>기존 계정에 다시 연결해 주세요</h1><p>설치된 앱에 계정 정보가 모두 전달되지 않았습니다. 저장된 기록은 그대로 보관되어 있습니다.</p><ol><li>이 앱을 만든 <strong>ChatGPT 대화의 Orbit 화면</strong>을 한 번 열어 주세요.</li><li>그다음 이 창으로 돌아와 아래 버튼을 누르세요.</li></ol><a className="primary-button" href={returnTo}><RefreshCw size={18}/>Orbit 다시 열기</a><a className="text-button" href="https://chatgpt.com" target="_blank" rel="noopener noreferrer">ChatGPT 열기<ArrowRight size={16}/></a><p className="form-hint">다른 계정의 기록으로 연결하지 않도록 계정을 확인합니다. 같은 화면이 계속 보이면 ChatGPT에서 Orbit을 사용해 주세요.</p></main>;
}
