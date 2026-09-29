import {expect,test} from '@playwright/test';
import {testIdentity} from './support';

test.beforeEach(async({context,page})=>{
 await context.setExtraHTTPHeaders(testIdentity());
 await page.goto('/demo#calendar');
 await page.locator('.calendar-month-cell[aria-current=date]').click();
});

test('touch swipes on the timeline navigate days without opening a slot',async({context,page})=>{
 const cdp=await context.newCDPSession(page);
 const swipe=async(dx:number)=>{
  const slot=page.locator('.day-grid-slot').first();await slot.scrollIntoViewIfNeeded();
  const b=(await slot.boundingBox())!,x=b.x+b.width/2,y=b.y+20;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx/2,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 };
 await swipe(-90);
 await expect(page.getByRole('heading',{name:'9월 7일 월요일'})).toBeAttached();
 await expect(page.locator('#new-time')).toHaveCount(0);
 await swipe(90);
 await expect(page.getByRole('heading',{name:'9월 6일 일요일'})).toBeAttached();
 await swipe(90);
 await expect(page.getByRole('heading',{name:'9월 5일 토요일'})).toBeAttached();
 await cdp.detach();
});

test('event swipe navigates but an activated long press does not',async({context,page})=>{
 const cdp=await context.newCDPSession(page),event=page.locator('#day-block-e2');
 await event.scrollIntoViewIfNeeded();
 let b=(await event.boundingBox())!,x=b.x+b.width/2,y=b.y+15;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 await expect(event).toHaveClass(/is-moving/);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-90,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(page.getByRole('heading',{name:'9월 6일 일요일'})).toBeAttached();
 await expect(event).not.toHaveClass(/is-moving/);
 b=(await event.boundingBox())!;x=b.x+b.width/2;y=b.y+15;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-45,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-90,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(page.getByRole('heading',{name:'9월 7일 월요일'})).toBeAttached();
 await cdp.detach();
});

test('vertical scrolling and multi-touch never change the day',async({context,page})=>{
 const cdp=await context.newCDPSession(page),slot=page.locator('.day-grid-slot').nth(6);
 await slot.scrollIntoViewIfNeeded();
 const b=(await slot.boundingBox())!,x=b.x+b.width/2,y=b.y+20;
 const scrollBefore=await page.evaluate(()=>document.scrollingElement!.scrollTop);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-60}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-100,y:y-60}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(page.getByRole('heading',{name:'9월 6일 일요일'})).toBeAttached();
 await expect.poll(()=>page.evaluate(()=>document.scrollingElement!.scrollTop)).not.toBe(scrollBefore);
 await slot.scrollIntoViewIfNeeded();
 const box=(await slot.boundingBox())!,mx=box.x+box.width/2,my=box.y+20;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:mx,y:my,id:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:mx,y:my,id:1},{x:mx+30,y:my,id:2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{x:mx,y:my,id:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:mx-90,y:my,id:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(page.getByRole('heading',{name:'9월 6일 일요일'})).toBeAttached();
 await cdp.detach();
});

test('a cancelled touch stays on the day and an all-day swipe does not open detail',async({context,page})=>{
 const cdp=await context.newCDPSession(page),row=page.locator('.day-grid-allday-row button').last();
 await row.scrollIntoViewIfNeeded();
 const b=(await row.boundingBox())!,x=b.x+b.width/2,y=b.y+b.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-90,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
 await expect(page.getByRole('heading',{name:'9월 6일 일요일'})).toBeAttached();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-90,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(page.getByRole('heading',{name:'9월 7일 월요일'})).toBeAttached();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await cdp.detach();
});
