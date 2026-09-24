import { expect, test, type Page } from "@playwright/test";
import { testIdentity } from "./support";

// The Orbit dock opens the single chat beside the current screen. Leaving it by a tab or
// by "전체 화면" must land on the chosen screen even when the app was opened on a #view URL.
test.describe("Orbit dock", () => {
  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders(testIdentity());
  });

  const openDock = async (page: Page) => {
    const mobile = (page.viewportSize()?.width ?? 1280) < 1024;
    // The chat container mounts once the workspace has loaded (after hydration).
    await expect(page.locator(".orbit-dock")).toHaveCount(1);
    await page.locator(mobile ? ".orbit-tab" : ".sidebar-orbit").click();
    await expect(page.locator(".orbit-dock.is-dock")).toBeVisible();
    await expect(page.locator("#orbit-message")).toBeFocused();
  };

  test("a tab chosen while the dock is open shows that screen", async ({ page }) => {
    await page.goto("/#today");
    await expect(page.getByRole("heading", { name: "오늘", level: 1 })).toBeVisible();
    await openDock(page);
    await page.getByRole("button", { name: "결재함", exact: true }).filter({ visible: true }).first().click();
    await expect(page.getByRole("heading", { name: "결재함", level: 1 })).toBeVisible();
    await expect(page.locator(".orbit-dock.is-dock")).toHaveCount(0);
  });

  test("전체 화면 turns the dock into the 대화 page and Back returns to the screen", async ({ page }) => {
    await page.goto("/#projects");
    await expect(page.getByRole("heading", { name: "프로젝트", level: 1 })).toBeVisible();
    await openDock(page);
    await page.getByRole("button", { name: "대화 전체 화면으로 열기" }).click();
    await expect(page.locator(".orbit-dock.is-page")).toBeVisible();
    await expect(page).toHaveURL(/#agent$/);
    await page.goBack();
    await expect(page.getByRole("heading", { name: "프로젝트", level: 1 })).toBeVisible();
  });

  test("Back closes the dock and keeps the screen", async ({ page }) => {
    await page.goto("/#projects");
    await openDock(page);
    await page.goBack();
    await expect(page.locator(".orbit-dock.is-dock")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "프로젝트", level: 1 })).toBeVisible();
  });
});
