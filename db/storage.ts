import {env} from 'cloudflare:workers';
export type {Database} from './repository';
export function getDatabase(){if(!env.DB)throw new Error('Storage binding unavailable');return env.DB}
