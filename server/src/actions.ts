// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Executes one storyboard action against the page, through the cursor so
 * every movement is visible. Targets are resolved at run time - a selector
 * becomes a bounding box now, not when the storyboard was written - which is
 * what lets storyboards survive layout changes.
 */
import type { Page } from "playwright";
import type { Action, Target } from "./storyboard.js";
import type { Cursor, Rect } from "./cursor.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const DEFAULTS = {
  moveMs: 700,
  hoverHoldMs: 600,
  clickSettleMs: 250,
  msPerChar: 60,
  scrollMs: 800,
  waitForTimeoutMs: 10_000,
} as const;

export class TargetNotFound extends Error {
  constructor(public readonly target: Target) {
    super(`target not found or not visible: ${JSON.stringify(target)}`);
  }
}

/** Resolve a target to a viewport rect, scrolling it into view first. */
export async function resolveTarget(page: Page, target: Target): Promise<Rect> {
  if ("point" in target) return { x: target.point.x, y: target.point.y, width: 0, height: 0 };
  const loc = page.locator(target.selector).first();
  try {
    await loc.scrollIntoViewIfNeeded({ timeout: 5000 });
  } catch {
    throw new TargetNotFound(target);
  }
  const box = await loc.boundingBox();
  if (!box) throw new TargetNotFound(target);
  return box;
}

const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** Runs the action. Returns rects it highlighted, so the step can clear them when it ends. */
export async function executeAction(page: Page, cursor: Cursor, action: Action): Promise<{ highlighted: boolean }> {
  switch (action.type) {
    case "goto": {
      await page.goto(action.url, { waitUntil: action.waitUntil ?? "load" });
      return { highlighted: false };
    }
    case "move": {
      const c = centre(await resolveTarget(page, action.target));
      await cursor.moveTo(c.x, c.y, action.durationMs ?? DEFAULTS.moveMs);
      return { highlighted: false };
    }
    case "hover": {
      const c = centre(await resolveTarget(page, action.target));
      await cursor.moveTo(c.x, c.y);
      await sleep(action.holdMs ?? DEFAULTS.hoverHoldMs);
      return { highlighted: false };
    }
    case "click": {
      const c = centre(await resolveTarget(page, action.target));
      await cursor.moveTo(c.x, c.y);
      await cursor.click(action.settleMs ?? DEFAULTS.clickSettleMs);
      return { highlighted: false };
    }
    case "type": {
      const c = centre(await resolveTarget(page, action.target));
      await cursor.moveTo(c.x, c.y);
      await cursor.click(DEFAULTS.clickSettleMs);
      // Humanised: a per-character delay with a little jitter reads as a
      // person typing rather than a paste. Playwright's delay is fixed, so
      // jitter is applied per character here.
      const base = action.msPerChar ?? DEFAULTS.msPerChar;
      for (const ch of action.text) {
        await page.keyboard.type(ch);
        await sleep(base + (Math.random() - 0.5) * base * 0.5);
      }
      return { highlighted: false };
    }
    case "press": {
      await page.keyboard.press(action.key);
      return { highlighted: false };
    }
    case "scroll": {
      const ms = action.durationMs ?? DEFAULTS.scrollMs;
      if (action.target) {
        // Smooth-scroll the target to the middle, then give the animation its time.
        if ("selector" in action.target) {
          const loc = page.locator(action.target.selector).first();
          await loc.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
        }
        await sleep(ms);
      } else {
        const total = action.deltaY ?? 600;
        const ticks = Math.max(4, Math.round(ms / 50));
        for (let i = 0; i < ticks; i++) {
          await page.mouse.wheel(0, total / ticks);
          await sleep(ms / ticks);
        }
      }
      return { highlighted: false };
    }
    case "highlight": {
      const r = await resolveTarget(page, action.target);
      await cursor.highlight(r);
      if (action.holdMs !== undefined) {
        await sleep(action.holdMs);
        await cursor.clearHighlight();
        return { highlighted: false };
      }
      return { highlighted: true }; // held until the step ends
    }
    case "wait": {
      await sleep(action.ms);
      return { highlighted: false };
    }
    case "waitFor": {
      if ("selector" in action.target) {
        await page
          .locator(action.target.selector)
          .first()
          .waitFor({ state: action.state ?? "visible", timeout: action.timeoutMs ?? DEFAULTS.waitForTimeoutMs });
      }
      return { highlighted: false };
    }
  }
}
