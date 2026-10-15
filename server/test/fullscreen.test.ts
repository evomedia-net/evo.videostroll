/**
 * The browser's own full screen is refused while recording (#65). When a
 * page took it, the screencast's frames changed shape and the video showed the
 * page squashed into half the picture, though screenshots looked fine. This
 * proves the refusal in a real browser, with a real click, because a click is
 * the user gesture that makes requestFullscreen succeed everywhere else.
 */
import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_FULLSCREEN_INIT_SCRIPT } from "../src/session.js";

const PAGE = `<!doctype html>
<button id="go" style="width:200px;height:80px">Full screen</button>
<script>
  window.outcome = "not tried";
  document.getElementById("go").addEventListener("click", async () => {
    try {
      await document.documentElement.requestFullscreen();
      window.outcome = "granted";
    } catch (e) {
      window.outcome = "refused: " + e.message;
    }
  });
</script>`;

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(NO_FULLSCREEN_INIT_SCRIPT);
  page = await context.newPage();
  await page.setContent(PAGE);
});

afterAll(async () => {
  await browser?.close();
});

describe("browser full screen while recording", () => {
  it("is refused, so the page falls back to its own overlay", async () => {
    await page.click("#go");
    await page.waitForFunction(() => (window as any).outcome !== "not tried");
    expect(await page.evaluate(() => (window as any).outcome)).toBe("refused: full screen is off while recording");
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  });

  it("would otherwise be granted, so the test above can fail", async () => {
    const plain = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await plain.newPage();
    await p.setContent(PAGE);
    await p.click("#go");
    await p.waitForFunction(() => (window as any).outcome !== "not tried");
    expect(await p.evaluate(() => (window as any).outcome)).toBe("granted");
    await plain.close();
  });

  it("still lets the page show its full-screen button", async () => {
    expect(await page.evaluate(() => document.fullscreenEnabled)).toBe(true);
  });

  it("is installed on every session's browser", () => {
    const src = readFileSync(new URL("../src/session.ts", import.meta.url), "utf8");
    expect(src).toMatch(/await context\.addInitScript\(NO_FULLSCREEN_INIT_SCRIPT\);/);
  });
});
