// Bounded scheduled wake-up for Orbit. No personal content leaves Orbit.
const url = new URL(process.env.ORBIT_RUNTIME_TICK_URL ?? '');
if (url.protocol !== 'https:' || !url.hostname.endsWith('.chatgpt.site') || url.pathname !== '/api/runtime/tick' || url.search || url.hash || url.username || url.password) throw new Error('Invalid Orbit runtime URL');
if (!process.env.ORBIT_RUNTIME_TICK_TOKEN || !process.env.ORBIT_SITES_BEARER) throw new Error('Orbit runtime credentials missing');
const deadline = Date.now() + 50000;
for (let step = 0; step < 12; step++) {
  const response = await fetch(url.href, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(150000),
    headers: { 'Content-Type': 'application/json', 'x-orbit-runtime-key': process.env.ORBIT_RUNTIME_TICK_TOKEN, 'OAI-Sites-Authorization': 'Bearer ' + process.env.ORBIT_SITES_BEARER }, body: '{}',
  }).catch(() => { throw new Error('Orbit runtime transport failed'); });
  if (!response.ok) throw new Error('Orbit runtime HTTP ' + response.status);
  const result = await response.json();
  if (!result.active || result.busy || Date.now() >= deadline) break;
  await new Promise(resolve => setTimeout(resolve, 3000));
}
console.info('Orbit runtime wake-up complete');
