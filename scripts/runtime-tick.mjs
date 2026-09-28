// Bounded scheduled wake-up for Orbit. No personal content leaves Orbit.
import {pathToFileURL} from 'node:url';

export async function runRuntimeTick({env=process.env,fetchImpl=fetch,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),log=console}={}) {
  const url = new URL(env.ORBIT_RUNTIME_TICK_URL ?? '');
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.chatgpt.site') || url.pathname !== '/api/runtime/tick' || url.search || url.hash || url.username || url.password) throw new Error('Invalid Orbit runtime URL');
  if (!env.ORBIT_RUNTIME_TICK_TOKEN || !env.ORBIT_SITES_BEARER) throw new Error('Orbit runtime credentials missing');
  const deadline = now() + 50000;
  // Recovery is bounded across the entire wake-up, not reset for each active step.
  const recoveryDeadline = now() + 180000;
  let retries = 0;
  for (let step = 0; step < 12; step++) {
    let response;
    for (;;) {
      const remaining = recoveryDeadline - now();
      if (remaining <= 0) throw new Error('Orbit runtime recovery deadline exceeded');
      response = await fetchImpl(url.href, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(Math.min(150000, remaining)),
        headers: { 'Content-Type': 'application/json', 'x-orbit-runtime-key': env.ORBIT_RUNTIME_TICK_TOKEN, 'OAI-Sites-Authorization': 'Bearer ' + env.ORBIT_SITES_BEARER }, body: '{}',
      }).catch(() => { throw new Error('Orbit runtime transport failed'); });
      if (response.ok) break;
      const status=response.status;
      // Release an error response without logging its possibly sensitive body.
      await response.body?.cancel().catch(()=>{});
      const delay=1000*2**retries;
      if (![502,503,504].includes(status) || retries>=2 || now()+delay>=recoveryDeadline) throw new Error('Orbit runtime HTTP ' + status);
      retries++;
      log.warn(`Orbit runtime HTTP ${status}; retry ${retries}/2`);
      await sleep(delay);
    }
    const result = await response.json();
    if (!result.active || result.busy || now() >= deadline) break;
    await sleep(3000);
  }
  log.info('Orbit runtime wake-up complete');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runRuntimeTick();
