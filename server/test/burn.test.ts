/**
 * Burned-in captions. The pinned ffmpeg carries libass; this proves the
 * subtitles filter is wired through mux() correctly - captions: "both" yields
 * a second, re-encoded file of the same length. Pixel-level correctness of the
 * rendered text is not asserted; that the filter ran without error and kept
 * the timeline intact is the contract.
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeDurationMs } from "../src/assemble.js";
import { render } from "../src/session.js";
import { startFixture, type Fixture } from "./fixture-server.js";

let fixture: Fixture;
beforeAll(async () => {
  fixture = await startFixture();
});
afterAll(async () => {
  await fixture?.close();
});

describe("burned-in captions", () => {
  it('captions: "both" writes a captioned MP4 of the same duration beside the clean one', async () => {
    const out = join(tmpdir(), `videostroll-burn-${process.pid}`);
    const r = await render(
      {
        version: 1,
        title: "Burn",
        url: fixture.url,
        voice: { provider: "silent", wordsPerMinute: 300 },
        captions: "both",
        steps: [
          { narration: "A caption that will be drawn into the frames.", actions: [{ type: "move", target: { selector: "h1" } }] },
          { narration: "And a second one, on the next step.", actions: [] },
        ],
      },
      { outputDir: out },
    );
    const burned = join(r.outputDir, "walkthrough.captioned.mp4");
    expect((await stat(burned)).size).toBeGreaterThan(0);
    const [clean, hot] = await Promise.all([probeDurationMs(r.mp4), probeDurationMs(burned)]);
    expect(Math.abs(clean - hot)).toBeLessThanOrEqual(120);
    expect(clean).toBe(r.durationMs);
  });
});
