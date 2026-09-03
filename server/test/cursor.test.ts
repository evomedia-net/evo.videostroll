/**
 * The cursor is the first of M1's two risks: a headless browser draws none,
 * and if the overlay is not in the captured pixels the recording shows clicks
 * from nowhere. So this does not stop at "the element exists" - it proves the
 * overlay changes what a capture contains.
 */
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CURSOR_INIT_SCRIPT, Cursor } from "../src/cursor.js";
import { startFixture, type Fixture } from "./fixture-server.js";

let fixture: Fixture;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  fixture = await startFixture();
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(CURSOR_INIT_SCRIPT);
  page = await context.newPage();
  await page.goto(fixture.url);
});

afterAll(async () => {
  await browser?.close();
  await fixture?.close();
});

describe("cursor overlay", () => {
  it("mounts on load and follows real mouse movement", async () => {
    const cursor = new Cursor(page, 10, 10);
    expect(await cursor.mounted()).toBe(true);
    await cursor.moveTo(400, 300, 200);
    const pos = await page.evaluate(() => (window as any).__videostroll.position());
    expect(pos).toEqual({ x: 400, y: 300 });
    const transform = await page.$eval("#__videostroll-cursor", (el) => (el as HTMLElement).style.transform);
    expect(transform).toBe("translate(398px, 298px)");
  });

  it("is captured in the pixels, not just present in the DOM", async () => {
    // Same clip twice: once with the overlay showing, once with it hidden.
    // If the bytes differ, the overlay is in what the recorder sees.
    const cursor = new Cursor(page, 400, 300);
    await cursor.moveTo(500, 400, 150);
    const clip = { x: 490, y: 390, width: 40, height: 40 };
    const withCursor = await page.screenshot({ clip });
    await page.$eval("#__videostroll-cursor", (el) => ((el as HTMLElement).style.visibility = "hidden"));
    const without = await page.screenshot({ clip });
    await page.$eval("#__videostroll-cursor", (el) => ((el as HTMLElement).style.visibility = ""));
    expect(withCursor.equals(without)).toBe(false);
  });

  it("survives navigation, because it is an init script rather than a one-time injection", async () => {
    await page.click("#to-page2");
    await page.waitForURL(/page2\.html$/);
    const cursor = new Cursor(page, 0, 0);
    expect(await cursor.mounted()).toBe(true);
    await cursor.moveTo(200, 200, 150);
    expect(await page.evaluate(() => (window as any).__videostroll.position())).toEqual({ x: 200, y: 200 });
  });

  it("draws and clears a highlight box around a rect", async () => {
    const cursor = new Cursor(page, 200, 200);
    await cursor.highlight({ x: 100, y: 100, width: 200, height: 50 });
    const shown = await page.$eval("#__videostroll-hl", (el) => getComputedStyle(el).display);
    expect(shown).toBe("block");
    await cursor.clearHighlight();
    const hidden = await page.$eval("#__videostroll-hl", (el) => getComputedStyle(el).display);
    expect(hidden).toBe("none");
  });

  it("does not intercept clicks - the overlay is pointer-events: none", async () => {
    await page.goto(fixture.url);
    const cursor = new Cursor(page, 0, 0);
    const box = await page.locator("#greet").boundingBox();
    expect(box).not.toBeNull();
    await page.fill("#name", "Cursor");
    await cursor.moveTo(box!.x + box!.width / 2, box!.y + box!.height / 2, 150);
    await cursor.click(50);
    expect(await page.textContent("#status")).toBe("Hello, Cursor!");
  });
});
