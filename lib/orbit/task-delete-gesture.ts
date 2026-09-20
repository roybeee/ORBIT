// Keep the release threshold reachable on narrow mobile cards, but deliberate.
export function taskDeleteDrag(dx: number, dy: number, width: number) {
  const threshold = Math.max(72, Math.min(120, width * .4));
  return {
    offset: Math.max(0, Math.min(width, dx)),
    ready: dx >= threshold && Math.abs(dy) < Math.max(60, dx * .6),
  };
}
