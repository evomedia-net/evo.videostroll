/**
 * The rules that keep a saved session out of the repository and honest about
 * what it holds. The browser half of `npm run login` needs a person and a real
 * sign-in; everything decidable without one is here, and runs offline.
 */
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe as suite, expect, it } from "vitest";
import { checkPath, defaultOutPath, describe, isEmpty, summarise, type StorageState } from "../src/auth.js";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 9);
/** Playwright writes cookie expiry in seconds, and -1 for a session cookie. */
const secs = (ms: number) => Math.floor(ms / 1000);

suite("isEmpty", () => {
  it("is true for the file a failed sign-in leaves behind", () => {
    // Playwright always writes something. A login that did not happen writes this.
    expect(isEmpty({ cookies: [], origins: [] })).toBe(true);
    expect(isEmpty({})).toBe(true);
    expect(isEmpty({ cookies: [], origins: [{ origin: "https://a.test", localStorage: [] }] })).toBe(true);
  });

  it("is false when anything at all was captured", () => {
    expect(isEmpty({ cookies: [{ name: "sid", domain: "a.test" }] })).toBe(false);
    // A site that keeps its token in localStorage and sets no cookie still counts.
    expect(isEmpty({ cookies: [], origins: [{ origin: "https://a.test", localStorage: [{ name: "token" }] }] })).toBe(false);
  });
});

suite("summarise", () => {
  const state: StorageState = {
    cookies: [
      { name: "sid", domain: "app.test", expires: secs(NOW + 30 * DAY) },
      { name: "csrf", domain: "app.test", expires: secs(NOW + 2 * DAY) },
      { name: "sso", domain: "id.test", expires: -1 },
      { name: "old", domain: "app.test", expires: secs(NOW - DAY) },
    ],
    origins: [{ origin: "https://app.test", localStorage: [{ name: "token", value: "SECRET" }, { name: "theme" }] }],
  };

  it("counts what is there and names only hosts", () => {
    const s = summarise(state, NOW);
    expect(s.cookies).toBe(4);
    expect(s.domains).toEqual(["app.test", "id.test"]);
    expect(s.origins).toBe(1);
    expect(s.localStorageKeys).toBe(2);
  });

  it("never carries a value out of the state", () => {
    // The whole point: this is printed to a terminal and pasted into chats.
    expect(JSON.stringify(summarise(state, NOW))).not.toContain("SECRET");
  });

  it("reports the soonest real expiry and counts the dead ones", () => {
    const s = summarise(state, NOW);
    expect(s.earliestExpiryMs).toBe(NOW - DAY); // the expired one is still the soonest
    expect(s.expired).toBe(1);
  });

  it("says nothing about expiry when every cookie is a session cookie", () => {
    const s = summarise({ cookies: [{ name: "sid", domain: "a.test", expires: -1 }] }, NOW);
    expect(s.earliestExpiryMs).toBeNull();
    expect(s.expired).toBe(0);
  });
});

suite("describe", () => {
  it("leads with what was captured", () => {
    const s = summarise({ cookies: [{ name: "sid", domain: "app.test", expires: secs(NOW + 10 * DAY) }] }, NOW);
    expect(describe(s, NOW)).toBe("1 cookie across 1 domain, first expiry in 10 days");
  });

  it("says so when the session is already stale", () => {
    const s = summarise({ cookies: [{ name: "sid", domain: "app.test", expires: secs(NOW - DAY) }] }, NOW);
    expect(describe(s, NOW)).toContain("1 already expired");
  });

  it("does not invent a lifetime for session cookies", () => {
    const s = summarise({ cookies: [{ name: "sid", domain: "app.test", expires: -1 }] }, NOW);
    expect(describe(s, NOW)).toContain("no stated lifetime");
  });
});

suite("defaultOutPath", () => {
  it("names the file after the host, under the ignored auth/ directory", () => {
    expect(defaultOutPath("https://app.example.com/login?next=%2Fx")).toBe("auth/app.example.com.storage-state.json");
    expect(defaultOutPath("http://localhost:8099/")).toBe("auth/localhost.storage-state.json");
  });
});

suite("checkPath", () => {
  it("accepts the default location, because this repo ignores auth/", () => {
    // Not a stub: git itself is asked, against this repository's real .gitignore.
    expect(checkPath("auth/app.storage-state.json", REPO).ok).toBe(true);
  });

  it("accepts any *.storage-state.json, which is ignored by name", () => {
    expect(checkPath("server/scratch.storage-state.json", REPO).ok).toBe(true);
  });

  it("refuses a path git would track, and says why", () => {
    const v = checkPath("docs/session.json", REPO);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("unreachable");
    expect(v.reason).toContain("git does not ignore it");
    expect(v.reason).toContain("hands over the account");
  });

  it("accepts a path outside the repository - git cannot track what it cannot see", () => {
    const outside = join(mkdtempSync(join(tmpdir(), "videostroll-auth-")), "state.json");
    expect(checkPath(outside, REPO).ok).toBe(true);
  });

  it("asks git rather than matching patterns itself", () => {
    // A repo whose ignore rules are nothing like ours: the verdict must follow
    // that repo's rules, not a list baked in here.
    const other = mkdtempSync(join(tmpdir(), "videostroll-repo-"));
    mkdirSync(join(other, "secrets"));
    writeFileSync(join(other, ".gitignore"), "secrets/\n");
    const ignored = (p: string) => p.replace(/\\/g, "/").includes("/secrets/");
    expect(checkPath("secrets/state.json", other, ignored).ok).toBe(true);
    expect(checkPath("auth/state.json", other, ignored).ok).toBe(false);
  });
});

suite("against a real Playwright storage state", () => {
  // The synthetic states above encode two assumptions about Playwright's
  // output: that cookie `expires` is in SECONDS, and that a session cookie is
  // -1. Both are load-bearing - seconds read as milliseconds would put every
  // expiry in 1970 and report a live session as long dead. So pin them against
  // what Playwright actually writes. Offline: no page is loaded.
  it("reads seconds, and -1 for a session cookie", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext();
      const expires = Math.floor((Date.now() + 30 * DAY) / 1000);
      await context.addCookies([
        { name: "sid", value: "not-read", domain: "app.test", path: "/", expires },
        { name: "sso", value: "not-read", domain: "id.test", path: "/" }, // no expiry -> session cookie
      ]);
      const state = await context.storageState();

      expect(isEmpty(state)).toBe(false);
      const s = summarise(state, Date.now());
      expect(s.cookies).toBe(2);
      expect(s.domains).toEqual(["app.test", "id.test"]);
      expect(s.expired).toBe(0);
      // Seconds, not milliseconds: the value we set comes back as the same instant.
      expect(s.earliestExpiryMs).toBe(expires * 1000);
      expect(describe(s, Date.now())).toContain("first expiry in 29 days");
      expect(JSON.stringify(s)).not.toContain("not-read");
    } finally {
      await browser.close();
    }
  });

  it("a context that never signed in produces an empty state", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
      const state = await (await browser.newContext()).storageState();
      expect(isEmpty(state)).toBe(true);
      expect(describe(summarise(state))).toBe("nothing captured");
    } finally {
      await browser.close();
    }
  });
});
