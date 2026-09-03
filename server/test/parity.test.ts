/**
 * Interactive and batch are the same engine, and the storyboard an
 * interactive session emits must re-render to the same walkthrough - that is
 * what makes "edit the steps that changed and render again" a real promise
 * rather than a hope. Compared: step count, chapters, cue count, and every
 * step's duration within the tolerance the recorder's own timing allows.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render, Session } from "../src/session.js";
import { startFixture, type Fixture } from "./fixture-server.js";

let fixture: Fixture;
beforeAll(async () => {
  fixture = await startFixture();
});
afterAll(async () => {
  await fixture?.close();
});

interface Manifest {
  steps: Array<{ id: string; startMs: number; endMs: number; narrationMs: number; url: string }>;
  cues: unknown[];
  chapters: Array<{ title: string }>;
  durationMs: number;
}

describe("interactive / batch parity", () => {
  it("the storyboard an interactive run emits re-renders to the same walkthrough", async () => {
    const out = join(tmpdir(), `videostroll-parity-${process.pid}`);
    const s = await Session.start({ url: fixture.url, title: "Parity", voice: { provider: "silent", wordsPerMinute: 300 }, outputDir: join(out, "interactive") });
    await s.step({ id: "home", narration: "The home page. Nothing moves yet.", actions: [], chapter: "Home", minDurationMs: 1500 });
    await s.step({ id: "greet", narration: "Typing a name and clicking greet.", actions: [{ type: "type", target: { selector: "#name" }, text: "Ada", msPerChar: 10 }, { type: "click", target: { selector: "#greet" } }] });
    await s.step({ id: "second", narration: "And over to the second page.", actions: [{ type: "click", target: { selector: "#to-page2" } }, { type: "waitFor", target: { selector: "#second-heading" } }], chapter: "Second" });
    const a = await s.finish();
    const storyboard = JSON.parse(await readFile(a.storyboard, "utf8"));

    const b = await render(storyboard, { outputDir: join(out, "batch") });

    const ma = JSON.parse(await readFile(a.manifest, "utf8")) as Manifest;
    const mb = JSON.parse(await readFile(b.manifest, "utf8")) as Manifest;

    expect(mb.steps.map((x) => x.id)).toEqual(ma.steps.map((x) => x.id));
    expect(mb.chapters.map((c) => c.title)).toEqual(ma.chapters.map((c) => c.title));
    expect(mb.cues.length).toBe(ma.cues.length);
    for (let i = 0; i < ma.steps.length; i++) {
      // Same narration -> identical narrationMs under the silent provider.
      expect(mb.steps[i].narrationMs).toBe(ma.steps[i].narrationMs);
      expect(mb.steps[i].url).toBe(ma.steps[i].url);
      // Same pacing rule -> the same step length, give or take action jitter.
      const da = ma.steps[i].endMs - ma.steps[i].startMs;
      const db = mb.steps[i].endMs - mb.steps[i].startMs;
      expect(Math.abs(da - db), `step ${ma.steps[i].id}: ${da} vs ${db}`).toBeLessThanOrEqual(600);
    }
    expect(Math.abs(ma.durationMs - mb.durationMs)).toBeLessThanOrEqual(ma.steps.length * 600);
  });
});
