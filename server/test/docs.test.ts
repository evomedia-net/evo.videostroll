/**
 * The docs must not restate the build number.
 *
 * The README carried `v0.0.0.1.3` in its header line. Every release moved
 * build-version.json and left that line behind, so the first thing a reader
 * saw was a version the repo had not been on for some time. It was corrected
 * by hand twice in one day and drifted again within the hour, because the
 * bump is automated and the prose is not.
 *
 * A copy that has to be maintained in step with a generated value will lose
 * step. So there is only one copy: build-version.json and the git tag. The
 * docs name the stage, which changes rarely and deliberately, and point at
 * the file for the rest.
 *
 * This does not forbid a five-segment version everywhere - an example that
 * shows the format is fine. It forbids one presented as *this project's
 * current version*, which is what the header line was.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const FIVE_SEGMENT = /v\d+\.\d+\.\d+\.\d+\.\d+/;

/** The header line: the first non-empty line after the title and its underline. */
async function headerLine(name: string): Promise<string> {
  const lines = (await readFile(join(REPO, name), "utf8")).split(/\r?\n/);
  const body = lines.filter((l) => l.trim() !== "" && !/^[=-]{3,}$/.test(l.trim()));
  return body.slice(1, 3).join(" ");
}

describe("the docs do not restate the build number", () => {
  it.each(["README.md", "README.txt"])("%s names the stage, not the build", async (name) => {
    const line = await headerLine(name);
    expect(line).not.toMatch(FIVE_SEGMENT);
    expect(line.toLowerCase()).toMatch(/alpha|beta|rc|released/);
    expect(line).toContain("build-version.json");
  });

  it("build-version.json is the one place that carries it", async () => {
    const stamp = JSON.parse(await readFile(join(REPO, "build-version.json"), "utf8"));
    expect(stamp.version).toMatch(/^v\d+\.\d+\.\d+\.\d+\.\d+$/);
  });

  /**
   * The same failure, one file over. The quickstart said "68 tests" while the
   * suite was at 193 - a number in prose that nothing regenerates, exactly
   * like the build number this file was written for. A count is not worth
   * restating: the reader runs the suite and sees the real one.
   */
  it("the quickstart does not restate a test count or a version", async () => {
    const page = await readFile(join(REPO, "docs", "quickstart.html"), "utf8");
    expect(page).not.toMatch(/\d+\s+tests?\b/i);
    expect(page).not.toMatch(FIVE_SEGMENT);
  });

  it("the two READMEs still agree on that line", async () => {
    // The .txt is a twin of the .md; if one is edited without the other, the
    // stage or the pointer will differ.
    const md = (await headerLine("README.md")).replace(/[`*[\]]|\(build-version\.json\)/g, "");
    const txt = await headerLine("README.txt");
    expect(md.replace(/\s+/g, " ").trim()).toBe(txt.replace(/\s+/g, " ").trim());
  });
});
