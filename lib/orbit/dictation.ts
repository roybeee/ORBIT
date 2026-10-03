// Some Android speech engines report the whole sentence so far as each new final result
// ("내일", "내일 3시", "내일 3시 미팅"); keep the longest instead of repeating it.
const squash = (t: string) => t.replace(/\s+/g, '');
export function mergeFinals(list: string[]): string {
  const out: string[] = [];
  for (const raw of list) {
    const t = raw.trim();
    if (!t) continue;
    const last = out.at(-1);
    if (last && squash(t).startsWith(squash(last))) out[out.length - 1] = t;
    else if (last && squash(last).endsWith(squash(t))) continue;
    else out.push(t);
  }
  return out.join(' ');
}
