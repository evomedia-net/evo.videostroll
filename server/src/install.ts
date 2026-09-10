// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Installing this repo onto the machine that runs it - the decisions, without
 * the side effects.
 *
 * "Deploy" here is not a server. It is three things that have to be true at
 * once, and a `git pull` is only the first:
 *
 *   1. the source is current
 *   2. `server/dist/` is REBUILT from it - dist is gitignored, and the
 *      registered MCP server runs dist/index.js, so a pull alone leaves the
 *      running server on stale compiled code
 *   3. the skill is copied out to ~/.claude/skills/videostroll/ - a separate
 *      step, because the skill is edited in the repo and copied out, never the
 *      reverse
 *
 * Step 3 is the one that rots: nothing detects the drift, and a stale skill
 * teaches the agent an older method than the tools it is calling. So the
 * script reports every step rather than doing them quietly, and `--check`
 * reports without changing anything.
 *
 * scripts/deploy-local.mjs runs it; the decisions live here so they can be
 * tested without a git repo or a home directory.
 */
import { join } from "node:path";

/** Where a Claude Code skill is installed, relative to the user's home. */
export const SKILL_INSTALL_SEGMENTS = [".claude", "skills", "videostroll"] as const;

export function skillTarget(home: string): string {
  return join(home, ...SKILL_INSTALL_SEGMENTS, "SKILL.md");
}

export interface RepoState {
  branch: string;
  defaultBranch: string;
  /** Paths git reports as modified, staged or untracked. */
  dirty: string[];
}

export type PullVerdict =
  | { pull: true }
  | { pull: false; reason: string };

/**
 * Whether it is safe to pull.
 *
 * Refusing is the useful answer more often than it looks. A dirty tree pulled
 * over is how uncommitted work disappears, and a feature branch fast-forwarded
 * to main is not something anyone asked for. Both are recoverable, and both
 * would be a surprise from a command whose name says "deploy".
 */
export function pullVerdict(state: RepoState): PullVerdict {
  if (state.dirty.length > 0) {
    const shown = state.dirty.slice(0, 3).join(", ");
    const more = state.dirty.length > 3 ? ` and ${state.dirty.length - 3} more` : "";
    return { pull: false, reason: `the tree has uncommitted changes (${shown}${more}) - commit or stash them, or pass --no-pull` };
  }
  if (state.branch !== state.defaultBranch) {
    return { pull: false, reason: `on ${state.branch}, not ${state.defaultBranch} - pass --no-pull to build this branch as it is` };
  }
  return { pull: true };
}

export type FileVerdict = "same" | "differs" | "missing";

/** Compare what is installed against what the repo says. Content, not timestamps. */
export function compare(repoText: string | null, installedText: string | null): FileVerdict {
  if (installedText === null) return "missing";
  if (repoText === null) return "missing";
  return normalise(repoText) === normalise(installedText) ? "same" : "differs";
}

/**
 * Line endings are not a difference worth reporting. The repo is checked out
 * with autocrlf on this machine, so a byte compare calls an unchanged file
 * changed and the script would copy on every run and claim it did something.
 */
function normalise(text: string): string {
  return text.replace(/\r\n/g, "\n").trimEnd();
}

export interface StepResult {
  name: string;
  /** What happened, in the past tense, for the report. */
  detail: string;
  changed: boolean;
  /** The step refused to run - a dirty tree, the wrong branch. Not "current". */
  blocked?: boolean;
}

/**
 * The closing summary.
 *
 * A blocked step is called out rather than folded into "nothing changed": a
 * refusal to pull and an already-current checkout both leave nothing changed,
 * and reporting them the same way told you everything was fine when it had
 * declined to do the main thing you asked for.
 */
export function summarise(steps: StepResult[], checkOnly: boolean): string {
  const changed = steps.filter((s) => s.changed);
  const blocked = steps.filter((s) => s.blocked);
  const parts: string[] = [];

  if (changed.length > 0) {
    const verb = checkOnly ? "would change" : "changed";
    parts.push(`${changed.length} ${changed.length === 1 ? "thing" : "things"} ${verb}: ${changed.map((s) => s.name).join(", ")}`);
  }
  if (blocked.length > 0) {
    parts.push(`${blocked.length} skipped: ${blocked.map((s) => s.name).join(", ")} - see above`);
  }
  if (parts.length === 0) {
    return checkOnly ? "Everything is current - nothing to do." : "Already current - nothing changed.";
  }
  return parts.join(". ");
}
