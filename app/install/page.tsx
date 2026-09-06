import type {Metadata} from 'next';
import {requireChatGPTUser} from '../chatgpt-auth';
import InstallApp from '@/components/orbit/install-app';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Orbit 설치 · 나의 운영실을 홈 화면으로'};
export default async function InstallPage(){await requireChatGPTUser('/install');return <InstallApp/>}
