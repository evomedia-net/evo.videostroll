/**
 * The skill has to reach a machine that installed this from npm.
 *
 * The server and the skill are two halves of one thing, and until now only one
 * half was published: `files` did not include the skill, and the single
 * documented instruction was `cp skill/SKILL.md ...` against a directory an
 * npm user does not have. Someone following the README from npm ended up with
 * a recorder and no method, with nothing saying so.
 *
 * The last test here is the one that matters. It runs a real `npm pack` and
 * looks inside the tarball, because every other check in this file would still
 * pass if `files` or `prepack` quietly stopped carrying the skill.
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decide, installSkill, skillSource } from "../src/skill-install.js";
import { skillTarget } from "../src/install.js";

const SERVER = fileURLToPath(new URL("..", import.meta.url));

describe("deciding what to do", () => {
  it("installs when nothing is there", () => {
    expect(decide("the skill", null)).toBe("installed");
  });

  it("says nothing to do when the copy already matches", () => {
    expect(decide("the skill", "the skill")).toBe("already current");
  });

  it("tolerates line endings, so Windows does not reinstall every run", () => {
    expect(decide("a\nb\n", "a\r\nb\r\n")).toBe("already current");
  });

  it("overwrites a stale copy", () => {
    // Deliberate: the skill is generated from the package, not edited in
    // place, and an old method the agent silently follows is the bad outcome.
    expect(decide("new method", "old method")).toBe("installed");
  });

  it("says so when the package has no skill in it", () => {
    expect(decide(null, "anything")).toBe("no skill in this package");
  });
});

describe("installing", () => {
  /** A package root shaped like the published tarball. */
  function packaged(body: string): string {
    const root = mkdtempSync(join(tmpdir(), "videostroll-pkg-"));
    mkdirSync(join(root, "skill"), { recursive: true });
    writeFileSync(join(root, "skill", "SKILL.md"), body, "utf8");
    return root;
  }

  it("writes the skill where Claude Code looks", () => {
    const root = packaged("# the method\n");
    const home = mkdtempSync(join(tmpdir(), "videostroll-home-"));

    const first = installSkill(root, home);
    expect(first.outcome).toBe("installed");
    expect(first.target).toBe(skillTarget(home));
    expect(readFileSync(first.target, "utf8")).toBe("# the method\n");

    // Running it twice is not an error and does not rewrite.
    expect(installSkill(root, home).outcome).toBe("already current");
  });

  it("reports rather than throws when the package carries no skill", () => {
    const root = mkdtempSync(join(tmpdir(), "videostroll-pkg-"));
    const home = mkdtempSync(join(tmpdir(), "videostroll-home-"));
    expect(installSkill(root, home).outcome).toBe("no skill in this package");
  });

  it("looks for the skill inside the package, not beside the repo", () => {
    expect(skillSource("/pkg")).toBe(join("/pkg", "skill", "SKILL.md"));
  });
});

describe("the published tarball", () => {
  it("actually contains the skill, the schema, the README and the licence", () => {
    // `npm pack --dry-run` runs prepack, so this exercises the real copy step
    // and the real `files` list - the two places the skill can go missing.
    // execSync with one fixed string: npm is a .cmd on Windows, which Node
    // refuses to run through execFileSync without a shell, and passing an args
    // array THROUGH a shell is deprecated. A constant command line is neither.
    const out = execSync("npm pack --dry-run --json", { cwd: SERVER, encoding: "utf8" });
    const files: string[] = JSON.parse(out)[0].files.map((f: { path: string }) => f.path);

    expect(files).toContain("skill/SKILL.md");
    expect(files).toContain("README.md");
    expect(files).toContain("LICENSE");
    expect(files.some((f) => f.startsWith("schema/"))).toBe(true);
    expect(files).toContain("dist/index.js");
  });

  it("is publishable - `private` would make npm refuse", () => {
    const pkg = JSON.parse(readFileSync(join(SERVER, "package.json"), "utf8"));
    expect(pkg.private).toBeUndefined();
    expect(pkg.name).toBe("evo.videostroll");
    expect(pkg.license).toBe("MIT");
  });

  it("keeps the shebang, or npx installs a bin that will not run", () => {
    const dist = join(SERVER, "dist", "index.js");
    let first: string;
    try {
      first = readFileSync(dist, "utf8").split("\n")[0];
    } catch {
      // dist is a build artefact; the source is what has to carry it.
      first = readFileSync(join(SERVER, "src", "index.ts"), "utf8").split("\n")[0];
    }
    expect(first.trim()).toBe("#!/usr/bin/env node");
  });

  it("the source keeps the shebang too, which is where it comes from", () => {
    expect(readFileSync(join(SERVER, "src", "index.ts"), "utf8").split("\n")[0].trim())
      .toBe("#!/usr/bin/env node");
    expect(dirname(skillSource(SERVER))).toBe(join(SERVER, "skill"));
  });
});
