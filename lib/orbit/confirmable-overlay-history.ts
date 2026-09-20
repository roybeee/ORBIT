import {createOverlayHistory} from './overlay-history.ts';

type Browser = Pick<Window,'history'|'location'|'addEventListener'|'removeEventListener'>;
type Callbacks = {
  blocked: () => boolean;
  onConfirmChange: (open: boolean) => void;
  onClose: () => void;
  onDiscard: () => void;
};

// Back first asks about the unsaved form. Keep one boundary while the form or
// its confirmation is open so cancellation and repeated Back cannot leave it.
export function createConfirmableOverlayHistory(browser: Browser, callbacks: Callbacks) {
  const boundary=createOverlayHistory(browser);
  let active=false, confirming=false, finishing=false, url='';
  function requestClose() {
    if(!active||finishing||callbacks.blocked())return;
    confirming=true;
    callbacks.onConfirmChange(true);
  }
  function cancel() {
    if(finishing)return;
    confirming=false;
    callbacks.onConfirmChange(false);
  }
  function dismiss() {
    if(finishing||browser.location.href!==url){
      active=false;finishing=false;confirming=false;
      callbacks.onConfirmChange(false);
      callbacks.onClose();
      return;
    }
    boundary.open(dismiss);
    if(callbacks.blocked())return;
    if(confirming)cancel();else requestClose();
  }
  function finish(next?:()=>void) {
    if(finishing)return;
    if(!active){next?.();return;}
    finishing=true;
    boundary.close(next);
  }
  return {
    open() {
      if(active)return false;
      url=browser.location.href;
      active=boundary.open(dismiss);
      return active;
    },
    requestClose,
    cancel,
    discard() {
      if(!confirming||callbacks.blocked())return;
      finish(callbacks.onDiscard);
    },
    finish,
    dispose(){boundary.dispose();active=false;finishing=false;confirming=false;},
  };
}
