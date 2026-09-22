import {env} from 'cloudflare:workers';
import {getDatabase} from '@/db/storage';
import {provisionSlackCredential} from '@/lib/orbit/slack/provisioning';
export const dynamic='force-dynamic';
export async function POST(request:Request){return provisionSlackCredential(getDatabase(),request,env as typeof env & {ORBIT_SLACK_PROVISION_AUTH_HASH?:string;ORBIT_SLACK_PROVISION_MANIFEST?:string})}
export const GET=POST;
