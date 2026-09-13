/**
 * Thumbnails are a deliverable, not scratch.
 *
 * The skill tells the agent to open three of them to verify a recording, and
 * they go to whoever asked for the video. So a stale one is worse than a
 * missing one: it looks exactly as authoritative as a real frame, and a
 * verification step that reads it is verifying the previous cut.
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { isStaleThumb, thumbName } from "../src/session.js";

describe("thumbnail names", () => {
  it("carries the walkthrough's base name, so two in one folder do not collide", () => {
    expect(thumbName("walkthrough", 0, "intro")).toBe("walkthrough-01-intro.jpg");
    expect(thumbName("onboarding", 0, "intro")).toBe("onboarding-01-intro.jpg");
  });

  it("pads the step number so ten sorts after nine", () => {
    const names = [thumbName("w", 8, "a"), thumbName("w", 9, "b")].sort();
    expect(names).toEqual(["w-09-a.jpg", "w-10-b.jpg"]);
  });
});

describe("recognising a previous run's thumbnail", () => {
  it("matches this walkthrough's own frames", () => {
    expect(isStaleThumb("walkthrough-01-intro.jpg", "walkthrough")).toBe(true);
    expect(isStaleThumb("walkthrough-12-outputs.jpg", "walkthrough")).toBe(true);
  });

  it("leaves another walkthrough sharing the folder alone", () => {
    // `name` exists so these can coexist; clearing one must not take the other.
    expect(isStaleThumb("onboarding-01-intro.jpg", "walkthrough")).toBe(false);
  });

  it("leaves anything a person put there alone", () => {
    for (const name of ["notes.txt", "cover.jpg", "walkthrough.jpg", "walkthrough-intro.jpg"]) {
      expect(isStaleThumb(name, "walkthrough"), name).toBe(false);
    }
  });

  it("is not fooled by a base that is a prefix of another", () => {
    expect(isStaleThumb("walkthrough-two-01-intro.jpg", "walkthrough-two")).toBe(true);
    // "walkthrough" must not claim "walkthrough-two"'s files: what follows the
    // prefix is "two-01-intro.jpg", which is not a step number.
    expect(isStaleThumb("walkthrough-two-01-intro.jpg", "walkthrough")).toBe(false);
  });
});

// The behaviour the issue was actually about: a re-cut with a step inserted.
describe("re-rendering into a folder that already holds a render", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
  });

  it("leaves no orphan under a shifted step number", async () => {
    const out = join(tmpdir(), `videostroll-thumbs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const thumbs = join(out, "thumbs");
    dirs.push(out);
    await mkdir(thumbs, { recursive: true });

    // An eleven-step render.
    const first = ["intro", "menu", "prereqs", "copy", "ask", "to-setup", "fill", "either", "voices", "ava", "outputs"];
    for (const [i, id] of first.entries()) await writeFile(join(thumbs, thumbName("walkthrough", i, id)), "old");
    // Something else in the folder that must survive.
    await writeFile(join(thumbs, "onboarding-01-intro.jpg"), "someone else's");
    await writeFile(join(thumbs, "notes.txt"), "mine");

    // Re-cut with "docs" inserted at position 6, which shifts every name after it.
    const second = [...first.slice(0, 5), "docs", ...first.slice(5)];
    const stale = (await readdir(thumbs)).filter((n) => isStaleThumb(n, "walkthrough"));
    for (const n of stale) await rm(join(thumbs, n));
    for (const [i, id] of second.entries()) await writeFile(join(thumbs, thumbName("walkthrough", i, id)), "new");

    const left = (await readdir(thumbs)).sort();
    expect(left.filter((n) => n.startsWith("walkthrough-"))).toHaveLength(second.length);
    // The specific orphan from the bug report: to-setup at both 06 and 07.
    expect(left).toContain("walkthrough-07-to-setup.jpg");
    expect(left).not.toContain("walkthrough-06-to-setup.jpg");
    expect(left).toContain("onboarding-01-intro.jpg");
    expect(left).toContain("notes.txt");
  });
});
