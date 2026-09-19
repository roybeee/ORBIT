export const PROJECT_HOLD_MS=480;
export const PROJECT_PRESS_SLOP=10;
export function movedProjectPress(x:number,y:number,startX:number,startY:number){return Math.hypot(x-startX,y-startY)>PROJECT_PRESS_SLOP;}

export function createProjectPressController(options:{disabled:()=>boolean;onArm:(id:string|null)=>void;onOpen:(id:string)=>void}){
  let session:{id:string;x:number;y:number;pointer:number;armed:boolean;timer:ReturnType<typeof setTimeout>}|null=null;
  let suppressUntil=0;
  const cancel=()=>{if(session){clearTimeout(session.timer);if(session.armed)suppressUntil=Date.now()+800;}session=null;options.onArm(null)};
  return {
    get active(){return !!session},
    cancel,
    begin(id:string,x:number,y:number,pointer:number){
      cancel();if(options.disabled())return;
      const timer=setTimeout(()=>{if(!session||options.disabled()){cancel();return;}session.armed=true;suppressUntil=Date.now()+800;options.onArm(id)},PROJECT_HOLD_MS);
      session={id,x,y,pointer,armed:false,timer};
    },
    move(x:number,y:number,pointer:number){if(session&&session.pointer===pointer&&movedProjectPress(x,y,session.x,session.y))cancel()},
    end(pointer:number){
      if(!session||session.pointer!==pointer)return false;
      const {id,armed}=session;cancel();
      if(armed&&!options.disabled()){options.onOpen(id);return true}return false;
    },
    suppressClick(){return Date.now()<suppressUntil},
  };
}
