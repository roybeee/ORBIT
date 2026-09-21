import {env} from 'cloudflare:workers';
import {APP_BUILD} from '@/lib/orbit/app-version';
import {deploymentHealth} from '@/lib/orbit/deployment-health';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const runtime = env as typeof env & {ORBIT_RELEASE_HEALTH_TOKEN?: string};
  return deploymentHealth(request, runtime.ORBIT_RELEASE_HEALTH_TOKEN, APP_BUILD);
}
