import { expect, test } from "@playwright/test";
import { capture, testIdentity } from "./support";

test.describe("core journey: create a project and keep it after reload", () => {
  // A new owner per test, so every run starts from an empty workspace.
  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders(testIdentity());
  });

  test("a signed-in owner creates a project that survives a reload", async ({ page }, testInfo) => {
    const title = `E2E 스모크 ${Date.now().toString(36)}`;

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "오늘", level: 1 })).toBeVisible();
    await capture(page, testInfo, "today");

    await page.getByRole("button", { name: "프로젝트 추가" }).click();
    const dialog = page.getByRole("dialog", { name: "새 프로젝트" });
    const titleField = dialog.getByRole("textbox", { name: "제목" });
    await expect(titleField).toBeVisible();

    // Failure path: an empty title is rejected by the form and nothing is saved.
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && request.url().endsWith("/api/workspace")) writes.push(request.method());
    });
    await dialog.getByRole("button", { name: "추가하기" }).click();
    await expect(dialog).toBeVisible();
    expect(await titleField.evaluate((field: HTMLInputElement) => field.validity.valueMissing)).toBe(true);
    expect(writes).toEqual([]);
    await capture(page, testInfo, "project-form-invalid");

    await titleField.fill(title);
    const saved = page.waitForResponse(
      (response) => response.url().endsWith("/api/workspace") && response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "추가하기" }).click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await capture(page, testInfo, "project-created");

    await page.reload();
    await expect(page.getByRole("heading", { name: "오늘", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "프로젝트", exact: true }).filter({ visible: true }).first().click();
    const projects = page.getByRole("region", { name: "프로젝트 관리" });
    await expect(projects.getByText(title)).toBeVisible();
    await capture(page, testInfo, "project-after-reload");
  });
});

test.describe("without the ChatGPT identity headers", () => {
  test("workspace data is denied and the app asks to sign in", async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL });
    try {
      const api = await anonymous.get("/api/workspace");
      expect(api.status()).toBe(401);
      expect(await api.json()).toMatchObject({ code: "AUTH" });

      const page = await anonymous.get("/", { maxRedirects: 0 });
      expect(page.status()).toBe(307);
      expect(page.headers()["location"]).toContain("/signin-with-chatgpt");
    } finally {
      await anonymous.dispose();
    }
  });
});
