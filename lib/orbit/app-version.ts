// Vite injects one identifier into the server and client during the same build.
declare const __ORBIT_BUILD_ID__: string;
export const APP_BUILD = typeof __ORBIT_BUILD_ID__ === 'undefined' ? 'development' : __ORBIT_BUILD_ID__;

export async function availableUpdate(current: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetcher('/api/version', {
      credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok || response.redirected || !response.headers.get('content-type')?.includes('application/json')) return null;
    const value = await response.json();
    return typeof value.build === 'string' && /^[\w.:-]{1,100}$/.test(value.build) && value.build !== current
      ? value.build : null;
  } catch { return null; }
}
