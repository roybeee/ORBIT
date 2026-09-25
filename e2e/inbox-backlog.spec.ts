import { expect, test } from "@playwright/test";
import { testIdentity } from "./support";

// Old meeting proposals stay out of the 결재함 badge and can be deferred per meeting in one go.
// The agent API is stubbed so the flow runs without Hermes; the defer requests are asserted.
test.describe("결재함 backlog", () => {
  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders(testIdentity());
  });

  test("a meeting's old proposals are deferred together with one reason and date", async ({ page }) => {
    const card = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
      id, turnId: "t-" + id, title: "제안 " + id, reason: "근거", expectedRevision: 1, state: "pending",
      note: "", revisitDate: null, createdAt, action: { type: "task.upsert", task: { id: "task-" + id, title: id } }, ...extra,
    });
    const old = (id: string) => card(id, "2026-08-01T00:00:00Z", { guard: { meeting: { noteId: "note-old", revision: 1 }, version: 1, actionHash: "h", values: {} } });
    let pending = [old("a"), old("b"), old("c"), card("fresh", new Date().toISOString())];
    const deferred: { id: string; reason: string; revisitDate: string }[] = [];
    await page.route(/\/api\/agent(\?.*)?$/, async (route) => {
      const request = route.request();
      if (request.method() === "PATCH") {
        const body = request.postDataJSON();
        deferred.push(body);
        pending = pending.map((a) => (a.id === body.id ? { ...a, state: "deferred", note: body.reason, revisitDate: body.revisitDate } : a));
        return route.fulfill({ json: { ok: true } });
      }
      if (request.method() !== "GET") return route.continue();
      const upstream = await route.fetch();
      const state = await upstream.json().catch(() => ({}));
      return route.fulfill({ json: { ...state, pendingActions: pending } });
    });

    await page.goto("/#inbox");
    const backlog = page.locator("#inbox-backlog");
    await expect(backlog).toContainText("쌓인 회의 결재 3건");
    await expect(page.getByRole("heading", { name: "결재함", level: 1 })).toBeVisible();
    await expect(page.locator(".inbox-summary")).toContainText("내가 정할 일 1건");

    await backlog.getByRole("button", { name: "이 회의 보류" }).click();
    await backlog.getByRole("textbox", { name: "보류 이유" }).fill("다음 분기에 다시 보기");
    await backlog.getByRole("button", { name: "보류 3건" }).click();

    await expect(backlog).toHaveCount(0);
    expect(deferred.map((d) => d.id).sort()).toEqual(["a", "b", "c"]);
    expect(new Set(deferred.map((d) => d.reason))).toEqual(new Set(["다음 분기에 다시 보기"]));
    await expect(page.getByRole("button", { name: /보류한 Orbit 제안 3건/ })).toBeVisible();
  });
});
