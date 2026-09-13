/**
 * The docs site publishes an llms.txt, and it has to survive our own parser.
 *
 * This is the one file in the repository whose audience is a machine reading
 * it unattended, and the machine most likely to read it is this product. A
 * scan of the site returned `found: false` until it existed - the tool whose
 * headline feature is reading llms.txt published none of its own.
 *
 * The failure mode it guards against is not a missing file but a silently
 * unparseable one: the link and definition forms are regex-matched, so a
 * stray character or a re-worded line drops an entry with no error anywhere.
 * Nobody reads llms.txt by eye, so nothing else would catch it.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isTaskTitle, parseLlmsTxt } from "../src/docs.js";

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const BASE = "https://example.test/quickstart.html";

const read = () => readFile(join(REPO, "docs", "llms.txt"), "utf8");

describe("the docs site's own llms.txt", () => {
  it("names every page the site serves, with a gloss on each", async () => {
    const { terms } = parseLlmsTxt(await read(), BASE);
    const byTerm = new Map(terms.map((t) => [t.term, t.gloss]));
    for (const page of ["Quickstart", "Set up a walkthrough", "Voices"]) {
      expect(byTerm.get(page), `${page} missing or without a gloss`).toBeTruthy();
    }
  });

  it("links resolve to the pages that exist", async () => {
    const { tasks } = parseLlmsTxt(await read(), BASE);
    // Only the task-shaped titles come back with URLs; that one is enough to
    // prove relative hrefs resolve against the site rather than being dropped.
    expect(tasks.map((t) => t.url)).toContain("https://example.test/setup.html");
  });

  it("offers at least one task, so a scan has a route to follow", async () => {
    const { tasks } = parseLlmsTxt(await read(), BASE);
    expect(tasks.length).toBeGreaterThan(0);
    for (const t of tasks) expect(isTaskTitle(t.title)).toBe(true);
  });

  it("defines the vocabulary a walkthrough of this product needs", async () => {
    const { terms } = parseLlmsTxt(await read(), BASE);
    const names = terms.map((t) => t.term);
    for (const word of ["storyboard", "step", "chapter", "cue", "manifest"]) {
      expect(names, `"${word}" is not defined`).toContain(word);
    }
  });

  it("carries no markup or entities - it is read aloud, not rendered", async () => {
    const text = await read();
    expect(text).not.toMatch(/<[a-z/]/i);
    expect(text).not.toMatch(/&[a-z]+;|&#\d+;/i);
  });
});
