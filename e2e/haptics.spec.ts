import {expect,test,type Page} from '@playwright/test';
import {testIdentity} from './support';

const pulses=(page:Page)=>page.evaluate(()=>Reflect.get(window,'hapticPulses') as number[]);
const reset=(page:Page)=>page.evaluate(()=>Reflect.set(window,'hapticPulses',[]));
test.beforeEach(async({context,page})=>{
 await context.setExtraHTTPHeaders(testIdentity());
 await page.addInitScript(()=>{
  Reflect.set(window,'hapticPulses',[]);
  Object.defineProperty(navigator,'vibrate',{configurable:true,value:(duration:number)=>{Reflect.get(window,'hapticPulses').push(duration);return true;}});
 });
 await page.goto('/demo#calendar');
 await expect(page.locator('.calendar-month-cell[aria-current=date]')).toBeVisible();
});

test('initial load is silent; a date button and portal close each pulse once',async({page})=>{
 expect(await pulses(page)).toEqual([]);
 await page.locator('.calendar-month-cell[aria-current=date]').click();
 await expect.poll(()=>pulses(page)).toEqual([10]);
 await page.getByRole('button',{name:'오후 5시에 일정 추가'}).click();
 await expect(page.locator('#new-time')).toBeVisible();
 await reset(page);
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await expect.poll(()=>pulses(page)).toEqual([10]);
});

test('page button pulses once and programmatic clicks remain silent',async({page})=>{
 await page.getByRole('button',{name:'프로젝트',exact:true}).first().click();
 await expect.poll(()=>pulses(page)).toEqual([10]);
 await reset(page);
 await page.getByRole('button',{name:'오늘',exact:true}).first().evaluate((el:HTMLElement)=>el.click());
 expect(await pulses(page)).toEqual([]);
});

test('tabs that select on pointer down still pulse on click',async({page})=>{
 await page.locator('.calendar-month-cell[aria-current=date]').click();
 await expect(page.getByRole('tab',{name:'목록',exact:true})).toBeVisible();
 await page.waitForTimeout(100);await reset(page);
 await page.getByRole('tab',{name:'목록',exact:true}).click();
 await expect(page.getByRole('tab',{name:'목록',exact:true})).toHaveAttribute('aria-selected','true');
 await expect.poll(()=>pulses(page)).toEqual([10]);
});

test('confirmed date swipe pulses once and a vertical scroll stays silent',async({page,context})=>{
 await page.locator('.calendar-month-cell[aria-current=date]').click();
 const cdp=await context.newCDPSession(page),slot=page.locator('.day-grid-slot').nth(6);
 await slot.scrollIntoViewIfNeeded();await reset(page);
 const b=(await slot.boundingBox())!,x=b.x+b.width/2,y=b.y+20;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-50,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-90,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(page.getByRole('heading',{name:'9월 7일 월요일'})).toBeAttached();
 await expect.poll(()=>pulses(page)).toEqual([18]);
 await slot.scrollIntoViewIfNeeded();await reset(page);
 const b2=(await slot.boundingBox())!,x2=b2.x+b2.width/2,y2=b2.y+20;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x2,y:y2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x2,y:y2-90}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 expect(await pulses(page)).toEqual([]);
 await cdp.detach();
});

test('reduced motion silences feedback without blocking navigation',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.locator('.calendar-month-cell[aria-current=date]').click();
 await expect(page.locator('.day-grid')).toBeVisible();
 expect(await pulses(page)).toEqual([]);
});

test('cancelled and disabled clicks stay silent; explicitly handled actions pulse',async({page})=>{
 await page.evaluate(()=>{
  const box=document.createElement('div');
  box.style.cssText='position:fixed;top:0;left:0;z-index:99999;background:white';
  box.innerHTML='<button id="cancelled">Cancelled</button><button id="handled" data-haptic="tap">Handled</button><button id="disabled" aria-disabled="true">Disabled</button>';
  box.addEventListener('click',event=>event.preventDefault());
  document.body.append(box);
 });
 await page.locator('#cancelled').click();
 await page.waitForTimeout(120);
 expect(await pulses(page)).toEqual([]);
 const b=(await page.locator('#disabled').boundingBox())!;
 await page.mouse.click(b.x+b.width/2,b.y+b.height/2);
 await page.waitForTimeout(120);
 expect(await pulses(page)).toEqual([]);
 await page.locator('#handled').click();
 await expect.poll(()=>pulses(page)).toEqual([10]);
});

test('long press pulses once and release does not produce a ghost tap',async({page,context})=>{
 await page.locator('.calendar-month-cell[aria-current=date]').click();
 const event=page.locator('#day-block-e2');
 await event.scrollIntoViewIfNeeded();await reset(page);
 const cdp=await context.newCDPSession(page),b=(await event.boundingBox())!,x=b.x+b.width/2,y=b.y+15;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 await expect(event).toHaveClass(/is-moving/);
 await expect.poll(()=>pulses(page)).toEqual([18]);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(event).not.toHaveClass(/is-moving/);
 await page.waitForTimeout(150);
 expect(await pulses(page)).toEqual([18]);
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await cdp.detach();
});
