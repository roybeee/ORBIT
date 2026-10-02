import {expect,test} from '@playwright/test';
import {testIdentity} from './support';

// UI/UX focus pass on the demo workspace: what to do now is on the first screen, work screens keep
// the theme to a slim strip, and every phone tap target is at least 44px.
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders(testIdentity());});

const tapSize=async(page:import('@playwright/test').Page,selector:string)=>page.locator(selector).evaluateAll(list=>list.filter(e=>(e as HTMLElement).offsetParent).map(e=>{const r=e.getBoundingClientRect();return Math.min(r.width,r.height)}));

test("today's tasks start on the first screen and show the goal they move",async({page})=>{
 await page.goto('/demo');
 const firstTask=page.locator('.today-row-check').first();
 await expect(firstTask).toBeVisible();
 const box=await firstTask.boundingBox(),view=page.viewportSize()!;
 // The first task's check and title are above the fold (and above the phone tab bar).
 expect(box!.y+56).toBeLessThan(view.height-(view.width<768?80:0));
 await expect(page.locator('.today-section .goal-tag').first()).toBeVisible();
 // 아침·낮·저녁 rides on the 오늘 card instead of taking a row of its own.
 const hero=(await page.locator('.mission-hero').boundingBox())!,modes=(await page.getByRole('group',{name:'오늘 화면의 시간대'}).boundingBox())!;
 expect(modes.y).toBeGreaterThanOrEqual(hero.y);expect(modes.y+modes.height).toBeLessThanOrEqual(hero.y+hero.height);
 expect(modes.x+modes.width).toBeLessThanOrEqual(hero.x+hero.width);
 // The entry bar is the capture entry on 오늘, so the floating button is not stacked over the cards.
 await expect(page.getByRole('button',{name:'빠른 기록 (N)'})).toBeHidden();
});

test('work screens show the theme as a slim strip and their content right below it',async({page})=>{
 for(const hash of ['#tasks','#calendar','#review','#history']){
  await page.goto('/demo'+hash);
  const strip=page.locator('.city-screen-banner');
  await expect(strip).toBeVisible();
  expect((await strip.boundingBox())!.height).toBeLessThanOrEqual(64);
  await expect(strip.getByRole('button',{name:'이 화면 테마 변경'})).toBeVisible();
 }
 await page.goto('/demo#tasks');
 const row=page.locator('.task-list-row').first();
 expect((await row.boundingBox())!.y).toBeLessThan(page.viewportSize()!.height-100);
 // The whole row opens the task; the checkbox still completes it.
 const title=await row.locator('.task-title').innerText();
 // Retried until hydration has attached the handlers.
 await expect(async()=>{
  await row.click({position:{x:(await row.boundingBox())!.width-40,y:12}});
  await expect(page.getByRole('dialog').filter({hasText:title})).toBeVisible({timeout:1500});
 }).toPass();
});

test('phone tap targets are at least 44px on the busiest screens',async({page},info)=>{
 test.skip(info.project.name!=='mobile','touch sizing applies to phones');
 await page.goto('/demo');
 for(const size of await tapSize(page,'.today-check,.day-mode-switch button,.area-sections button,.top-actions button'))expect(size).toBeGreaterThanOrEqual(44);
 await page.goto('/demo#review');
 await expect(page.locator('.outcome-buttons button:visible').first()).toBeVisible();
 for(const size of await tapSize(page,'.outcome-buttons button,.candidate-time .text-button,.candidate-evidence .text-button'))expect(size).toBeGreaterThanOrEqual(44);
 await page.goto('/demo#tasks');
 await expect(page.locator('[data-slot=tabs-trigger]:visible').first()).toBeVisible();
 for(const size of await tapSize(page,'[data-slot=tabs-trigger]'))expect(size).toBeGreaterThanOrEqual(44);
});

test('on a phone the goal ladder is three one-line rungs and the project list starts on the first screen',async({page},info)=>{
 test.skip(info.project.name!=='mobile','phone layout');
 await page.goto('/demo#projects');
 const rungs=page.locator('.goal-ladder li');
 await expect(rungs).toHaveCount(3);
 for(const box of await rungs.evaluateAll(list=>list.map(e=>e.getBoundingClientRect().height)))expect(box).toBeLessThanOrEqual(48);
 await expect(rungs.first().locator('strong')).toHaveAttribute('title',/.+/);
 await expect(page.locator('.project-universe-banner')).toBeHidden();
 const tab=page.getByRole('tab',{name:/진행 중/}).first();
 await expect(tab).toBeVisible();
 expect((await tab.boundingBox())!.y).toBeLessThan(page.viewportSize()!.height-200);
});
