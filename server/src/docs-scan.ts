// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Finding and fetching a site's documentation.
 *
 * The decisions all live in docs.ts, which is pure. This is the part that
 * touches the network, and it is deliberately thin: a fetch, a small crawl
 * bounded by BUDGET, and a browser fallback for the sites that arrive as an
 * empty shell.
 *
 * WHY TWO FETCHERS. Most documentation is statically generated and plain HTTP
 * gets it in one request. Some of it is a client-rendered app, and for those
 * plain HTTP gets `<div id="app"></div>` and nothing else - which would be
 * reported as "no docs found" and be wrong. Since this server already drives a
 * browser, the fallback costs a page load rather than a dependency. It is a
 * fallback and not the default because launching a browser to read a static
 * page is a poor trade, and most pages are static.
 */

import {
  BUDGET,
  type DocsDigest,
  type FetchedPage,
  candidates,
  harvest,
  isDocsLink,
  links,
  needsBrowser,
  robotsAllows,
  robotsDisallows,
  sameSite,
} from "./docs.js";

export interface ScanOptions {
  /** The site being walked through. */
  url: string;
  /** Skip discovery and start here. */
  docsUrl?: string;
  maxPages?: number;
  /** Playwright storage state, for documentation behind the same login. */
  storageState?: string;
}

export interface ScanResult extends DocsDigest {
  found: boolean;
  /** How the entry point was arrived at, so the agent can weigh it. */
  discovered: "given" | "llms.txt" | "conventional path" | "link on the page" | "none";
  entry: string | null;
  pages: string[];
  /** Said out loud rather than hidden: pages skipped, and why. */
  skipped: { url: string; reason: string }[];
}

export interface Fetcher {
  /** Plain HTTP. Returns null for anything that is not a readable page. */
  get(url: string): Promise<FetchedPage | null>;
  /** Render in a real browser. Absent when no browser is available. */
  render?(url: string): Promise<FetchedPage | null>;
}

/** Node's fetch, bounded by BUDGET and refusing anything that is not text. */
export function httpFetcher(): Fetcher {
  return {
    async get(url: string): Promise<FetchedPage | null> {
      const stop = AbortSignal.timeout(BUDGET.timeoutMs);
      let res: Response;
      try {
        res = await fetch(url, {
          signal: stop,
          redirect: "follow",
          headers: { accept: "text/html,text/plain;q=0.9,*/*;q=0.1", "user-agent": USER_AGENT },
        });
      } catch {
        return null;
      }
      if (!res.ok) return null;
      const contentType = res.headers.get("content-type") ?? "";
      if (!/text\/(html|plain|markdown)|application\/(xhtml|xml)/i.test(contentType)) return null;
      const body = (await res.text()).slice(0, BUDGET.bytesPerPage);
      return { url: res.url || url, contentType, body };
    },
  };
}

/**
 * Honest about what it is. A site operator reading their logs should be able
 * to tell what visited them and go look it up, which a spoofed browser string
 * would prevent.
 */
export const USER_AGENT = "evo.videostroll docs-scan (+https://github.com/evomedia-net/evo.videostroll)";

/**
 * The same fetcher, with a real browser behind it for pages that arrive empty.
 *
 * The browser is launched once, on the first page that actually needs it, and
 * the caller closes it. Most scans never open it at all, which is the point:
 * a documentation site is usually static, and paying for a browser launch to
 * read static HTML would make this too slow to reach for.
 *
 * `storageState` is accepted so documentation behind the same login as the app
 * can be read - the same file the recorder uses, and never a credential.
 */
export function browserFetcher(storageState?: string): Fetcher & { close(): Promise<void> } {
  const plain = httpFetcher();
  let browser: import("playwright").Browser | null = null;

  return {
    get: plain.get,
    async render(url: string): Promise<FetchedPage | null> {
      const { chromium } = await import("playwright");
      browser ??= await chromium.launch({ headless: true });
      const context = await browser.newContext({ storageState, userAgent: USER_AGENT });
      try {
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: BUDGET.timeoutMs });
        // Client-rendered docs paint after the first network settle; a short
        // wait is the difference between a shell and the page. Bounded, and a
        // timeout here is not a failure - whatever has rendered is returned.
        await page.waitForLoadState("networkidle", { timeout: BUDGET.timeoutMs }).catch(() => undefined);
        const body = (await page.content()).slice(0, BUDGET.bytesPerPage);
        return { url: page.url(), contentType: "text/html", body };
      } catch {
        return null;
      } finally {
        await context.close().catch(() => undefined);
      }
    },
    async close() {
      await browser?.close().catch(() => undefined);
      browser = null;
    },
  };
}

/** robots.txt for an origin. Unreachable or unparseable means no restrictions. */
async function robotsFor(origin: string, fetcher: Fetcher): Promise<string[]> {
  try {
    const page = await fetcher.get(new URL("/robots.txt", origin).toString());
    return page ? robotsDisallows(page.body) : [];
  } catch {
    return [];
  }
}

/**
 * Fetch one page, falling back to the browser when what came back is a shell.
 * Returns null when the page is unreadable either way.
 */
async function read(url: string, fetcher: Fetcher): Promise<FetchedPage | null> {
  const plain = await fetcher.get(url);
  if (plain && !needsBrowser(plain.body)) return plain;
  if (!fetcher.render) return plain;
  try {
    return (await fetcher.render(url)) ?? plain;
  } catch {
    return plain;
  }
}

/**
 * Find the documentation for a site and come back with its vocabulary.
 *
 * Never throws for the ordinary outcome. A site with no documentation is the
 * common case, not an error, and `found: false` says so without the agent
 * having to catch anything.
 */
export async function scanDocs(opts: ScanOptions, fetcher: Fetcher): Promise<ScanResult> {
  const skipped: { url: string; reason: string }[] = [];
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? BUDGET.pages, BUDGET.pages));
  const empty = (discovered: ScanResult["discovered"]): ScanResult => ({
    found: false,
    discovered,
    entry: null,
    pages: [],
    glossary: [],
    tasks: [],
    pronunciation: [],
    dropped: { secrets: 0, instructions: 0 },
    skipped,
  });

  let origin: string;
  try {
    origin = new URL(opts.docsUrl ?? opts.url).origin;
  } catch {
    return empty("none");
  }

  const disallowed = await robotsFor(origin, fetcher);
  const permitted = (u: string) => {
    if (robotsAllows(u, disallowed)) return true;
    skipped.push({ url: u, reason: "robots.txt disallows it" });
    return false;
  };

  // ── entry point ───────────────────────────────────────────────────────────
  let entry: FetchedPage | null = null;
  let discovered: ScanResult["discovered"] = "none";

  if (opts.docsUrl) {
    if (!permitted(opts.docsUrl)) return empty("given");
    entry = await read(opts.docsUrl, fetcher);
    discovered = "given";
  } else {
    for (const candidate of candidates(opts.url)) {
      if (!permitted(candidate)) continue;
      const page = await read(candidate, fetcher);
      if (page && page.body.trim()) {
        entry = page;
        discovered = /llms\.txt$/i.test(candidate) ? "llms.txt" : "conventional path";
        break;
      }
    }
    // Nothing at a conventional path: ask the site itself where its docs are.
    if (!entry) {
      const home = await read(opts.url, fetcher);
      const target = home
        ? links(home.body, home.url).find((l) => isDocsLink(l.href, l.text) && sameSite(l.href, opts.url))
        : undefined;
      if (target && permitted(target.href)) {
        entry = await read(target.href, fetcher);
        discovered = "link on the page";
      }
    }
  }

  if (!entry) return empty(discovered === "none" ? "none" : discovered);

  // ── the pages under it ────────────────────────────────────────────────────
  const pages: FetchedPage[] = [entry];
  const seen = new Set([entry.url]);

  if (/html/i.test(entry.contentType)) {
    for (const link of links(entry.body, entry.url)) {
      if (pages.length >= maxPages) break;
      const href = link.href.split("#")[0];
      if (seen.has(href) || !sameSite(href, entry.url)) continue;
      // Stay under the entry point's own path. A docs index usually links to
      // the marketing site, the blog and a pricing page as well, and none of
      // those teach the agent what anything is called.
      if (!underSamePath(href, entry.url) && !isDocsLink(href, link.text)) continue;
      seen.add(href);
      if (!permitted(href)) continue;
      const page = await read(href, fetcher);
      if (page) pages.push(page);
      else skipped.push({ url: href, reason: "not readable as text" });
    }
  }

  const digest = harvest(pages);
  return {
    ...digest,
    found: digest.glossary.length > 0 || digest.tasks.length > 0,
    discovered,
    entry: entry.url,
    pages: pages.map((p) => p.url),
    skipped,
  };
}

/** Is `href` inside the directory the entry point lives in? */
function underSamePath(href: string, entry: string): boolean {
  try {
    const base = new URL(entry);
    const dir = base.pathname.replace(/[^/]*$/, "");
    return new URL(href).pathname.startsWith(dir);
  } catch {
    return false;
  }
}
