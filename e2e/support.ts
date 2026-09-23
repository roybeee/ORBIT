import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Page, TestInfo } from "@playwright/test";
import { CAPTURES, VIEWPORTS, captureFile, type CaptureName, type ViewportName } from "./capture-manifest";

export const ARTIFACT_DIR = "e2e/artifacts/screens";

// ChatGPT Sites puts these verified headers on every request after sign-in;
// app/chatgpt-auth.ts reads them. The built-route tests authenticate the same
// way (tests/rendered-html.test.mjs). A fresh id per run keeps runs isolated in
// the shared local D1 database.
export function testIdentity(): Record<string, string> {
  const id = `e2e-${randomUUID()}`;
  return {
    "oai-authenticated-user-id": id,
    "oai-authenticated-user-email": `${id}@example.test`,
    "oai-authenticated-user-full-name": "E2E%20Owner",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
}

export function viewportOf(testInfo: TestInfo): ViewportName {
  const name = testInfo.project.name;
  if (!(name in VIEWPORTS)) throw new Error(`Unknown Playwright project "${name}"`);
  return name as ViewportName;
}

export async function capture(page: Page, testInfo: TestInfo, screen: CaptureName): Promise<void> {
  const viewport = viewportOf(testInfo);
  const filename = captureFile(screen, viewport);
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: `${ARTIFACT_DIR}/${filename}`, fullPage: false });
  const entry = { screen, route: CAPTURES[screen].route, viewport, size: VIEWPORTS[viewport], filename };
  await writeFile(`${ARTIFACT_DIR}/${filename}.json`, JSON.stringify(entry, null, 2) + "\n");
}
