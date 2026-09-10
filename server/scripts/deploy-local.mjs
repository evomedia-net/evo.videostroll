#!/usr/bin/env node
/**
 * Put this repo's current state onto the machine that runs it.
 *
 *   npm run deploy:local              pull, build, copy the skill out
 *   npm run deploy:local -- --check   report what is stale, change nothing
 *   npm run deploy:local -- --no-pull build and copy this branch as it is
 *
 * There is no server to deploy to. "Deployed" means three things are true at
 * once, and a `git pull` is only the first of them:
 *
 *   1. the source is current
 *   2. server/dist is rebuilt from it - dist is gitignored and the registered
 *      MCP server runs dist/index.js, so a pull alone leaves the running
 *      server on stale compiled code
 *   3. the skill is copied to ~/.claude/skills/videostroll/ - edited in the
 *      repo and copied out, never the reverse
 *
 * The third is the one that rots. Nothing detects the drift, and a stale skill
 * teaches the agent an older method than the tools it is calling. So every
 * step reports, and --check reports without touching anything.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SERVER = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REPO = resolve(SERVER, "..");
const argv = process.argv.slice(2);
const TSC = join(SERVER, "node_modules", "typescript", "bin", "tsc");
const TSCONFIG = join(SERVER, "tsconfig.json");

/**
 * This script's own decisions live in src/install.ts so they can be tested,
 * which means it needs dist/install.js to run at all. On a fresh checkout that
 * does not exist yet, so build once to bootstrap - and note that this is NOT
 * the build that matters: the real one happens after the pull, because a build
 * before it would compile source that is about to be replaced.
 */
const distInstall = resolve(SERVER, "dist", "install.js");
if (!existsSync(distInstall)) {
  console.log("  (first run: building so this script can load its own logic)");
  execFileSync(process.execPath, [TSC, "-p", TSCONFIG], { cwd: SERVER, stdio: "inherit" });
}
const { compare, pullVerdict, skillTarget, summarise } = await import(pathToFileURL(distInstall).href);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`
Usage:
  npm run deploy:local              pull, build, copy the skill out
  npm run deploy:local -- --check   report what is stale, change nothing
  npm run deploy:local -- --no-pull build and copy this branch as it is
`);
  process.exit(0);
}

const checkOnly = argv.includes("--check");
const noPull = argv.includes("--no-pull");
const steps = [];

const git = (...args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();

/**
 * `git status --porcelain` must NOT go through the trimming helper above. Its
 * status column is two characters and an unstaged change leaves the first one
 * blank, so trimming the whole output eats the leading space of the first line
 * - and the fixed-width slice then takes a character off that filename too. It
 * reported "erver/package.json".
 */
const dirtyPaths = () =>
  execFileSync("git", ["status", "--porcelain"], { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).trim());

const read = async (p) => {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
};

function say(name, detail, changed, blocked = false) {
  steps.push({ name, detail, changed, blocked });
  console.log(`  ${blocked ? "!" : changed ? "*" : " "} ${name.padEnd(8)} ${detail}`);
}

console.log(`\nevo.videostroll -> this machine${checkOnly ? "  (check only)" : ""}\n`);

// ── 1. source ───────────────────────────────────────────────────────────────
let head = git("rev-parse", "--short", "HEAD");
if (noPull) {
  say("source", `left alone on ${git("rev-parse", "--abbrev-ref", "HEAD")} at ${head} (--no-pull)`, false);
} else {
  const dirty = dirtyPaths();
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  // The default branch as the remote states it, not a guess.
  let defaultBranch = "main";
  try {
    defaultBranch = git("symbolic-ref", "--short", "refs/remotes/origin/HEAD").replace(/^origin\//, "");
  } catch {
    /* no origin/HEAD; main is the fleet default */
  }
  const verdict = pullVerdict({ branch, defaultBranch, dirty });
  if (!verdict.pull) {
    // Blocked, not "current": a refusal to pull leaves nothing changed, and so
    // does an up-to-date checkout. Reporting them alike says everything is
    // fine when the main thing asked for did not happen.
    say("source", `NOT pulled - ${verdict.reason}`, false, true);
  } else if (checkOnly) {
    execFileSync("git", ["fetch", "origin", "--quiet"], { cwd: REPO });
    const behind = git("rev-list", "--count", `HEAD..origin/${defaultBranch}`);
    say("source", behind === "0" ? `up to date at ${head}` : `${behind} commit(s) behind origin/${defaultBranch}`, behind !== "0");
  } else {
    execFileSync("git", ["pull", "--ff-only", "--quiet"], { cwd: REPO, stdio: "inherit" });
    const after = git("rev-parse", "--short", "HEAD");
    const pulled = after !== head;
    say("source", pulled ? `pulled ${head} -> ${after}` : `already at ${head}`, pulled);
    head = after;
  }
}

// ── 2. the build the MCP server actually runs ───────────────────────────────
const distEntry = join(SERVER, "dist", "index.js");
if (checkOnly) {
  const built = existsSync(distEntry);
  say("build", built ? "dist/index.js present (run without --check to rebuild)" : "dist/index.js MISSING - the registered server cannot start", !built);
} else {
  // Always rebuild rather than guess from timestamps: dist is gitignored, so
  // there is no way to know what it was built from.
  execFileSync(process.execPath, [TSC, "-p", TSCONFIG], { cwd: SERVER, stdio: "inherit" });
  say("build", `rebuilt server/dist from ${head}`, true);
}

// ── 3. the skill, copied out ────────────────────────────────────────────────
const source = join(REPO, "skill", "SKILL.md");
const target = skillTarget(homedir());
const [repoText, installedText] = await Promise.all([read(source), read(target)]);
const verdict = compare(repoText, installedText);

if (repoText === null) {
  say("skill", "skill/SKILL.md is missing from the repo - nothing to install", false, true);
} else if (verdict === "same") {
  say("skill", `already matches ${target}`, false);
} else if (checkOnly) {
  say("skill", verdict === "missing" ? `not installed at ${target}` : `differs from ${target}`, true);
} else {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, repoText, "utf8");
  say("skill", `${verdict === "missing" ? "installed" : "updated"} ${target}`, true);
}

// ── the state that results ──────────────────────────────────────────────────
const stamp = JSON.parse((await read(join(REPO, "build-version.json"))) ?? "{}");
console.log(`\n  version  ${stamp.version ?? "unknown"}`);

// Best effort: the registration is a Claude Code thing and this repo does not
// require Claude Code. Silence beats a scary error for someone using another
// MCP client.
try {
  const out = execFileSync("claude", ["mcp", "get", "videostroll"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  console.log(`  mcp      ${/Connected/i.test(out) ? "registered and connected" : "registered, NOT connected - check the path it points at"}`);
} catch {
  console.log(`  mcp      not registered here (claude mcp add -s user videostroll -- node "${distEntry}")`);
}

console.log(`\n${summarise(steps, checkOnly)}\n`);
