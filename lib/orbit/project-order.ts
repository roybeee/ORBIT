// Replace only the selected slots, retaining core and filtered-out projects.
export function reorderProjectSlots<T extends {id:string}>(projects:T[],ids:string[],coreId?:string):T[]{
 const byId=new Map(projects.map(p=>[p.id,p]));
 if(ids.length<2||new Set(ids).size!==ids.length||ids.some(id=>id===coreId||!byId.has(id)))throw new Error('순서를 바꿀 일반 프로젝트를 다시 확인해 주세요.');
 const selected=new Set(ids);let next=0;
 return projects.map(p=>selected.has(p.id)?byId.get(ids[next++])!:p);
}

export function moveProjectInOrder(ids:string[],from:string,to:string):string[]{
 const source=ids.indexOf(from),target=ids.indexOf(to);
 if(source<0||target<0||source===target)return ids;
 const result=[...ids];result.splice(source,1);result.splice(target,0,from);return result;
}
