#!/usr/bin/env node
/**
 * Sign in yourself, once, and keep the session for the recorder.
 *
 *   npm run login -- https://app.example.com
 *   npm run login -- https://app.example.com --out auth/staging.storage-state.json
 *   npm run login -- --check auth/app.example.com.storage-state.json
 *
 * A real browser window opens. You sign in - with a password manager, a second
 * factor, an SSO redirect, whatever the site asks. Nothing types on your
 * behalf and nothing reads what you typed. When you are done you press Enter
 * here and Playwright writes the cookies and localStorage to a file.
 *
 * Point a storyboard at that file with `storageState`, or pass it to
 * videostroll_start. The agent gets a path; it never gets a credential.
 *
 * The file is a live session. It is written only where git ignores it, it is
 * never printed, and it should be deleted when you are finished with it.
 */
import { createInterface } from "node:readline";
import { readFile, rm, stat } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { checkPath, defaultOutPath, describe, isEmpty, summarise } from "../dist/auth.js";

const REPO = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const argv = process.argv.slice(2);

function usage(message) {
  if (message) console.error(`\n${message}`);
  console.error(`
Usage:
  npm run login -- <url> [--out <file>]     sign in and save the session
  npm run login -- --check <file>           report what a saved session holds

The output defaults to auth/<host>.storage-state.json, which this repo ignores.
Paths are relative to the repository root, not to wherever you ran npm.
The window opens in the Chrome or Edge you already have (your password
manager and passkeys are there). --browser chrome|msedge|chromium overrides.
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

// ── capture ─────────────────────────────────────────────────────────────────
const url = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--out");
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

console.log(`\nOpening a browser at ${url}`);
console.log(`Sign in in that window. Nothing is typed for you and nothing reads what you type.`);

// A headed browser is the whole point of this script, and it is the one
// Playwright install people skip: recording runs headless, which uses a
// SEPARATE chromium-headless-shell build, so a machine can record for weeks
// and still have no real browser. Playwright's own message is good; wrapping
// it stops an uncaught exception dumping a stack trace and an empty `log: []`
// at somebody who just wanted to sign in.
// Which browser opens the window.
//
// Default: the Chrome or Edge already on the machine. For a human sign-in that
// is the better browser anyway - it has your password manager, your passkeys
// and your existing sessions, and the whole point of this script is that YOU
// do the signing in. Playwright's bundled Chromium has none of that.
//
// It is also more robust. Recording runs headless, which uses a separate
// chromium-headless-shell build, so a machine can record for weeks with no
// working full Chromium and nobody notices until they try to sign in - which
// is exactly what happened here: the bundled chrome.exe was present, complete
// and readable from two other shells, and Playwright still would not launch it.
// Falling back to a browser the OS installed sidesteps that entirely.
const CHANNELS = ["chrome", "msedge"];
const wanted = (() => {
  const at = argv.indexOf("--browser");
  return at === -1 ? null : argv[at + 1];
})();

async function open() {
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
    const err = new Error(errors.join("\n  "));
    err.tried = true;
    throw err;
  }
}

let browser;
let via;
try {
  ({ browser, via } = await open());
} catch (e) {
  const msg = String((e && e.message) || e);
  console.error(["", "Could not open a browser window. Tried:", "", "  " + msg, ""].join("\n"));
  if (/Executable doesn't exist|playwright install|channel/i.test(msg)) {
    console.error([
      "Install one of them, or repair Playwright's own:",
      "",
      "  cd server && npx playwright install --force chromium",
      "",
      "Or name a browser explicitly:",
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

// Enter in this terminal is the signal. If stdin is not a terminal - a pipe, a
// CI runner - there is nobody to press it, so closing the window is the signal
// instead. Whichever happens first wins; the other is cleaned up.
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

if (how === "closed") {
  console.error("\nThe browser was closed before the session could be saved. Nothing was written.");
  process.exit(1);
}

await mkdir(dirname(out), { recursive: true });
const state = await context.storageState({ path: out });
await browser.close();

if (isEmpty(state)) {
  await rm(out, { force: true });
  console.error(`
Nothing was captured - no cookies and no localStorage - so the sign-in did not
complete. Nothing was written. Run it again and finish signing in before
pressing Enter.`);
  process.exit(1);
}

const summary = summarise(state);
const bytes = (await stat(out)).size;
console.log(`\nSaved ${out}  (${bytes} bytes)`);
console.log(`  ${describe(summary)}`);
console.log(`  domains: ${summary.domains.join(", ")}`);
console.log(`
This file is a live session - treat it like a password. It is ignored by git.
Use it in a storyboard:

  "storageState": ${JSON.stringify(out.replace(/\\/g, "/"))}

or pass storageState to videostroll_start. Check it later with:

  npm run login -- --check ${requested}
`);
