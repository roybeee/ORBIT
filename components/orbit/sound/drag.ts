export type DragPosition={x:number;y:number;over:boolean};
type Point={pointerId:number;clientX:number;clientY:number};
// Track the gesture at window level. Transferring Android's implicit pointer
// capture from a child to the bar emits lostpointercapture and used to cancel it.
export function soundDrag({change,hit,dismiss,delay=450}:{change:(value:DragPosition|null)=>void;hit:(x:number,y:number)=>boolean;dismiss:()=>void;delay?:number}){
  let current:({id:number;x:number;y:number;active:boolean;timer:ReturnType<typeof setTimeout>})|null=null;
  let suppressed=false;
  const cancel=()=>{if(current)clearTimeout(current.timer);current=null;change(null)};
  return {
    start(event:Point){
      cancel();suppressed=false;
      const g={id:event.pointerId,x:event.clientX,y:event.clientY,active:false,timer:setTimeout(()=>{
        g.active=true;suppressed=true;change({x:0,y:0,over:false});
      },delay)};current=g;
    },
    move(event:Point){
      const g=current;if(!g||g.id!==event.pointerId)return;
      const x=event.clientX-g.x,y=event.clientY-g.y;
      if(!g.active){if(Math.hypot(x,y)>14)cancel();return}
      change({x,y,over:hit(event.clientX,event.clientY)});
    },
    end(event:Point){
      const g=current;if(!g||g.id!==event.pointerId)return;
      const remove=g.active&&hit(event.clientX,event.clientY);cancel();if(remove)dismiss();
    },
    cancel,
    consumeClick(){const value=suppressed;suppressed=false;return value},
  };
}
