import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { ARTIFACT_DIR, testIdentity } from "./support";

// Slack requests kept while AI could not process them (ORBIT-20260927-01). The request list and the
// agent API are stubbed so the flow runs without Hermes; the owner's requests are asserted.
const dayFromToday = (days: number) => {
  const date = new Date(Date.now() + days * 86400000);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date);
};
const FULL_TEXT = "오후 2시 미팅 진행, 참석자 이선미교수, 박혜영대표, 김동경대표, 나 안건은 한투파 프로젝트투자 해외매출건 관련으로 상파울루 추진 진행 타진의 비밀 메모";

test.describe("대기 중인 Slack 요청", () => {
  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders(testIdentity());
  });

  test("the kept request shows a summary and cause, and its drafts are approved together or with a new time", async ({ page }, testInfo) => {
    const conversationId = "slack-request:11111111-1111-4111-8111-111111111111";
    const card = (id: string, date: string, start: number) => ({
      id, turnId: "turn-1", conversationId, title: `${start / 60}시 회의 등록`, reason: "Slack 지시 원문", expectedRevision: 1, state: "pending",
      note: "", revisitDate: null, createdAt: new Date().toISOString(),
      action: { type: "event.upsert", event: { id: "e-" + id, title: `${start / 60}시 회의`, date, start, end: start + 60, kind: "meeting" } },
    });
    let pending = [card("a0000000-0000-4000-8000-000000000001", dayFromToday(2), 960), card("a0000000-0000-4000-8000-000000000002", dayFromToday(-1), 840)];
    const decisions: Record<string, unknown>[] = [];
    const changes: Record<string, unknown>[] = [];
    const item = {
      id: "11111111-1111-4111-8111-111111111111", createdAt: new Date(Date.now() - 3600000).toISOString(), channelId: "C0B31KPEB61", messageTs: "1790313921.880000",
      summary: FULL_TEXT.slice(0, 59) + "…", permalink: "https://slack.com/archives/C0B31KPEB61/p1790313921880000", status: "needs_review",
      statusLabel: "확인 필요 · 초안 1건 (만료 1건) · 승인 전에는 등록되지 않음", reasonKind: "quota", holdId: "h1", nextCheckAt: 0, conversationId,
      counts: { total: 2, pending: 1, approved: 0, rejected: 0, expired: 1 }, deliveries: 2,
    };
    await page.route(/\/api\/slack-requests$/, async (route) => {
      if (route.request().method() === "POST") { changes.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); }
      return route.fulfill({ json: { items: [item] } });
    });
    await page.route(/\/api\/agent(\?.*)?$/, async (route) => {
      const request = route.request();
      if (request.method() === "PATCH") {
        const body = request.postDataJSON();
        decisions.push(body);
        // The edited slot overlaps once; the owner confirms the overlap for that same slot.
        if (body.overrides && !body.overlapConfirmation) {
          return route.fulfill({ status: 409, json: { error: "겹치는 일정을 확인하고 등록 여부를 선택해 주세요.", code: "CALENDAR_OVERLAP", details: { overlapConfirmation: "a".repeat(64), conflicts: [{ title: "기존 회의", date: dayFromToday(0), start: 900, end: 960 }], total: 1 } } });
        }
        pending = pending.filter((a) => a.id !== body.id);
        return route.fulfill({ json: { ok: true } });
      }
      if (request.method() !== "GET") return route.continue();
      const upstream = await route.fetch();
      const state = await upstream.json().catch(() => ({}));
      return route.fulfill({ json: { ...state, pendingActions: pending } });
    });

    await page.goto("/#inbox");
    const kept = page.getByRole("region", { name: "대기 중인 요청" });
    await expect(kept).toContainText("확인 필요 · 초안 1건 (만료 1건)");
    await expect(kept).toContainText("중복 전송 1회 합침");
    await expect(kept).not.toContainText("비밀 메모");
    await expect(kept.getByRole("link", { name: /원본 보기/ })).toHaveAttribute("href", item.permalink);

    const drafts = page.getByRole("region", { name: /Slack 보관 요청/ });
    await expect(drafts.getByRole("button", { name: "1건 확인 후 등록" })).toBeVisible();
    await expect(drafts).toContainText("예정 시간");
    await mkdir(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: `${ARTIFACT_DIR}/slack-requests-${testInfo.project.name}.png`, fullPage: true });

    await drafts.getByRole("button", { name: "1건 확인 후 등록" }).click();
    await expect.poll(() => decisions.length).toBe(1);
    expect(decisions[0]).toMatchObject({ id: "a0000000-0000-4000-8000-000000000001", decision: "approve" });
    expect(decisions[0].overrides).toBeUndefined();

    await drafts.getByLabel("시작").fill("15:00");
    await drafts.getByLabel("종료").fill("16:00");
    await drafts.getByRole("button", { name: "이 시간으로 등록" }).click();
    await expect.poll(() => decisions.length).toBe(2);
    expect(decisions[1]).toMatchObject({ id: "a0000000-0000-4000-8000-000000000002", decision: "approve", overrides: { date: dayFromToday(0), start: 900, end: 960 } });
    await drafts.getByRole("button", { name: "겹침을 확인하고 등록" }).click();
    await expect.poll(() => decisions.length).toBe(3);
    expect(decisions[2]).toMatchObject({ overrides: { date: dayFromToday(0), start: 900, end: 960 }, overlapConfirmation: "a".repeat(64) });

    await kept.getByRole("button", { name: "다시 처리" }).click();
    await expect.poll(() => changes.length).toBe(1);
    expect(changes[0]).toEqual({ id: item.id, action: "retry" });
  });
});
