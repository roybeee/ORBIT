import type {Metadata} from 'next';
import {requireChatGPTUser} from '../chatgpt-auth';
import InstallApp from '@/components/orbit/install-app';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Orbit 설치 · Mac, Windows, 휴대폰'};
export default async function InstallPage(){await requireChatGPTUser('/install');return <InstallApp/>}
