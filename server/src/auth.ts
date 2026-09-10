// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Storage state: how a walkthrough gets behind a login without anyone typing a
 * password where the agent can see it.
 *
 * The human signs in themselves, in a real browser window, and Playwright saves
 * the resulting cookies and localStorage to a file. The storyboard names that
 * file. The agent passes the path and never learns what was typed.
 *
 * The file itself IS a credential - a live session, usually longer-lived than a
 * password and not protected by a second factor. So the rules here are about
 * keeping it out of the repo and telling the truth about what it holds:
 *
 *   - refuse to write it anywhere git would track (checkPath)
 *   - refuse to save one that captured nothing (isEmpty)
 *   - describe it without ever reading a value (summarise)
 *
 * scripts/login.mjs drives the browser; everything decidable without one lives
 * here, so it can be tested offline.
 */
import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";

/** The subset of Playwright's storage state this module reasons about. */
export interface StorageState {
  cookies?: Array<{ name: string; domain: string; expires?: number }>;
  origins?: Array<{ origin: string; localStorage?: Array<{ name: string; value?: string }> }>;
}

export interface StateSummary {
  cookies: number;
  /** Cookie domains, deduplicated and sorted. Names of hosts, never values. */
  domains: string[];
  origins: number;
  localStorageKeys: number;
  /**
   * Soonest expiry among cookies that have one, as epoch milliseconds, or null
   * when every cookie is a session cookie. Session cookies outlive the file
   * only because Playwright replays them; they have no stated lifetime.
   */
  earliestExpiryMs: number | null;
  /** Cookies already past their expiry at `now`. A non-zero count means a stale file. */
  expired: number;
}

/**
 * Nothing was captured. Playwright always writes a well-formed file, so a
 * failed login produces an empty one rather than an error - which then fails
 * much later, as a walkthrough that quietly records the login page.
 */
export function isEmpty(state: StorageState): boolean {
  const cookies = state.cookies?.length ?? 0;
  const keys = (state.origins ?? []).reduce((n, o) => n + (o.localStorage?.length ?? 0), 0);
  return cookies === 0 && keys === 0;
}

/** Describe a state without reading a single value out of it. */
export function summarise(state: StorageState, now: number = Date.now()): StateSummary {
  const cookies = state.cookies ?? [];
  // Playwright writes `expires` in SECONDS, and -1 for a session cookie.
  const expiries = cookies.map((c) => c.expires).filter((e): e is number => typeof e === "number" && e > 0).map((e) => e * 1000);
  return {
    cookies: cookies.length,
    domains: [...new Set(cookies.map((c) => c.domain))].sort(),
    origins: (state.origins ?? []).length,
    localStorageKeys: (state.origins ?? []).reduce((n, o) => n + (o.localStorage?.length ?? 0), 0),
    earliestExpiryMs: expiries.length ? Math.min(...expiries) : null,
    expired: expiries.filter((e) => e <= now).length,
  };
}

/** `https://app.example.com/login?next=/x` -> `auth/app.example.com.storage-state.json` */
export function defaultOutPath(url: string): string {
  const host = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, "-");
  return `auth/${host}.storage-state.json`;
}

export type PathVerdict =
  | { ok: true; path: string }
  | { ok: false; path: string; reason: string };

/**
 * A storage-state file may only be written where git will not pick it up.
 *
 * `git check-ignore` is the authority rather than a pattern of our own: it is
 * the same answer `git add` will give, including any rule in a global or
 * nested ignore file. A path outside the repository is fine too - git cannot
 * track what it cannot see.
 */
export function checkPath(path: string, repoRoot: string, isIgnored: (p: string) => boolean = gitIgnores(repoRoot)): PathVerdict {
  const abs = resolve(repoRoot, path);
  const rel = relative(repoRoot, abs);
  const outsideRepo = rel.startsWith("..") || resolve(rel) === abs;
  if (outsideRepo) return { ok: true, path: abs };
  if (isIgnored(abs)) return { ok: true, path: abs };
  return {
    ok: false,
    path: abs,
    reason:
      `${rel.replace(/\\/g, "/")} is inside the repository and git does not ignore it. ` +
      `A storage-state file is a live session - committing one hands over the account. ` +
      `Write it under auth/ (already ignored), give it a .storage-state.json name, or put it outside the repo.`,
  };
}

/** The default ignore oracle: ask git. Returns false if git cannot answer. */
export function gitIgnores(repoRoot: string): (p: string) => boolean {
  return (p: string) => {
    try {
      execFileSync("git", ["check-ignore", "-q", "--", p], { cwd: repoRoot, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
}

/** Human-readable one-liner for a summary. Used by the script; here so it is tested. */
export function describe(s: StateSummary, now: number = Date.now()): string {
  if (s.cookies === 0 && s.localStorageKeys === 0) return "nothing captured";
  const parts = [`${s.cookies} cookie${s.cookies === 1 ? "" : "s"} across ${s.domains.length} domain${s.domains.length === 1 ? "" : "s"}`];
  if (s.localStorageKeys) parts.push(`${s.localStorageKeys} localStorage key${s.localStorageKeys === 1 ? "" : "s"} in ${s.origins} origin${s.origins === 1 ? "" : "s"}`);
  if (s.expired) parts.push(`${s.expired} already expired`);
  if (s.earliestExpiryMs === null) parts.push("all session cookies, no stated lifetime");
  else {
    const days = Math.floor((s.earliestExpiryMs - now) / 86_400_000);
    parts.push(days < 0 ? "earliest expiry has passed" : days === 0 ? "first expiry within a day" : `first expiry in ${days} day${days === 1 ? "" : "s"}`);
  }
  return parts.join(", ");
}
