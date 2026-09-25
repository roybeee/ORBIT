import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { testIdentity } from "./support";

// Two projects that are one project entered twice are suggested, merged under a
// chosen name, and the absorbed project's work survives a reload under the kept one.
test.describe("project merge", () => {
  let identity: Record<string, string>;
  test.beforeEach(async ({ context }) => {
    identity = testIdentity();
    await context.setExtraHTTPHeaders(identity);
  });

  async function command(request: APIRequestContext, baseURL: string, action: unknown) {
    const snapshot = await (await request.get("/api/workspace", { headers: identity })).json();
    const response = await request.post("/api/workspace", {
      headers: { ...identity, origin: baseURL, "content-type": "application/json" },
      data: { operationId: randomUUID(), expectedRevision: snapshot.revision, action },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }

  test("a suggested duplicate pair becomes one project and keeps its tasks", async ({ page, request, baseURL }) => {
    const project = (id: string, name: string, goal: string) => ({ id, name, goal, color: "#5558e8", symbol: name.slice(0, 1), due: "2099-06-30", priority: 3 });
    await command(request, baseURL!, { type: "project.upsert", project: project("league", "엑스더리그", "리그 운영") });
    await command(request, baseURL!, { type: "project.upsert", project: project("league-copy", "엑스더리그 사업 고도화 및 글로벌 확장", "해외 확장") });
    await command(request, baseURL!, { type: "task.upsert", task: { id: "copy-task", title: "해외 파트너 목록 정리", projectId: "league-copy", status: "todo", duration: 30, due: "2099-01-10", impact: 3, focus: false, definition: "목록 완성" } });

    await page.goto("/#projects");
    const hub = page.getByRole("region", { name: "프로젝트 관리" });
    await hub.getByRole("button", { name: /중복 합치기 1/ }).click();
    const dialog = page.getByRole("dialog", { name: "프로젝트 합치기" });
    await dialog.getByRole("button", { name: /엑스더리그 · 엑스더리그 사업 고도화/ }).click();
    await dialog.getByLabel("남길 프로젝트").selectOption({ label: "엑스더리그" });
    await dialog.getByLabel("합친 이름").selectOption({ label: "엑스더리그 사업 고도화 및 글로벌 확장" });
    await expect(dialog.getByRole("status")).toContainText("할 일 1");
    await dialog.getByRole("button", { name: "합치기", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("되돌릴 수 없습니다");
    await dialog.getByRole("button", { name: "합치기 확정" }).click();
    await expect(dialog).toHaveCount(0);

    await page.reload();
    await expect(hub.getByRole("heading", { name: "엑스더리그 사업 고도화 및 글로벌 확장" })).toBeVisible();
    await expect(hub.locator("[data-project-card]")).toHaveCount(1);
    const saved = await (await request.get("/api/workspace", { headers: identity })).json();
    expect(saved.data.projects.map((p: { id: string }) => p.id)).toEqual(["league"]);
    expect(saved.data.projects[0].goal).toBe("리그 운영");
    expect(saved.data.tasks.find((t: { id: string }) => t.id === "copy-task").projectId).toBe("league");
  });
});
