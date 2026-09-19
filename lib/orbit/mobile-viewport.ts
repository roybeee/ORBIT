// Visual viewport offsets matter when a mobile browser pans to a focused input.
// Resize only the overlay; reveal fields by scrolling its body, never the page.
export function trackMobileViewport(win: Window, doc: Document): () => void {
  const viewport = win.visualViewport;
  const root = doc.documentElement;
  let restingHeight = win.innerHeight;
  let width = win.innerWidth;
  let frame = 0, revealFrame = 0, revealRequested = false;
  const editable = () => {
    const active = doc.activeElement;
    return active?.matches('textarea,input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]),[contenteditable=true]') ? active as HTMLElement : null;
  };
  const reveal = () => {
    revealFrame = 0;
    if (win.innerWidth > 767 || (viewport?.scale ?? 1) > 1.05) return;
    const active = editable();
    if (!active?.closest('[data-slot=sheet-content],[data-slot=dialog-content]')) return;
    const body = active.closest<HTMLElement>('.sheet-body,.dialog-form');
    if (!body) return;
    const bounds = body.getBoundingClientRect(), field = active.getBoundingClientRect();
    const top = Math.max(bounds.top, viewport?.offsetTop ?? 0) + 16;
    const bottom = Math.min(bounds.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? win.innerHeight)) - 16;
    if (bottom <= top) return;
    // A tall text area must retain its first visible lines, not push its top offscreen.
    const delta = field.top < top || field.height > bottom - top ? field.top - top : Math.max(0, field.bottom - bottom);
    if (Math.abs(delta) > 1) body.scrollTop += delta;
  };
  const update = () => {
    frame = 0;
    if (Math.abs(win.innerWidth - width) > 100) { restingHeight = win.innerHeight; width = win.innerWidth; }
    const height = Math.max(1, viewport?.height ?? win.innerHeight);
    const top = Math.max(0, viewport?.offsetTop ?? 0);
    // Android may resize both viewports; compare against the last resting height too.
    if (!editable()) restingHeight = win.innerHeight;
    restingHeight = Math.max(restingHeight, win.innerHeight);
    const keyboard = (viewport?.scale ?? 1) <= 1.05 &&
      (win.innerHeight - height > 140 || (!!editable() && restingHeight - height > 140));
    root.style.setProperty('--phone-viewport-height', `${height}px`);
    root.style.setProperty('--phone-viewport-top', `${top}px`);
    root.dataset.keyboard = keyboard ? 'open' : 'closed';
    if (revealRequested) {
      revealRequested = false;
      if (revealFrame) win.cancelAnimationFrame(revealFrame);
      revealFrame = win.requestAnimationFrame(reveal);
    }
  };
  const schedule = (shouldReveal: boolean) => {
    revealRequested ||= shouldReveal;
    if (!frame) frame = win.requestAnimationFrame(update);
  };
  const resize = () => schedule(true);
  const pan = () => schedule(false);
  update();
  viewport?.addEventListener('resize', resize);
  viewport?.addEventListener('scroll', pan);
  win.addEventListener('resize', resize);
  doc.addEventListener('focusin', resize);
  doc.addEventListener('focusout', resize);
  return () => {
    if (frame) win.cancelAnimationFrame(frame);
    if (revealFrame) win.cancelAnimationFrame(revealFrame);
    viewport?.removeEventListener('resize', resize);
    viewport?.removeEventListener('scroll', pan);
    win.removeEventListener('resize', resize);
    doc.removeEventListener('focusin', resize);
    doc.removeEventListener('focusout', resize);
    root.style.removeProperty('--phone-viewport-height');
    root.style.removeProperty('--phone-viewport-top');
    delete root.dataset.keyboard;
  };
}
