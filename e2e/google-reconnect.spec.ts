import {expect,test} from '@playwright/test';
import {testIdentity} from './support';

// A Google event whose connection Google refused: the edit sheet says why and offers to reconnect
// right there, instead of a dead end with only 닫기.
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders(testIdentity());});

test('editing a Google event after the connection expired offers Google 다시 연결 in place',async({page})=>{
 const tomorrow=await page.evaluate(()=>{const d=new Date(Date.now()+9*3600000+86400000);return d.toISOString().slice(0,10)});
 const event={id:'google:primary:e2e-expired',title:'이주연팀장님',date:tomorrow,start:600,end:660,kind:'meeting',google:{calendarId:'primary',eventId:'e2e-expired'}};
 await page.route('**/api/workspace',async route=>{
  if(route.request().method()!=='GET')return route.continue();
  const response=await route.fetch(),json=await response.json();
  json.data.events=[...json.data.events.filter((e:{id:string})=>e.id!==event.id),event];
  await route.fulfill({response,json});
 });
 let read=0;
 await page.route('**/api/integrations/calendar/event**',async route=>{read++;await route.fulfill({status:409,json:{error:'Google 연결이 연결 7일 만에 만료됐습니다. Google Cloud의 OAuth 앱이 ‘테스트’ 상태이면 7일마다 끊깁니다. Google Cloud에서 앱을 ‘프로덕션’으로 게시한 뒤 다시 연결해 주세요.',code:'RECONNECT',details:{reason:'invalid_grant'}}})});
 let connectBody:unknown=null;
 await page.route('**/api/integrations/connect',async route=>{connectBody=route.request().postDataJSON();await route.fulfill({json:{url:'https://accounts.google.com/o/oauth2/v2/auth?client_id=e2e'}})});
 await page.route('https://accounts.google.com/**',route=>route.fulfill({contentType:'text/html',body:'<title>Google sign-in</title>'}));

 await page.goto('/');
 await page.getByRole('button',{name:/이주연팀장님/}).first().click();
 // 일정 미루기 reads the same Google event, so it offers the same way back.
 await page.getByRole('button',{name:'일정 미루기'}).click();
 const postpone=page.getByRole('dialog').filter({has:page.getByRole('button',{name:'Google 다시 연결'})});
 await expect(postpone.getByRole('alert')).toContainText('프로덕션');
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'일정 수정'}).click();
 const editor=page.getByRole('region',{name:'일정 수정'});
 await expect(editor.getByRole('alert')).toContainText('프로덕션');
 expect(read).toBe(2);
 await editor.getByRole('button',{name:'Google 다시 연결'}).click();
 await expect(page).toHaveURL(/accounts\.google\.com/);
 expect(connectBody).toEqual({provider:'google_calendar'});
});
