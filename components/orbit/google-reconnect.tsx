'use client';
import {useState} from 'react';
import {Link2} from 'lucide-react';
import {clientRequest} from '@/lib/orbit/agent/client-request';

// A Google request refused because the stored grant no longer works (expired, revoked,
// or never connected): the place that failed offers the reconnect itself.
export const needsGoogleReconnect=(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&['RECONNECT','CONNECT'].includes(String((error as {code:unknown}).code));

// The Google sign-in returns to 일정; unsaved edits stay in this device's drafts.
export function GoogleReconnectButton({disabled=false}:{disabled?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const start=async()=>{setBusy(true);setError('');try{const data=await clientRequest('/api/integrations/connect','POST',{provider:'google_calendar'});const url=new URL(data.url);if(url.origin!=='https://accounts.google.com')throw new Error('연결 주소를 확인할 수 없습니다.');window.location.assign(url.href)}catch(e){setError(e instanceof Error?e.message:'Google 연결을 시작하지 못했습니다.');setBusy(false)}};
 return <><button type="button" className="primary-button" disabled={disabled||busy} onClick={()=>void start()}><Link2 size={16}/>{busy?'Google로 이동 중…':'Google 다시 연결'}</button>{error&&<p className="agent-error" role="alert">{error}</p>}</>;
}
