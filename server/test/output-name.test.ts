/**
 * Naming the output files.
 *
 * Everything used to be called `walkthrough.*`, hardcoded in six places, so a
 * second recording into the same folder overwrote the first without a word.
 * The name is a storyboard field now, which makes it something a stranger can
 * set - and the value is joined onto the output directory, so the rule that
 * keeps it a *file name* is the load-bearing part of this file.
 */
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OUTPUT_NAME_RE, OutputName, StoryboardSchema, parseStoryboard } from "../src/storyboard.js";
import { render } from "../src/session.js";
import { startFixture } from "./fixture-server.js";

const board = (extra: Record<string, unknown>) => ({
  version: 1,
  title: "A walkthrough",
  url: "https://example.com",
  steps: [{ narration: "One step.", actions: [] }],
  ...extra,
});

describe("the name rule", () => {
  it("defaults to walkthrough, so nothing that worked before changes", () => {
    expect(parseStoryboard(board({})).name).toBe("walkthrough");
  });

  it("accepts an ordinary file name", () => {
    for (const ok of ["intro", "evo-ehs-tour", "release_1.2", "Onboarding"]) {
      expect(OutputName.safeParse(ok).success, ok).toBe(true);
    }
  });

  it("refuses anything that could write outside the output directory", () => {
    // The whole point. Each of these, joined onto an output path, lands
    // somewhere the caller did not choose.
    for (const bad of ["../escape", "a/b", "a\\b", "/abs", "C:\\win", "..", "./x"]) {
      expect(OutputName.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("refuses a leading dot, which would hide the result", () => {
    expect(OutputName.safeParse(".hidden").success).toBe(false);
  });

  it("refuses empty and over-long names", () => {
    expect(OutputName.safeParse("").success).toBe(false);
    expect(OutputName.safeParse("x".repeat(65)).success).toBe(false);
    expect(OutputName.safeParse("x".repeat(64)).success).toBe(true);
  });

  it("the storyboard rejects a bad name rather than quietly defaulting", () => {
    const bad = StoryboardSchema.safeParse(board({ name: "../nope" }));
    expect(bad.success).toBe(false);
  });

  it("the exported pattern is the one the published schema advertises", async () => {
    const schema = JSON.parse(
      await (await import("node:fs/promises")).readFile(
        new URL("../schema/storyboard.schema.json", import.meta.url),
        "utf8",
      ),
    );
    expect(schema.properties.name.pattern).toBe(OUTPUT_NAME_RE.source);
    expect(schema.properties.name.default).toBe("walkthrough");
  });
});

describe("rendering with a name", () => {
  it("names every artefact from it, and round-trips it in the storyboard", async () => {
    const fixture = await startFixture();
    const out = mkdtempSync(join(tmpdir(), "videostroll-name-"));
    try {
      const result = await render(
        {
          version: 1,
          title: "Named run",
          name: "my-tour",
          url: fixture.url,
          voice: { provider: "silent" },
          viewport: { width: 640, height: 480 },
          steps: [{ narration: "A single quiet step.", actions: [] }],
        },
        { outputDir: out },
      );

      const files = readdirSync(out).filter((f) => !f.startsWith("."));
      expect(files.sort()).toEqual(
        ["my-tour.json", "my-tour.mp4", "my-tour.srt", "my-tour.storyboard.json", "my-tour.vtt", "thumbs"].sort(),
      );
      expect(result.mp4.endsWith("my-tour.mp4")).toBe(true);

      // Re-rendering the emitted storyboard has to produce the same names, or
      // "edit the steps that changed and render again" quietly renames the
      // output back to walkthrough.
      const emitted = JSON.parse(
        await (await import("node:fs/promises")).readFile(join(out, "my-tour.storyboard.json"), "utf8"),
      );
      expect(emitted.name).toBe("my-tour");
    } finally {
      await fixture.close();
    }
  });
});
