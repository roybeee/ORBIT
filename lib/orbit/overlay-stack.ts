// All popup primitives share one route boundary. Only the top popup receives
// Back; history cleanup waits for same-turn popup replacements to settle.
type Browser=Pick<Window,'history'|'location'|'addEventListener'|'removeEventListener'>;
const marker='__orbitPopupStack';
type Boundary={token:string;base:unknown;url:string;target:string};
export function createOverlayStack(browser:Browser,dispatch:(fn:()=>void)=>void=fn=>fn(),enqueue:(fn:()=>void)=>void=queueMicrotask){
 const layers:{id:symbol;parent?:symbol;priority:number;close:()=>void}[]=[];
 let boundary:Boundary|null=null,releasing=false,queued=false;
 const callbacks:(()=>void)[]=[];
 const owns=()=>!!boundary&&browser.history.state?.[marker]===boundary.token;
 function ensure(){
  if(releasing)return;
  if(layers.length){
   if(!owns()){
    const base=browser.history.state,url=browser.location.href,token=crypto.randomUUID();
    browser.history.pushState({...base,[marker]:token},'',url);
    boundary={token,base,url,target:url};
   }
  }else if(owns()){
   releasing=true;browser.history.back();
  }else boundary=null;
 }
 function settle(){
  queued=false;ensure();
  if(!releasing){const next=callbacks.splice(0);for(const fn of next)fn();}
 }
 function schedule(){if(!queued){queued=true;enqueue(settle);}}
 function pop(event:Event){
  const current=boundary;
  if(!current||browser.history.state?.[marker]===current.token)return;
  const samePage=browser.location.href===current.target||browser.location.href===current.url;
  boundary=null;
  const cleanup=releasing;releasing=false;
  if(samePage){
   event.stopImmediatePropagation();
   // Query replacements made while the popup was open also replace its base.
   if(current.url!==current.target)browser.history.replaceState(current.base,'',current.url);
   if(!cleanup){
    // Layout effects register children before parents on a simultaneous mount.
    // Pick the most recently opened leaf, never its enclosing popup.
    const parents=new Set(layers.map(layer=>layer.parent).filter(Boolean));
    const top=layers.filter(layer=>!parents.has(layer.id)).sort((a,b)=>a.priority-b.priority).at(-1);
    if(top)dispatch(top.close);
   }
   ensure();schedule();
  }else{
   // A real multi-page traversal belongs to the router, not this popup stack.
   callbacks.length=0;
  }
 }
 browser.addEventListener('popstate',pop,true);
 return {
  register(close:()=>void,scope?:{id:symbol;parent?:symbol;priority?:number}){
   const layer={id:scope?.id??Symbol(),parent:scope?.parent,priority:scope?.priority??0,close};layers.push(layer);ensure();
   return ()=>{const i=layers.indexOf(layer);if(i!==-1)layers.splice(i,1);schedule();};
  },
  afterClose(fn:()=>void){callbacks.push(fn);schedule();},
  push(state:unknown,url:string){
   if(releasing){callbacks.push(()=>this.push(state,url));schedule();return;}
   // A popup can be replaced by a detail on a new route in the same render.
   // Turn the old sentinel into the new route, then guard the remaining popup.
   if(owns())browser.history.replaceState(state,'',url);
   else browser.history.pushState(state,'',url);
   boundary=null;ensure();
  },
  replace(state:unknown,url:string){
   if(releasing){callbacks.push(()=>this.replace(state,url));schedule();return;}
   if(owns()){
    boundary!.base=state;boundary!.url=new URL(url,browser.location.href).href;
    browser.history.replaceState({...state as object,[marker]:boundary!.token},'',url);
   }else browser.history.replaceState(state,'',url);
  },
  dispose(){browser.removeEventListener('popstate',pop,true);if(owns())browser.history.replaceState(boundary!.base,'',boundary!.url);layers.length=0;callbacks.length=0;boundary=null;},
 };
}
