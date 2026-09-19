export function dateSwipeDirection(dx:number,dy:number):number{return Math.abs(dx)>=48&&Math.abs(dx)>Math.abs(dy)*1.4?(dx<0?1:-1):0}
