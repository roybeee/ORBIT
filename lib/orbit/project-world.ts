/** Stable artwork across the home, project list and detail, independent of sort order. */
const worlds=[
 {image:'/orbit-worlds/garden.webp',name:'Garden',accent:'#82e0bf'},
 {image:'/orbit-worlds/observatory.webp',name:'Observatory',accent:'#ffc39f'},
 {image:'/orbit-worlds/mission.webp',name:'Voyager',accent:'#b7a4ff'},
] as const;
export function projectWorld(id:string){
 let hash=0;for(const letter of id)hash=(Math.imul(hash,31)+letter.charCodeAt(0))>>>0;
 return worlds[hash%worlds.length];
}
