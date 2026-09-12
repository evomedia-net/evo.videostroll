// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Getting the skill onto a machine that installed this from npm.
 *
 * The server and the skill are two halves of one thing: the server records,
 * and the skill is the method - reconnoitre, read the product's docs,
 * storyboard, narrate, verify. The server alone is a capable but undirected
 * recorder, which the README says in as many words.
 *
 * That was fine while the only way in was a git clone, because `skill/` was
 * sitting right there. It stopped being fine the moment `npx evo.videostroll`
 * became the install path: the tarball had no skill in it, and the only
 * documented instruction was `cp skill/SKILL.md ...` against a directory the
 * npm user does not have. So the skill now ships inside the package, and this
 * puts it where Claude Code looks.
 */

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type FileVerdict, compare, skillTarget } from "./install.js";

/** Where prepack puts the skill inside the published package. */
export function skillSource(packageRoot: string): string {
  return join(packageRoot, "skill", "SKILL.md");
}

export interface SkillInstallResult {
  source: string;
  target: string;
  /** What was done, or why it could not be. */
  outcome: "installed" | "already current" | "no skill in this package";
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * What installing would do, given what is on disk. Separated so the decision
 * can be tested without writing to anyone's home directory.
 */
export function decide(sourceText: string | null, targetText: string | null): SkillInstallResult["outcome"] {
  if (sourceText === null) return "no skill in this package";
  const verdict: FileVerdict = compare(sourceText, targetText);
  return verdict === "same" ? "already current" : "installed";
}

/**
 * Copy the bundled skill to ~/.claude/skills/videostroll/SKILL.md.
 *
 * Overwrites deliberately: the skill is generated from this package, not
 * edited in place, and a stale copy is the failure that is hard to notice -
 * the agent follows an older method and nothing says so.
 */
export function installSkill(packageRoot: string, home: string): SkillInstallResult {
  const source = skillSource(packageRoot);
  const target = skillTarget(home);
  const outcome = decide(readOrNull(source), readOrNull(target));
  if (outcome === "installed") {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  return { source, target, outcome };
}
