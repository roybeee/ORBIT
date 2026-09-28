import { expect, test } from "@playwright/test";
import { capture, testIdentity } from "./support";

// The demo workspace fixes today at 2026-09-06 with a few events and tasks.
test.describe("calendar: month grid, day timeline and the switch between them", () => {
  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders(testIdentity());
  });

  test("일정 opens on the month; a day opens its timeline and Back returns to the month", async ({ page }, testInfo) => {
    await page.goto("/demo#calendar");
    const today = page.locator(".calendar-month-cell[aria-current=date]");
    await expect(today).toBeVisible();
    await expect(page.getByRole("button", { name: "월", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".calendar-period h2")).toHaveText("2026년 9월");
    await expect(today.locator(".calendar-month-chip").first()).toBeVisible();
    await capture(page, testInfo, "calendar-month");

    await page.getByRole("button", { name: "다음 달" }).click();
    await expect(page.locator(".calendar-period h2")).toHaveText("2026년 10월");
    await page.getByRole("button", { name: "오늘로 이동" }).click();
    await expect(page.locator(".calendar-period h2")).toHaveText("2026년 9월");

    await today.click();
    await expect(page.getByRole("button", { name: "일", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "9월 6일 일요일" })).toBeVisible();
    await expect(page.locator(".day-grid-event").first()).toBeVisible();
    await capture(page, testInfo, "calendar-day");

    // Back closes the day, not the 일정 screen.
    await page.goBack();
    await expect(page.locator(".calendar-month")).toBeVisible();
    await expect(page).toHaveURL(/#calendar$/);

    // The switch works both ways without touching history.
    await page.getByRole("button", { name: "일", exact: true }).click();
    await expect(page.locator(".day-grid")).toBeVisible();
    await page.getByRole("button", { name: "월", exact: true }).click();
    await expect(page.locator(".calendar-month")).toBeVisible();
  });

  test("tapping an empty hour opens a new event at that time", async ({ page }) => {
    await page.goto("/demo#calendar");
    await page.locator(".calendar-month-cell[aria-current=date]").click();
    // 17:00–18:00 is free in the demo day; the lower half of the hour starts at :30.
    await page.getByRole("button", { name: "오후 5시에 일정 추가" }).click({ position: { x: 40, y: 45 } });
    await expect(page.locator("#new-time")).toHaveValue("17:30");
  });
});

test.describe('day grid long press',()=>{
 test.beforeEach(async({context,page})=>{
  await context.setExtraHTTPHeaders(testIdentity());
  await page.goto('/demo#calendar');
  await page.locator('.calendar-month-cell[aria-current=date]').click();
 });
 test('hold and drag shows grid-scaled time, Escape cancels without opening detail',async({page})=>{
  const event=page.locator('.day-grid-event[data-grid-move]').filter({hasNot:page.locator('.is-protected')}).first();
  await event.scrollIntoViewIfNeeded();
  const before=await event.locator('span').innerText();
  const box=(await event.boundingBox())!;
  await page.mouse.move(box.x+10,box.y+10);await page.mouse.down();
  await expect(event).toHaveClass(/is-moving/);
  await page.mouse.move(box.x+10,box.y+40);
  await expect(event.locator('span')).not.toHaveText(before);
  await page.keyboard.press('Escape');await page.mouse.up();
  await expect(event).not.toHaveClass(/is-moving/);
  await expect(event.locator('span')).toHaveText(before);
 });
 test('movement before the hold cancels rather than moving the schedule',async({page})=>{
  const event=page.locator('.day-grid-event[data-grid-move]').first();await event.scrollIntoViewIfNeeded();
  const before=await event.locator('span').innerText(),box=(await event.boundingBox())!;
  await page.mouse.move(box.x+10,box.y+10);await page.mouse.down();
  await page.mouse.move(box.x+10,box.y+40);await page.waitForTimeout(500);await page.mouse.up();
  await expect(event).not.toHaveClass(/is-moving/);await expect(event.locator('span')).toHaveText(before);
 });
});


test('touch hold moves the event once on release and supports undo',async({context,page})=>{
 await context.setExtraHTTPHeaders(testIdentity());
 await page.goto('/demo#calendar');
 await page.locator('.calendar-month-cell[aria-current=date]').click();
 const event=page.locator('#day-block-e2');await event.scrollIntoViewIfNeeded();
 const box=(await event.boundingBox())!,x=box.x+20,y=box.y+15;
 const cdp=await context.newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 await expect(event).toHaveClass(/is-moving/);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+30}]});
 await expect(event.locator('span')).toHaveText('11:30–12:30');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(event).not.toHaveClass(/is-moving/);
 await expect(event.locator('span')).toHaveText('11:30–12:30');
 await page.getByRole('button',{name:'실행 취소',exact:true}).click();
 await expect(event.locator('span')).toHaveText('11:00–12:00');
 await cdp.detach();
});
