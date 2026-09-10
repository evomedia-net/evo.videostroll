/**
 * The decisions `npm run deploy:local` makes, without the side effects.
 *
 * The script pulls, rebuilds and copies the skill out. Two of those can lose
 * work if the decision is wrong - pulling over a dirty tree, or fast-forwarding
 * a feature branch nobody asked to move - so the decision is separated from the
 * doing and tested here.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compare, pullVerdict, SKILL_INSTALL_SEGMENTS, skillTarget, summarise } from "../src/install.js";

describe("pullVerdict", () => {
  const clean = { branch: "main", defaultBranch: "main", dirty: [] as string[] };

  it("pulls a clean checkout of the default branch", () => {
    expect(pullVerdict(clean)).toEqual({ pull: true });
  });

  it("refuses a dirty tree, and names what is dirty", () => {
    // Pulling over uncommitted work is how it disappears.
    const v = pullVerdict({ ...clean, dirty: ["server/src/session.ts", "README.md"] });
    expect(v.pull).toBe(false);
    if (v.pull) throw new Error("unreachable");
    expect(v.reason).toContain("server/src/session.ts");
    expect(v.reason).toContain("README.md");
    expect(v.reason).toContain("--no-pull");
  });

  it("does not list every dirty file when there are many", () => {
    const v = pullVerdict({ ...clean, dirty: ["a", "b", "c", "d", "e"] });
    if (v.pull) throw new Error("unreachable");
    expect(v.reason).toContain("and 2 more");
  });

  it("refuses to fast-forward a branch that is not the default", () => {
    // Silently moving someone off their feature branch is not a deploy.
    const v = pullVerdict({ ...clean, branch: "feat/whatever" });
    expect(v.pull).toBe(false);
    if (v.pull) throw new Error("unreachable");
    expect(v.reason).toContain("feat/whatever");
    expect(v.reason).toContain("main");
  });

  it("reports the dirty tree first when both are wrong", () => {
    // The recoverable-but-alarming one is the uncommitted work.
    const v = pullVerdict({ branch: "feat/x", defaultBranch: "main", dirty: ["notes.md"] });
    if (v.pull) throw new Error("unreachable");
    expect(v.reason).toContain("uncommitted");
  });

  it("respects a repo whose default branch is not main", () => {
    expect(pullVerdict({ branch: "master", defaultBranch: "master", dirty: [] })).toEqual({ pull: true });
  });
});

describe("compare", () => {
  it("calls a missing install missing", () => {
    expect(compare("x", null)).toBe("missing");
  });

  it("ignores line endings", () => {
    // The tree is checked out with autocrlf on this machine. A byte compare
    // would call every file changed and the script would copy on every run
    // while claiming it had done something.
    expect(compare("a\r\nb\r\n", "a\nb\n")).toBe("same");
  });

  it("ignores trailing whitespace at the end of the file", () => {
    expect(compare("a\nb", "a\nb\n\n")).toBe("same");
  });

  it("still sees a real difference", () => {
    expect(compare("one line", "another line")).toBe("differs");
    // A single changed word is what a stale skill looks like.
    expect(compare("use npm run login", "use npm run signin")).toBe("differs");
  });
});

describe("skillTarget", () => {
  it("installs where Claude Code looks for a skill", () => {
    expect(skillTarget("/home/kelly")).toBe(join("/home/kelly", ".claude", "skills", "videostroll", "SKILL.md"));
  });

  it("is home-relative, so nothing machine-specific is baked in", () => {
    expect(SKILL_INSTALL_SEGMENTS.join("/")).toBe(".claude/skills/videostroll");
    expect(skillTarget("C:\\Users\\someone")).toContain("videostroll");
  });
});

describe("summarise", () => {
  const step = (name: string, changed: boolean) => ({ name, detail: "", changed });

  it("says plainly when nothing moved", () => {
    expect(summarise([step("source", false), step("build", false)], false)).toBe("Already current - nothing changed.");
    expect(summarise([step("source", false)], true)).toBe("Everything is current - nothing to do.");
  });

  it("names what moved, and uses the right tense for --check", () => {
    expect(summarise([step("source", true), step("build", true), step("skill", false)], false)).toBe("2 things changed: source, build");
    expect(summarise([step("skill", true)], true)).toBe("1 thing would change: skill");
  });
});

describe("summarise, blocked steps", () => {
  const step = (name: string, changed: boolean, blocked = false) => ({ name, detail: "", changed, blocked });

  it("does not call a refusal 'current'", () => {
    // The bug this fixes: a dirty tree refused the pull, nothing else changed,
    // and the script signed off with "Everything is current - nothing to do."
    const out = summarise([step("source", false, true), step("build", false), step("skill", false)], true);
    expect(out).not.toContain("current");
    expect(out).toContain("1 skipped: source");
  });

  it("reports what changed and what was skipped together", () => {
    const out = summarise([step("source", false, true), step("build", true), step("skill", true)], false);
    expect(out).toContain("2 things changed: build, skill");
    expect(out).toContain("1 skipped: source");
  });
});
