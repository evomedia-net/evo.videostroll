/**
 * The guard that stops a release zip from lying about what is inside it.
 *
 * Unit tests over releaseGuard() are the cheap half and prove almost nothing
 * on their own: the bug this exists to prevent was not faulty logic, it was a
 * release script that never consulted any logic at all. So the half that
 * matters builds a real throwaway git repository, lays a real tag, moves the
 * tree, and runs the actual release.mjs against it - exit codes, message text
 * and all.
 *
 * The scenario reproduced below is the one that happened: v0.0.0.1.7 was
 * tagged, work continued, `--force` rebuilt the zip, and the archive bearing
 * that tag's name no longer held that tag's contents. Nothing objected.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { releaseGuard } from "../src/release-guard.js";

const SERVER = fileURLToPath(new URL("..", import.meta.url));
const VERSION = "v1.2.3.4.5";

describe("releaseGuard", () => {
  it("allows a clean tree at a version that has never been tagged", () => {
    expect(releaseGuard({ version: VERSION, tagExists: false, treeDiffersFromTag: false, dirty: [] }))
      .toEqual({ ok: true });
  });

  it("allows rebuilding a tagged version when the tree still matches the tag", () => {
    // Losing a release file and regenerating it byte-for-byte is legitimate.
    expect(releaseGuard({ version: VERSION, tagExists: true, treeDiffersFromTag: false, dirty: [] }))
      .toEqual({ ok: true });
  });

  it("refuses when the version is tagged and the tree has moved past it", () => {
    const verdict = releaseGuard({ version: VERSION, tagExists: true, treeDiffersFromTag: true, dirty: [] });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain(VERSION);
    expect(verdict.ok === false && verdict.reason).toMatch(/already tagged/);
  });

  it("refuses a dirty tree, and names the files", () => {
    const verdict = releaseGuard({
      version: VERSION,
      tagExists: false,
      treeDiffersFromTag: false,
      dirty: ["server/src/record.ts", "README.md"],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain("server/src/record.ts");
    expect(verdict.ok === false && verdict.reason).toContain("README.md");
  });

  it("summarises rather than printing a hundred paths", () => {
    const dirty = Array.from({ length: 12 }, (_, i) => `src/f${i}.ts`);
    const verdict = releaseGuard({ version: VERSION, tagExists: false, treeDiffersFromTag: false, dirty });
    expect(verdict.ok === false && verdict.reason).toContain("and 9 more");
    expect(verdict.ok === false && verdict.reason).not.toContain("src/f11.ts");
  });

  it("reports the dirty tree first when both problems are present", () => {
    // Uncommitted work is the one the person can act on immediately.
    const verdict = releaseGuard({
      version: VERSION,
      tagExists: true,
      treeDiffersFromTag: true,
      dirty: ["src/a.ts"],
    });
    expect(verdict.ok === false && verdict.reason).toContain("uncommitted");
  });
});

// ── the real script, against a real repository ──────────────────────────────

/** A miniature repo shaped like this one, so release.mjs's path maths lines up. */
function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "videostroll-guard-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "core.autocrlf=false", ...args], {
      cwd: repo,
      encoding: "utf8",
    });

  mkdirSync(join(repo, "server", "scripts"), { recursive: true });
  mkdirSync(join(repo, "server", "dist"), { recursive: true });
  cpSync(join(SERVER, "scripts", "release.mjs"), join(repo, "server", "scripts", "release.mjs"));

  // The two modules release.mjs imports, compiled from the real sources rather
  // than stubbed - a stub would let the wiring rot unnoticed, which is the
  // failure this file exists to catch.
  const require = createRequire(join(SERVER, "x.js"));
  const tsc = join(dirname(require.resolve("typescript")), "tsc.js");
  execFileSync(
    process.execPath,
    [tsc, join(SERVER, "src", "release-guard.ts"), join(SERVER, "src", "zip.ts"),
     "--outDir", join(repo, "server", "dist"),
     // --ignoreConfig: a file list on the command line does not read
     // tsconfig.json, and newer tsc treats the ambiguity as an error.
     "--ignoreConfig",
     "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext",
     "--types", "node", "--skipLibCheck"],
    { encoding: "utf8" },
  );

  writeFileSync(join(repo, "build-version.json"), JSON.stringify({ version: VERSION }) + "\n");
  writeFileSync(join(repo, "README.md"), "first\n");
  git("init", "-b", "main");
  git("add", "-A");
  git("commit", "-m", "initial");
  git("tag", "-a", VERSION, "-m", VERSION);
  return repo;
}

/** Run release.mjs the way npm would, and report what it decided. */
function release(repo: string, ...args: string[]) {
  const out = spawnSync(process.execPath, [join(repo, "server", "scripts", "release.mjs"), ...args], {
    cwd: repo,
    encoding: "utf8",
  });
  return { code: out.status, text: `${out.stdout ?? ""}${out.stderr ?? ""}` };
}

const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "core.autocrlf=false", ...args], {
    cwd: repo,
    encoding: "utf8",
  });

describe("npm run release, end to end", () => {
  let base: string;
  beforeAll(() => {
    base = makeRepo();
  });

  it("builds when the tree is clean and matches the tag", () => {
    const { code, text } = release(base);
    expect(text).not.toMatch(/Refusing/);
    expect(code).toBe(0);
    expect(text).toContain(`evo.videostroll-${VERSION}.zip`);
  });

  it("refuses once the source has moved past the tag - and --force does not help", () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "README.md"), "second\n");
    git(repo, "commit", "-am", "more work");

    const plain = release(repo);
    expect(plain.code).toBe(1);
    expect(plain.text).toMatch(/Refusing to build/);
    expect(plain.text).toMatch(/already tagged/);

    // The bug being fixed: --force used to be enough to overwrite a released
    // archive with contents from a different tree.
    const forced = release(repo, "--force");
    expect(forced.code).toBe(1);
    expect(forced.text).toMatch(/Refusing to build/);
  });

  it("refuses an uncommitted edit, which would otherwise ship inside the zip", () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "README.md"), "not committed\n");

    const { code, text } = release(repo);
    expect(code).toBe(1);
    expect(text).toMatch(/uncommitted changes/);
    expect(text).toContain("README.md");
  });

  it("still builds when only releases/ has moved since the tag", () => {
    // A version's zip and digest are committed AFTER its tag is laid, so they
    // are always "different from the tag". Counting them would make the guard
    // refuse every genuine release - the way a check becomes noise, then gets
    // switched off.
    const repo = makeRepo();
    mkdirSync(join(repo, "releases"), { recursive: true });
    writeFileSync(join(repo, "releases", "old.zip"), "pretend archive\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "chore: add the release artefacts");

    const { code, text } = release(repo);
    expect(text).not.toMatch(/Refusing/);
    expect(code).toBe(0);
  });

  it("--allow-mismatch overrides, and says so on the way past", () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "README.md"), "second\n");
    git(repo, "commit", "-am", "more work");

    const { code, text } = release(repo, "--force", "--allow-mismatch");
    expect(code).toBe(0);
    expect(text).toMatch(/WARNING \(--allow-mismatch\)/);
    expect(text).toMatch(/already tagged/);
  });
});
