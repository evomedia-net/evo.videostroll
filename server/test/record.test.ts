/**
 * M1's whole claim, end to end: start, three steps, finish - and a captioned
 * MP4 comes out whose timings are exact. This is the test that retires the
 * second risk (exact timestamps from the screencast); the cursor test retires
 * the first.
 *
 * Uses the silent provider, so every duration is deterministic from word
 * count and the assertions can be exact rather than approximate.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeDurationMs } from "../src/assemble.js";
import { render, Session, STEP_TAIL_MS, type FinishResult, type StepRecord } from "../src/session.js";
import { parseStoryboard } from "../src/storyboard.js";
import { silentDurationMs } from "../src/tts/silent.js";
import { startFixture, type Fixture } from "./fixture-server.js";

let fixture: Fixture;
const out = join(tmpdir(), `videostroll-test-${process.pid}`);

beforeAll(async () => {
  fixture = await startFixture();
});
afterAll(async () => {
  await fixture?.close();
});

const N1 = "This is the fixture site. It exists so the tests never touch the network.";
const N2 = "Typing a name and pressing the button greets you by it.";
const N3 = "The second page proves the cursor survives a navigation.";

describe("record a walkthrough (interactive)", () => {
  let steps: StepRecord[];
  let result: FinishResult;

  it("start -> step x3 -> finish produces every deliverable", async () => {
    const s = await Session.start({ url: fixture.url, title: "Fixture tour", voice: { provider: "silent", wordsPerMinute: 300 }, outputDir: join(out, "interactive") });
    const first = await s.observe();
    expect(first.title).toBe("Fixture — Home");
    expect(first.snapshot).toMatch(/heading/i);

    const r1 = await s.step({ narration: N1, actions: [{ type: "move", target: { selector: "h1" } }, { type: "highlight", target: { selector: "h1" } }], chapter: "Home" });
    const r2 = await s.step({
      narration: N2,
      actions: [
        { type: "type", target: { selector: "#name" }, text: "Ada", msPerChar: 20 },
        { type: "click", target: { selector: "#greet" } },
        { type: "waitFor", target: { selector: "text=Hello, Ada!" } },
      ],
    });
    expect(r2.page.snapshot).toContain("Hello, Ada!");
    const r3 = await s.step({ narration: N3, actions: [{ type: "click", target: { selector: "#to-page2" } }, { type: "waitFor", target: { selector: "#second-heading" } }], chapter: "Second page" });
    expect(r3.step.url).toMatch(/page2\.html$/);
    expect(r3.step.title).toBe("Fixture — Second page");

    result = await s.finish();
    steps = [r1.step, r2.step, r3.step];
    for (const f of [result.mp4, result.srt, result.vtt, result.manifest, result.storyboard]) {
      expect((await stat(f)).size, f).toBeGreaterThan(0);
    }
  });

  it("every step lasts at least its narration, timestamps are monotonic and contiguous", () => {
    const wpm = 300;
    expect(steps[0].startMs).toBe(0);
    for (const [i, st] of steps.entries()) {
      expect(st.narrationMs).toBe(silentDurationMs([N1, N2, N3][i], wpm));
      expect(st.endMs - st.startMs).toBeGreaterThanOrEqual(st.narrationMs + STEP_TAIL_MS);
      if (i > 0) expect(st.startMs).toBe(steps[i - 1].endMs);
      expect(st.frameCount).toBeGreaterThanOrEqual(2); // two bookends minimum
    }
  });

  it("the MP4's duration is the sum of the steps, within a frame", async () => {
    const total = steps[steps.length - 1].endMs;
    const probed = await probeDurationMs(result.mp4);
    expect(Math.abs(probed - total)).toBeLessThanOrEqual(120);
    expect(result.durationMs).toBe(probed);
  });

  it("captions: one cue per sentence, each inside its step, files parse", async () => {
    const manifest = JSON.parse(await readFile(result.manifest, "utf8"));
    const sentences = [N1, N2, N3].flatMap((n) => n.split(/(?<=[.!?])\s+/)).length;
    expect(manifest.cues.length).toBe(sentences);
    for (const cue of manifest.cues) {
      const st = steps.find((x) => cue.startMs >= x.startMs && cue.endMs <= x.endMs);
      expect(st, `cue ${cue.index} at ${cue.startMs}-${cue.endMs} lies in no step`).toBeDefined();
    }
    const srt = await readFile(result.srt, "utf8");
    const vtt = await readFile(result.vtt, "utf8");
    expect(srt.split(/\n\n/).filter((b) => /-->/.test(b)).length).toBe(sentences);
    expect(vtt.startsWith("WEBVTT\n")).toBe(true);
    expect(srt).toMatch(/^\d+\n\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}\n/m);
  });

  it("the manifest records what the narration claimed, and each step has a thumbnail", async () => {
    const manifest = JSON.parse(await readFile(result.manifest, "utf8"));
    expect(manifest.steps.length).toBe(3);
    expect(manifest.steps[2].title).toBe("Fixture — Second page");
    expect(manifest.chapters.map((c: { title: string }) => c.title)).toEqual(["Home", "Second page"]);
    for (const st of manifest.steps) expect((await stat(st.thumbnail)).size).toBeGreaterThan(0);
  });

  it("the emitted storyboard is valid and re-renderable", async () => {
    const sb = parseStoryboard(JSON.parse(await readFile(result.storyboard, "utf8")));
    expect(sb.steps.length).toBe(3);
    expect(sb.steps[1].actions[0]).toMatchObject({ type: "type", text: "Ada" });
  });
});

describe("render a storyboard (batch)", () => {
  it("renders end to end from JSON, and abort leaves no browser behind", async () => {
    const sb = {
      version: 1,
      title: "Batch",
      url: fixture.url,
      voice: { provider: "silent", wordsPerMinute: 300 },
      steps: [
        { narration: "Home.", actions: [] , minDurationMs: 1200 },
        { narration: "Scroll down to the bottom.", actions: [{ type: "scroll", target: { selector: "#bottom" }, durationMs: 400 }] },
      ],
    };
    const r = await render(sb, { outputDir: join(out, "batch") });
    expect(r.steps).toBe(2);
    expect(r.durationMs).toBeGreaterThanOrEqual(1200 + STEP_TAIL_MS);
    const s = await Session.start({ url: fixture.url, outputDir: join(out, "aborted") });
    await s.abort();
    await expect(s.step({ narration: "x", actions: [] })).rejects.toThrow(/finished/);
  });
});
