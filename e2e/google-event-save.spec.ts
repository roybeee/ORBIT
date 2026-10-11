import {expect,test,type Page} from '@playwright/test';
import {emptyWorkspace,type CalendarEvent} from '../lib/orbit/model';
import {testIdentity} from './support';

class GoogleEventPage {
 constructor(readonly page:Page) {}
 get editor(){return this.page.getByRole('region',{name:'일정 수정'});}
 get save(){return this.editor.getByRole('button',{name:'변경 저장'});}
 async detail(){
  await this.page.goto('/');
  await this.page.getByRole('button',{name:/PRE 3기 1강/}).first().click();
 }
 async edit(){
  await expect(this.page.getByRole('button',{name:'일정 수정',exact:true})).toBeEnabled();
  await this.page.getByRole('button',{name:'일정 수정',exact:true}).click();
  await expect(this.editor.getByLabel('제목',{exact:true})).toHaveValue('PRE 3기 1강');
 }
 async open(){await this.detail();await this.edit();}
 async change(){
  await this.editor.getByLabel('제목',{exact:true}).fill('PRE 3기 1강 수정');
  await this.editor.getByLabel('시작 시간',{exact:true}).fill('19:30');
  await this.editor.getByLabel('종료 시간',{exact:true}).fill('22:30');
 }
}

async function fixture(page:Page,overlap=false){
 const date=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 const event:CalendarEvent={id:'google:primary:e2e-edit',title:'PRE 3기 1강',date,start:1140,end:1320,kind:'meeting',google:{calendarId:'primary',eventId:'e2e-edit'}};
 const snapshot={revision:1,updatedAt:null,data:{...emptyWorkspace(),events:[event]}};
 const edit={id:event.id,calendarId:'primary',eventId:'e2e-edit',etag:'"test-etag"',timeZone:'Asia/Seoul',title:event.title,startDate:date,endDate:date,start:event.start,end:event.end,allDay:false,description:'3시간 강의',scope:'personal'};
 const requests={get:0,patch:0,workspacePost:0,payload:null as Record<string,unknown>|null};
 await page.route('**/api/workspace',async route=>{
  if(route.request().method()==='POST'){
   requests.workspacePost++;
   return route.fulfill({status:503,json:{error:'저장 결과를 확인하고 있습니다.',code:'NETWORK'}});
  }
  await route.fulfill({json:snapshot});
 });
 await page.route('**/api/integrations/calendar/event**',async route=>{
  if(route.request().method()==='PATCH'){
   requests.patch++;requests.payload=route.request().postDataJSON();
   if(overlap&&!requests.payload?.overlapConfirmation)return route.fulfill({status:409,json:{error:'다른 일정과 겹칩니다. 겹치는 상태로 등록할까요?',code:'OVERLAP',details:{confirmation:'e2e-overlap'}}});
   return route.fulfill({json:{event:{...event,title:requests.payload?.title,start:requests.payload?.start,end:requests.payload?.end}}});
  }
  requests.get++;await route.fulfill({json:edit});
 });
 return requests;
}

test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders(testIdentity());});

test('mobile Google title and time edits send exactly one PATCH',async({page})=>{
 const duplicateKeys:string[]=[];
 page.on('console',message=>{if(message.text().includes('Encountered two children with the same key'))duplicateKeys.push(message.text());});
 const requests=await fixture(page),ui=new GoogleEventPage(page);
 await ui.open();await ui.change();
 await expect(ui.save).toBeEnabled();await ui.save.click();
 await expect(ui.editor).toBeHidden();
 expect(requests.get).toBe(1);expect(requests.patch).toBe(1);
 expect(requests.payload).toMatchObject({title:'PRE 3기 1강 수정',start:1170,end:1350});
 expect(duplicateKeys).toEqual([]);
});

test('invalid Google end time explains validation without sending a PATCH',async({page})=>{
 const requests=await fixture(page),ui=new GoogleEventPage(page);
 await ui.open();await ui.editor.getByLabel('종료 시간',{exact:true}).fill('18:00');await ui.save.click();
 await expect(ui.editor.getByRole('alert')).toContainText('종료 시간을 시작 시간 이후');
 await expect(ui.save).toBeEnabled();expect(requests.patch).toBe(0);
});

test('an unresolved category autosave does not block saving a changed Google event',async({page})=>{
 const requests=await fixture(page),ui=new GoogleEventPage(page);
 await ui.open();await ui.change();
 await page.getByRole('combobox',{name:'일정 카테고리'}).click();
 await page.getByRole('option',{name:'학습',exact:true}).click();
 await expect.poll(()=>requests.workspacePost).toBe(1);
 await expect(ui.save).toBeEnabled();await ui.save.click();
 await expect(ui.editor).toBeHidden();expect(requests.patch).toBe(1);
});

test('a retained category autosave does not prevent opening and saving the Google editor',async({page})=>{
 const requests=await fixture(page),ui=new GoogleEventPage(page);
 await ui.detail();
 await page.getByRole('combobox',{name:'일정 카테고리'}).click();
 await page.getByRole('option',{name:'학습',exact:true}).click();
 await expect.poll(()=>requests.workspacePost).toBe(1);
 const retained=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes(':write-queue:')).map(k=>localStorage.getItem(k)));
 expect(retained).toHaveLength(1);
 await ui.edit();await ui.change();await ui.save.click();await expect(ui.editor).toBeHidden();
 expect(requests.patch).toBe(1);
 expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes(':write-queue:')).map(k=>localStorage.getItem(k)))).toEqual(retained);
});

test('an active Google PATCH disables a second save until the response arrives',async({page})=>{
 const requests=await fixture(page),ui=new GoogleEventPage(page);
 let release!:()=>void;
 const responseReady=new Promise<void>(resolve=>{release=resolve;});
 let started=0;
 await page.route('**/api/integrations/calendar/event**',async route=>{
  if(route.request().method()!=='PATCH')return route.fallback();
  started++;await responseReady;await route.fallback();
 });
 await ui.open();await ui.change();await ui.save.click();
 await expect.poll(()=>started).toBe(1);
 await expect(ui.editor.getByRole('button',{name:'저장 중…'})).toBeDisabled();
 await expect(ui.editor.getByLabel('제목',{exact:true})).toBeDisabled();
 release();await expect(ui.editor).toBeHidden();expect(requests.patch).toBe(1);
});

test('accepting Google time overlap sends a second PATCH with confirmation',async({page})=>{
 const requests=await fixture(page,true),ui=new GoogleEventPage(page);
 await ui.open();await ui.change();
 page.once('dialog',dialog=>dialog.accept());
 await ui.save.click();await expect(ui.editor).toBeHidden();
 expect(requests.patch).toBe(2);expect(requests.payload?.overlapConfirmation).toBe('e2e-overlap');
});

test('declining Google time overlap keeps the form editable and sends only one PATCH',async({page})=>{
 const requests=await fixture(page,true),ui=new GoogleEventPage(page);
 await ui.open();await ui.change();
 page.once('dialog',dialog=>dialog.dismiss());
 await ui.save.click();await expect(ui.save).toBeEnabled();
 await expect(ui.editor.getByLabel('제목',{exact:true})).toBeEditable();
 expect(requests.patch).toBe(1);
});
