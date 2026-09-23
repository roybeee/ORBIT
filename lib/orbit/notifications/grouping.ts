import type {OrbitNotification} from './store.ts';
export type NotificationGroup={key:string;head:OrbitNotification;rest:OrbitNotification[]};
// A failing dependency repeats one title for every retried record, so consecutive notifications
// sharing a kind and title collapse into their newest row with a count. The key is the head's own
// id, never the shared kind+title: the same title comes back in several groups that are not next to
// each other, and a React key repeated among siblings makes rows render in the wrong place, expand
// each other and survive their own dismissal.
export function groupNotifications(items:OrbitNotification[]):NotificationGroup[]{
 return items.reduce<NotificationGroup[]>((acc,item)=>{
  const last=acc.at(-1);
  return last&&last.head.kind===item.kind&&last.head.title===item.title
   ?[...acc.slice(0,-1),{...last,rest:[...last.rest,item]}]
   :[...acc,{key:item.id,head:item,rest:[]}];
 },[]);
}
