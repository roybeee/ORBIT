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
