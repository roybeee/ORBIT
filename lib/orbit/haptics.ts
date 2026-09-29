// Keep feedback short and share one cooldown across taps, swipes and holds.
const duration={tap:10,selection:18,hold:18} as const;
const COOLDOWN_MS=80;
let lastPulse=-Infinity;
export function haptic(kind:keyof typeof duration='tap'):boolean{
 if(typeof window==='undefined'||typeof navigator==='undefined'||typeof document==='undefined')return false;
 try{
  if(document.hidden||typeof navigator.vibrate!=='function'||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return false;
  const now=performance.now();
  if(now-lastPulse<COOLDOWN_MS)return false;
  if(!navigator.vibrate(duration[kind]))return false;
  lastPulse=now;
  return true;
 }catch{return false;}
}
