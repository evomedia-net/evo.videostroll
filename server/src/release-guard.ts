// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Whether it is honest to build a release zip right now.
 *
 * A release archive is named after a version, and people trust that name. Two
 * ways it can lie, and both were reachable:
 *
 *   1. The version is already tagged and the tree has moved on. Rebuilding
 *      then produces an archive called v0.0.0.1.7 containing something else.
 *      I did exactly this while testing: the committed zip for a tagged
 *      release was replaced with newer content, and nothing objected.
 *   2. The tree is dirty. The zip is built from working-tree files, so
 *      uncommitted edits go into a published artifact that no one reviewed.
 *
 * The decision is separated from the git calls so it can be tested without a
 * repository, which is the only way to exercise the combinations.
 */

export interface RepoFacts {
  /** Does a tag naming this exact version exist? */
  tagExists: boolean;
  /** Does the tagged commit's tree differ from HEAD's? Meaningless when there is no tag. */
  treeDiffersFromTag: boolean;
  /** Tracked files with uncommitted changes. */
  dirty: string[];
  /** The version being packaged, for the message. */
  version: string;
}

export type Verdict =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Refusing is the useful answer here more often than it looks, and neither
 * refusal is bypassed by `--force`: that flag means "overwrite the file", not
 * "publish something mislabelled". The explicit escape hatch is
 * `--allow-mismatch`, which a person has to type and read.
 */
export function releaseGuard(facts: RepoFacts): Verdict {
  if (facts.dirty.length > 0) {
    const shown = facts.dirty.slice(0, 3).join(", ");
    const more = facts.dirty.length > 3 ? ` and ${facts.dirty.length - 3} more` : "";
    return {
      ok: false,
      reason:
        `the tree has uncommitted changes (${shown}${more}), and the zip is built from ` +
        `working-tree files - they would ship inside a published release. Commit or stash them.`,
    };
  }
  if (facts.tagExists && facts.treeDiffersFromTag) {
    return {
      ok: false,
      reason:
        `${facts.version} is already tagged and this tree has moved past it, so the archive ` +
        `would carry contents its own name does not describe. Bump the version first, or check ` +
        `out ${facts.version} to rebuild exactly what was released.`,
    };
  }
  return { ok: true };
}
