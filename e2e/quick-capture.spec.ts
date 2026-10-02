import {expect,test} from '@playwright/test';
import {testIdentity} from './support';

// 빠른 기록 against the real local worker and D1: the sheet closes before the server
// answers (instant save), the record survives a reload, and the guessed kind follows the text.
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders(testIdentity());});

test('a memo saves instantly into 빠른 기록함 and survives a reload',async({page})=>{
 await page.goto('/');
 const bar=page.getByRole('button',{name:/무엇이든 적어 두세요/});
 await expect(bar).toBeVisible();
 // Hold the write so the test proves the sheet does not wait for the server.
 let release:()=>void=()=>{};const held=new Promise<void>(r=>{release=r;});
 let posted=0;
 await page.route('**/api/workspace',async route=>{if(route.request().method()==='POST'){posted++;await held;}await route.continue();});
 await bar.click();
 const input=page.getByRole('textbox',{name:'빠른 기록 내용'});
 await expect(input).toBeFocused();
 await input.fill('해외 파트너에게 보낼 매운맛 단계 설명 아이디어');
 await expect(page.getByRole('radio',{name:/메모/})).toHaveAttribute('aria-checked','true');
 await page.getByRole('button',{name:'저장',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'빠른 기록'})).toBeHidden();
 await expect(page.getByText(/저장됨 · 메모/)).toBeVisible();
 expect(posted).toBe(1);
 const done=page.waitForResponse(r=>r.url().endsWith('/api/workspace')&&r.request().method()==='POST');
 release();
 expect((await done).status()).toBe(200);
 await page.unroute('**/api/workspace');
 await page.reload();
 const saved=await page.evaluate(async()=>(await (await fetch('/api/workspace',{cache:'no-store'})).json()));
 expect(saved.data.notes.map((n:{title:string})=>n.title)).toContain('해외 파트너에게 보낼 매운맛 단계 설명 아이디어');
 expect(saved.data.projects.map((p:{id:string})=>p.id)).toContain('capture-inbox');
});

test('a timed line becomes a calendar event; a deadline line becomes a task; N opens the sheet',async({page})=>{
 await page.goto('/');
 await expect(page.getByRole('button',{name:/무엇이든 적어 두세요/})).toBeVisible();
 await page.locator('body').press('n');
 const input=page.getByRole('textbox',{name:'빠른 기록 내용'});
 await expect(input).toBeFocused();
 await input.fill('내일 오후 3시 성수 파트너 미팅');
 await expect(page.getByRole('radio',{name:/일정/})).toHaveAttribute('aria-checked','true');
 await expect(page.locator('.quick-capture-preview strong')).toHaveText('성수 파트너 미팅');
 const first=page.waitForResponse(r=>r.url().endsWith('/api/workspace')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'계속 적기'}).click();
 expect((await first).status()).toBe(200);
 await expect(input).toHaveValue('');
 await input.fill('금요일까지 IR 덱 수정본 보내기');
 await expect(page.getByRole('radio',{name:/할 일/})).toHaveAttribute('aria-checked','true');
 const second=page.waitForResponse(r=>r.url().endsWith('/api/workspace')&&r.request().method()==='POST');
 await input.press('Control+Enter');
 expect((await second).status()).toBe(200);
 const saved=await page.evaluate(async()=>(await (await fetch('/api/workspace',{cache:'no-store'})).json()));
 const event=saved.data.events.find((e:{title:string})=>e.title==='성수 파트너 미팅');
 expect(event?.start).toBe(900);
 expect(saved.data.tasks.map((t:{title:string})=>t.title)).toContain('IR 덱 수정본 보내기');
});

test('the floating button and the #capture shortcut open the same sheet',async({page})=>{
 await page.goto('/#capture');
 await expect(page.getByRole('dialog',{name:'빠른 기록'})).toBeVisible();
 await expect(page).toHaveURL(/#today$/);
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog',{name:'빠른 기록'})).toBeHidden();
 await page.getByRole('button',{name:'빠른 기록 (N)'}).click();
 await expect(page.getByRole('dialog',{name:'빠른 기록'})).toBeVisible();
});
