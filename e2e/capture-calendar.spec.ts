import {expect,test,type Page} from '@playwright/test';
import {testIdentity} from './support';

// Attachment writes, image preparation, local R2/D1 and conversation creation are real.
// Only model availability/submission is stubbed; this does not test model extraction.

function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve});return {promise,release}}
class CaptureChat {
 constructor(readonly page:Page){}
 async open(){await this.page.goto('/#agent');await expect(this.page.getByRole('textbox',{name:'Orbit에게 메시지 보내기'})).toBeVisible();}
 async attach(){
  const image=await this.page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=240;canvas.height=120;const drawing=canvas.getContext('2d')!;drawing.fillStyle='#fff';drawing.fillRect(0,0,240,120);drawing.fillStyle='#111';drawing.fillText('Calendar meeting 14:00',12,48);return canvas.toDataURL('image/png').split(',')[1]});
  await this.page.locator('input[type="file"]').setInputFiles({name:'calendar-capture.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
 }
 send(){return this.page.getByRole('button',{name:'메시지 보내기',exact:true});}
 async message(){await this.page.getByRole('textbox',{name:'Orbit에게 메시지 보내기'}).fill('이 캡처를 일정으로 등록해 줘.');}
 async retry(){await this.page.getByRole('button',{name:'calendar-capture.png 다시 시도'}).click();}
 async preparedCount(){return this.page.evaluate(()=>(window as unknown as {__preparedImages:number}).__preparedImages);}
}
async function modelBoundary(page:Page){
 const submissions: {attachmentIds:string[];message:string}[]=[];
 await page.route(/\/api\/agent(?:\?.*)?$/,async route=>{
  if(route.request().method()==='POST'){
   submissions.push(route.request().postDataJSON());
   return route.fulfill({json:{ok:true,status:'completed'}});
  }
  const response=await route.fetch(),data=await response.json();
  return route.fulfill({response,json:{...data,directChatReady:true}});
 });
 return submissions;
}
test.beforeEach(async({context})=>{
 await context.setExtraHTTPHeaders(testIdentity());
 await context.addInitScript(()=>{
  const real=window.createImageBitmap.bind(window);
  const state=window as unknown as {__preparedImages:number};state.__preparedImages=0;
  window.createImageBitmap=((...args:Parameters<typeof createImageBitmap>)=>{state.__preparedImages++;return real(...args)}) as typeof createImageBitmap;
 });
});

test('capture prepares during original PUT and cannot send before context is committed',async({page})=>{
 const submissions=await modelBoundary(page),chat=new CaptureChat(page),original=gate(),context=gate();
 let originalStarted=false,contextStarted=false,previewWrites=0,attachmentId='';
 await page.route('**/api/attachments/content?*',async route=>{
  if(route.request().method()!=='PUT')return route.continue();
  originalStarted=true;attachmentId=new URL(route.request().url()).searchParams.get('id')!;
  await original.promise;await route.continue();
 });
 await page.route('**/api/attachments/preview?*',async route=>{if(route.request().method()==='PUT')previewWrites++;await route.continue();});
 await page.route('**/api/attachments/context',async route=>{contextStarted=true;await context.promise;await route.continue();});
 try{
  await chat.open();await chat.message();await chat.attach();
  await expect.poll(()=>originalStarted).toBe(true);
  await expect.poll(()=>chat.preparedCount()).toBe(1);
  expect(previewWrites).toBe(0);expect(contextStarted).toBe(false);
  await expect(chat.send()).toBeDisabled();expect(submissions).toHaveLength(0);
  original.release();
  await expect.poll(()=>contextStarted).toBe(true);
  expect(previewWrites).toBe(1);
  await expect(chat.send()).toBeDisabled();
  context.release();
  await expect(chat.send()).toBeEnabled();
  const stored=await page.evaluate(async id=>(await (await fetch('/api/attachments?ids='+id)).json()).items[0],attachmentId);
  expect(stored).toMatchObject({state:'ready',prepared:true,preview:true});
  await chat.send().click();
  await expect.poll(()=>submissions.length).toBe(1);
  expect(submissions[0]).toMatchObject({attachmentIds:[attachmentId],message:'이 캡처를 일정으로 등록해 줘.'});
 }finally{original.release();context.release()}
});

test('failed original upload stays unsendable and retry finishes the same attachment',async({page})=>{
 const submissions=await modelBoundary(page),chat=new CaptureChat(page),ids:string[]=[],errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 let originalWrites=0,previewWrites=0;
 await page.route('**/api/attachments/content?*',async route=>{
  if(route.request().method()!=='PUT')return route.continue();
  originalWrites++;ids.push(new URL(route.request().url()).searchParams.get('id')!);
  if(originalWrites===1)return route.fulfill({status:500,json:{error:'원본 전송 실패 테스트'}});
  return route.continue();
 });
 await page.route('**/api/attachments/preview?*',async route=>{if(route.request().method()==='PUT')previewWrites++;await route.continue();});
 await chat.open();await chat.message();await chat.attach();
 await expect(page.getByText('원본 전송 실패 테스트',{exact:true})).toBeVisible();
 await expect(chat.send()).toBeDisabled();expect(submissions).toHaveLength(0);expect(previewWrites).toBe(0);
 await chat.retry();
 await expect(chat.send()).toBeEnabled();
 expect(originalWrites).toBe(2);expect(new Set(ids).size).toBe(1);expect(previewWrites).toBe(1);
 const stored=await page.evaluate(async id=>(await (await fetch('/api/attachments?ids='+id)).json()).items[0],ids[0]);
 expect(stored).toMatchObject({state:'ready',prepared:true,preview:true});
 expect(errors).toEqual([]);
});
