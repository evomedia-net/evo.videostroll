#!/usr/bin/env node
/**
 * Sign in yourself, once, and keep the session for the recorder.
 *
 *   npm run login -- https://app.example.com
 *   npm run login -- https://app.example.com --out auth/staging.storage-state.json
 *   npm run login -- https://app.example.com --browser msedge
 *   npm run login -- --check auth/app.example.com.storage-state.json
 *
 * A real browser window opens. You sign in - password manager, second factor,
 * SSO, whatever the site asks. Nothing types on your behalf and nothing reads
 * what you typed. Press Enter here (or close the window) and the cookies and
 * localStorage are written to a file.
 *
 * Point a storyboard at that file with `storageState`, or pass it to
 * videostroll_start. The agent gets a path; it never gets a credential.
 *
 * The file is a live session. It is written only where git ignores it, it is
 * never printed, and it should be deleted when you are finished with it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { checkPath, defaultOutPath, describe, isEmpty, summarise } from "../dist/auth.js";

const REPO = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const argv = process.argv.slice(2);

// ── a transcript of every run ────────────────────────────────────────────────
//
// The interesting failures happen on somebody else's terminal, where "it did
// not work" is all that comes back. Written beside the output, so it is
// gitignored with it.
const LOG = resolve(REPO, "auth", "login-last-run.log");
const transcript = [];
for (const stream of ["log", "error"]) {
  const original = console[stream].bind(console);
  console[stream] = (...args) => {
    transcript.push(args.map(String).join(" "));
    original(...args);
  };
}
process.on("exit", (code) => {
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    const lines = ["# " + new Date().toISOString() + "  exit " + code,
                   "# argv: " + argv.join(" "), ""].concat(transcript, [""]);
    writeFileSync(LOG, lines.join("\n"), "utf8");
  } catch (e) {
    // A convenience, never a reason to fail - but it says why, because an
    // empty catch here hid a missing import and the log simply never appeared.
    process.stderr.write("  (could not write the run log: " + ((e && e.message) || e) + ")\n");
  }
});

// Anything thrown from the top level would otherwise print a stack trace and a
// bare `log: []` at somebody who only wanted to sign in.
process.on("uncaughtException", (e) => {
  console.error("\nSomething went wrong before the session could be saved:\n");
  console.error("  " + String((e && e.stack) || e).split("\n").slice(0, 4).join("\n  ") + "\n");
  process.exit(1);
});

function usage(message) {
  if (message) console.error(`\n${message}`);
  console.error(`
Usage:
  npm run login -- <url> [--out <file>]     sign in and save the session
  npm run login -- <url> --browser <name>   chrome | msedge | chromium
  npm run login -- --check <file>           report what a saved session holds

The output defaults to auth/<host>.storage-state.json, which this repo ignores.
Paths are relative to the repository root, not to wherever you ran npm.

The window opens in the Chrome or Edge already installed, falling back to
Playwright's bundled Chromium. Note that Playwright always uses a FRESH
profile, so your saved passwords and extensions are not there - you will be
typing the credentials yourself either way.
`);
  process.exit(message ? 1 : 0);
}

if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) usage();

// ── --check: report on a file we already have ───────────────────────────────
const checkAt = argv.indexOf("--check");
if (checkAt !== -1) {
  const file = argv[checkAt + 1];
  if (!file) usage("--check needs a file path.");
  let state;
  try {
    state = JSON.parse(await readFile(resolve(REPO, file), "utf8"));
  } catch (e) {
    console.error(`Cannot read ${file}: ${e.message}`);
    process.exit(1);
  }
  const summary = summarise(state);
  console.log(`\n${file}`);
  console.log(`  ${describe(summary)}`);
  if (summary.domains.length) console.log(`  domains: ${summary.domains.join(", ")}`);
  if (summary.expired > 0) {
    console.error(`\n${summary.expired} cookie(s) have expired. Sign in again:  npm run login -- <url>`);
    process.exit(2);
  }
  process.exit(0);
}

// ── where it is going ───────────────────────────────────────────────────────
const url = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--out"
  && argv[argv.indexOf(a) - 1] !== "--browser");
if (!url) usage("Give the URL of the page to sign in on.");
try {
  new URL(url);
} catch {
  usage(`Not a URL: ${url}`);
}

const outAt = argv.indexOf("--out");
const requested = outAt !== -1 ? argv[outAt + 1] : defaultOutPath(url);
if (!requested) usage("--out needs a file path.");

const verdict = checkPath(requested, REPO);
if (!verdict.ok) {
  console.error(`\nRefusing to write there.\n\n  ${verdict.reason}\n`);
  process.exit(1);
}
const out = verdict.path;

// ── the window ──────────────────────────────────────────────────────────────
//
// Chrome or Edge first, bundled Chromium last. Not for the profile - Playwright
// always uses a fresh one - but because the bundled build is the one that rots:
// recording runs headless, which uses a SEPARATE chromium-headless-shell, so a
// machine can record for weeks with a broken full Chromium and nobody finds out
// until they try to sign in. That is exactly what happened here; the bundled
// chrome.exe was present, complete and readable, and still would not launch,
// while the installed Chrome did.
const CHANNELS = ["chrome", "msedge"];
const wantedAt = argv.indexOf("--browser");
const wanted = wantedAt === -1 ? null : argv[wantedAt + 1];

async function openBrowser() {
  if (wanted === "chromium") return { browser: await chromium.launch({ headless: false }), via: "bundled Chromium" };
  if (wanted) return { browser: await chromium.launch({ headless: false, channel: wanted }), via: wanted };
  const errors = [];
  for (const channel of CHANNELS) {
    try {
      return { browser: await chromium.launch({ headless: false, channel }), via: channel };
    } catch (e) {
      errors.push(`${channel}: ${String((e && e.message) || e).split("\n")[0]}`);
    }
  }
  try {
    return { browser: await chromium.launch({ headless: false }), via: "bundled Chromium" };
  } catch (e) {
    errors.push(`chromium: ${String((e && e.message) || e).split("\n")[0]}`);
    throw new Error(errors.join("\n  "));
  }
}

console.log(`\nOpening a browser at ${url}`);
console.log("Sign in in that window. Nothing is typed for you and nothing reads what you type.");

let browser;
let via;
try {
  ({ browser, via } = await openBrowser());
} catch (e) {
  const msg = String((e && e.message) || e);
  console.error(["", "Could not open a browser window. Tried:", "", "  " + msg, ""].join("\n"));
  if (/Executable doesn't exist|playwright install|channel/i.test(msg)) {
    console.error([
      "Install one, or repair Playwright's own:",
      "",
      "  cd server && npx playwright install --force chromium",
      "",
      "Or name one explicitly:",
      "",
      "  npm run login -- <url> --browser chrome     (or msedge, or chromium)",
      "",
    ].join("\n"));
  } else {
    console.error([
      "If this shell has no desktop session - SSH, a CI runner, an agent's",
      "shell - it cannot open a window. Run it from a terminal on the machine",
      "you are sitting at. That is deliberate: nothing signs in for you.",
      "",
    ].join("\n"));
  }
  process.exit(1);
}
console.log(`  (using ${via})`);

const context = await browser.newContext();
const page = await context.newPage();
await page.goto(url, { waitUntil: "load" }).catch((e) => {
  console.error(`\nCould not open ${url}: ${e.message}`);
});

// ── waiting for you ─────────────────────────────────────────────────────────
//
// Enter in this terminal is the signal, and reads the session live. Closing the
// window is the only signal available when stdin is not a terminal, and
// storageState() cannot be read once the browser is gone - so a snapshot is
// taken every second while it is alive and the newest non-empty one is kept.
//
// A snapshot is a fallback, not a preference: it can be up to a second old, and
// an early one captured the state from BEFORE a sign-in completed, which then
// looked exactly like a saved session and was not one. Press Enter if you can.
let snapshot = null;
const poll = setInterval(async () => {
  try {
    const s = await context.storageState();
    if (!isEmpty(s)) snapshot = s;
  } catch {
    /* the browser is closing; the last snapshot stands */
  }
}, 1000);

const closed = new Promise((r) => browser.on("disconnected", () => r("closed")));
let rl;
const pressed = process.stdin.isTTY
  ? new Promise((r) => {
      rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question("\nWhen you are signed in, press Enter here to save the session... ", () => r("pressed"));
    })
  : new Promise(() => {});

if (!process.stdin.isTTY) {
  console.log("\n(stdin is not a terminal, so close the browser window when you are signed in.)");
}

const how = await Promise.race([pressed, closed]);
rl?.close();
clearInterval(poll);

let state = snapshot;
let landedOn = url;
if (how === "pressed") {
  try {
    state = await context.storageState();
    landedOn = page.url() || url;
  } catch {
    /* fall back to the snapshot */
  }
}
try {
  await browser.close();
} catch {
  /* already gone */
}

if (!state || isEmpty(state)) {
  console.error("\nNothing was captured - no cookies and no localStorage - so the sign-in did not complete. Nothing was written.");
  console.error(how === "closed"
    ? "The browser closed before any session appeared. Run it again, and press Enter in this terminal once you are inside the app.\n"
    : "Run it again and finish signing in before pressing Enter.\n");
  process.exit(1);
}

await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(state, null, 2), "utf8");
if (how === "closed") console.log("\n  (saved from the state held when you closed the window)");

// ── prove it works before calling it saved ──────────────────────────────────
//
// A file with a session cookie in it looks identical whether the server will
// accept that cookie or not, and "saved" was once reported for a session that
// bounced straight back to the login page. So the state is replayed in a fresh
// headless context against the page the sign-in ended on: if that shows a
// password field, the file says nothing useful.
async function verify(file, target) {
  const probe = await chromium.launch({ headless: true });
  try {
    const ctx = await probe.newContext({ storageState: file });
    const p = await ctx.newPage();
    await p.goto(target, { waitUntil: "load", timeout: 45000 });
    await p.waitForTimeout(3000);
    const bounced = await p.evaluate(() => !!document.querySelector('input[type="password"]'));
    return { ok: !bounced, landed: p.url() };
  } catch (e) {
    return { ok: null, error: String((e && e.message) || e).split("\n")[0] };
  } finally {
    await probe.close().catch(() => {});
  }
}

const summary = summarise(state);
const bytes = (await stat(out)).size;
console.log(`\nSaved ${out}  (${bytes} bytes)`);
console.log(`  ${describe(summary)}`);
console.log(`  domains: ${summary.domains.join(", ")}`);

const check = await verify(out, landedOn);
if (check.ok === true) {
  console.log(`\n  VERIFIED - replaying it reaches ${check.landed}`);
} else if (check.ok === false) {
  console.error(`\n  NOT USABLE - replaying it lands on a login page (${check.landed}).

  The sign-in did not finish, or this app ties the session to more than a
  cookie. Run it again, get fully inside the app - past any workspace or
  second-factor step - and press Enter in this terminal rather than closing
  the window.`);
} else {
  console.log(`\n  could not verify (${check.error}) - the file is saved either way`);
}

console.log(`
This file is a live session - treat it like a password. It is ignored by git.
Use it in a storyboard:

  "storageState": ${JSON.stringify(out.replace(/\\/g, "/"))}

or pass storageState to videostroll_start. Check it later with:

  npm run login -- --check ${requested}
`);
