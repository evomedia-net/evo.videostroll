/**
 * No document names a path on somebody's workstation.
 *
 * A drive-letter path is true on exactly one machine. In a document it is
 * worse than useless: it tells a reader nothing they can act on, it leaks the
 * shape of a private disk, and it stops being true the moment the checkout
 * moves. The portable forms say the same thing and keep saying it: a
 * repo-relative path, or a `C:/path/to/...` placeholder the reader replaces.
 *
 * This repository is clean today - the two drive paths in it are the MCP
 * stanza's `C:/path/to/...`, which is the placeholder, not a path. The check
 * is here so it stays that way: these come back one pasted command at a time,
 * and nothing says so until someone reads the file.
 *
 * The .txt twins are read too. A twin is generated from its markdown, so a
 * path pasted into README.md propagates into a second file that then looks
 * like an independent source - and SKILL.txt and docs/llms.txt are read by
 * machines that will never see the markdown at all.
 *
 * Ported from evo.ehs tests/test_no_local_paths.py and evo.provensheet
 * scripts/no-local-paths.test.mjs, so the rule is the same across the fleet.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The documents live at the REPOSITORY root, while this test and its package
// live under server/ - the same two-level climb md-twin.test.ts makes, and for
// the same reason.
const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

// A drive letter is matched as a SINGLE character with a non-word character
// before it, or `http://host` reads as drive `p` and every document with a
// link in it fails - which, for the changelog, is every line.
const LOCAL_PATH = new RegExp(
  [
    "(?<![A-Za-z0-9])(?:",
    "[A-Za-z]:[\\\\/]{1,2}[A-Za-z0-9_.]", // C:\x, F:/x, F:\\x
    "|/mnt/[a-z]/", //                       WSL's view of a Windows drive
    "|/[a-z]/evomedia", //                   Git Bash's view of one
    ")",
  ].join(""),
);

// Spellings that are already placeholders and say so, so they are not paths to
// anywhere. `C:/path/to` is this repo's: the README and SKILL.md both show the
// MCP server stanza with it, forward slashes because that is what goes in JSON
// on Windows. `C:\path\to` and `<drive>\<parent>` are the rest of the fleet's.
const PLACEHOLDERS = ["C:/path/to", "C:\\path\\to", "<drive>\\<parent>"];

// Documents whose SUBJECT is a literal path, where there is nothing portable to
// put instead. Add to this only for that reason - "it is only in a code block"
// is not one, because that is the case this test exists for.
const EXEMPT = new Set<string>([]);

// Asked of git rather than of the disk: a walk finds node_modules, dist/,
// prepack's copies of the docs under server/ and whatever scratch file is lying
// around, and would fail the suite over a file that is not ours.
function documents(): string[] {
  return execFileSync("git", ["-C", REPO, "ls-files", "-z", "--", "*.md", "*.txt"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .split("\u0000")
    .filter(Boolean);
}

describe("no document names a workstation path", () => {
  // A positive control. If discovery silently returned nothing - git off PATH,
  // a changed flag, the two-level climb landing somewhere else - the real
  // check below would pass while reading no files at all, and would be gone
  // without a word.
  it("finds the documents to check", () => {
    const found = documents();
    expect(found.length).toBeGreaterThan(10);
    expect(found).toContain("README.md");
    expect(found).toContain("skill/SKILL.txt");
  });

  // The check can fail, not just pass. The made-up drive letters keep this
  // file from spelling out the real layout in order to guard it.
  it("catches a real path and spares a URL", () => {
    expect(LOCAL_PATH.test("cd X:\\evomedia.net\\evo.videostroll")).toBe(true);
    expect(LOCAL_PATH.test("node Y:/evo.videostroll/server/dist/index.js")).toBe(true);
    expect(LOCAL_PATH.test("ls /mnt/x/evomedia.net/evo.videostroll")).toBe(true);
    expect(LOCAL_PATH.test("at C:\\Users\\Someone Else\\Desktop")).toBe(true);
    expect(LOCAL_PATH.test("http://localhost:4321/docs")).toBe(false);
    expect(LOCAL_PATH.test("https://github.com/evomedia-net/evo.videostroll")).toBe(false);
    expect(LOCAL_PATH.test("run `npm run render` from server/")).toBe(false);
  });

  // The placeholder has to survive, or the MCP setup stanza cannot be written
  // at all - and a check that makes the install instructions unwritable gets
  // deleted rather than tightened.
  it("spares the placeholder the install stanza needs", () => {
    const spared = (line: string) => PLACEHOLDERS.some((holder) => line.includes(holder));
    expect(spared('"args": ["C:/path/to/evo.videostroll/server/dist/index.js"]')).toBe(true);
    expect(spared("unzip it to C:\\path\\to\\somewhere")).toBe(true);
    expect(spared("cd X:\\evomedia.net\\evo.videostroll")).toBe(false);
  });

  it("no document names one", () => {
    const offenders: string[] = [];
    for (const rel of documents()) {
      if (EXEMPT.has(rel) || EXEMPT.has(rel.replace(/\.txt$/, ".md"))) continue;
      const text = readFileSync(join(REPO, rel), "utf8");
      text.split(/\r?\n/).forEach((line, index) => {
        if (PLACEHOLDERS.some((holder) => line.includes(holder))) return;
        if (LOCAL_PATH.test(line)) {
          offenders.push(`${rel}:${index + 1}: ${line.trim().slice(0, 120)}`);
        }
      });
    }
    expect(
      offenders,
      "a path that is only true on one machine: write it relative to the "
        + "repository instead, or use the C:/path/to placeholder",
    ).toEqual([]);
  });
});
