// A same-URL history entry makes Android/browser Back dismiss a transient view
// before the workspace's normal route listener can leave the current list.
const marker = '__orbitOverlay';
type Browser = Pick<Window, 'history' | 'location' | 'addEventListener' | 'removeEventListener'>;

export function createOverlayHistory(browser: Browser) {
  let active: { token: string; url: string; base: unknown; dismiss: () => void } | null = null;
  let afterClose: (() => void) | null = null;
  let closing = false;

  function pop(event: Event) {
    const entry = active;
    if (!entry || browser.history.state?.[marker] === entry.token) return;
    active = null;
    closing = false;
    const next = afterClose;
    afterClose = null;
    // A real route traversal still belongs to the workspace router.
    const samePage = browser.location.href === entry.url;
    if (samePage) event.stopImmediatePropagation();
    entry.dismiss();
    if (samePage) next?.();
  }
  browser.addEventListener('popstate', pop, true);

  return {
    open(dismiss: () => void) {
      if (active) return false;
      const base = browser.history.state;
      const token = crypto.randomUUID();
      browser.history.pushState({ ...base, [marker]: token }, '', browser.location.href);
      active = { token, url: browser.location.href, base, dismiss };
      return true;
    },
    close(next?: () => void) {
      if (!active) { next?.(); return; }
      if (closing) return;
      if (browser.history.state?.[marker] !== active.token) {
        const entry = active;
        active = null;
        entry.dismiss();
        next?.();
        return;
      }
      // Wait for traversal before opening details or navigating after a save.
      // Otherwise the delayed popstate could close the newly opened screen.
      closing = true;
      afterClose = next ?? null;
      browser.history.back();
    },
    dispose() {
      browser.removeEventListener('popstate', pop, true);
      if (active && browser.history.state?.[marker] === active.token) {
        browser.history.replaceState(active.base, '', browser.location.href);
      }
      active = null;
      afterClose = null;
    },
  };
}
