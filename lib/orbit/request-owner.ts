let expectedOwner='';
export function setRequestOwner(owner:string){if(typeof window!=='undefined')expectedOwner=owner;}
export function requestOwnerHeaders():Record<string,string>{return expectedOwner?{'x-orbit-owner':expectedOwner}:{};}
