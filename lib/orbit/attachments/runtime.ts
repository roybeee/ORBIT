import {env} from 'cloudflare:workers';
import {AgentError} from '../agent/errors';
export function getBucket(){if(!env.BUCKET)throw new AgentError('파일 저장소를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.','STORAGE',503);return env.BUCKET}
