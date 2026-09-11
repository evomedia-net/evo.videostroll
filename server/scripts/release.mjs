#!/usr/bin/env node
/**
 * Package this release as a downloadable, verifiable zip.
 *
 *   npm run release             build releases/evo.videostroll-<version>.zip
 *   npm run release -- --force  overwrite the zip for this version
 *   npm run release -- --verify re-check the zip already on disk
 *
 * An open-source project has to be obtainable without cloning, and checkable
 * once obtained. Two layers, on purpose:
 *
 *   releases/<name>-<version>.zip.sha256   verifies the download arrived intact
 *   CHECKSUMS.txt inside the zip           verifies the files after extracting
 *
 * Both are integrity checks, not signatures: the manifest travels in the same
 * archive as the files, so whoever can change one can change the other. They
 * catch a truncated download, a corrupted mirror and an accidental edit - not
 * a determined forger.
 *
 * WHAT GOES IN: everything git tracks, minus the things a release should not
 * carry. Using `git ls-files` rather than a hand-kept list means the zip is
 * exactly the reviewed source, and a new file cannot be forgotten.
 *
 * LEFT OUT: releases/ (never package the packages), auth/ (live sessions),
 * node_modules and dist (rebuilt by the recipient), and the recordings the
 * tests and examples produce.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, manifest } from "../dist/zip.js";

const SERVER = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REPO = resolve(SERVER, "..");
const argv = process.argv.slice(2);
const force = argv.includes("--force");
const verifyOnly = argv.includes("--verify");

const EXCLUDE = [/^releases\//, /^auth\//, /^\.github\//, /(^|\/)\.gitkeep$/];

const version = JSON.parse(readFileSync(join(REPO, "build-version.json"), "utf8")).version;
if (!version) {
  console.error("build-version.json has no version.");
  process.exit(1);
}

const name = `evo.videostroll-${version}.zip`;
const zipPath = join(REPO, "releases", name);
const shaPath = `${zipPath}.sha256`;
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// ── --verify ────────────────────────────────────────────────────────────────
if (verifyOnly) {
  if (!existsSync(zipPath) || !existsSync(shaPath)) {
    console.error(`\nNo release on disk for ${version}. Build it:  npm run release\n`);
    process.exit(1);
  }
  const expected = readFileSync(shaPath, "utf8").trim().split(/\s+/)[0];
  const actual = sha256(readFileSync(zipPath));
  if (expected === actual) {
    console.log(`\n  OK - releases/${name} matches its .sha256\n`);
    process.exit(0);
  }
  console.error(`\n  FAILED - releases/${name} does not match its .sha256`);
  console.error(`    expected ${expected}\n    actual   ${actual}\n`);
  process.exit(1);
}

if (existsSync(zipPath) && !force) {
  console.error(`\nreleases/${name} already exists. Use --force to rebuild it, or --verify to check it.\n`);
  process.exit(1);
}

// ── collect ─────────────────────────────────────────────────────────────────
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((p) => !EXCLUDE.some((re) => re.test(p)))
  .sort();

if (tracked.length === 0) {
  console.error("git ls-files returned nothing - is this a checkout?");
  process.exit(1);
}

const files = tracked.map((rel) => {
  const data = readFileSync(join(REPO, rel));
  return { name: rel, data, sha256: sha256(data), mtime: statSync(join(REPO, rel)).mtime };
});

// The manifest describes the files, then travels with them.
const checksums = Buffer.from(manifest(files), "utf8");
const entries = [...files.map(({ name, data, mtime }) => ({ name, data, mtime })),
                 { name: "CHECKSUMS.txt", data: checksums }];

const zip = build(entries);
mkdirSync(join(REPO, "releases"), { recursive: true });
writeFileSync(zipPath, zip);
// sha256sum format, LF, so `sha256sum -c` works on Linux and macOS.
writeFileSync(shaPath, `${sha256(zip)}  ${name}\n`, "utf8");

console.log(`\n  releases/${name}`);
console.log(`    ${entries.length} files, ${(zip.length / 1024).toFixed(0)} kB`);
console.log(`    CHECKSUMS.txt inside covers ${files.length} of them`);
console.log(`  releases/${name}.sha256`);
console.log(`    ${sha256(zip)}`);
console.log(`
Verify a download:      sha256sum -c ${name}.sha256
Verify after unzipping: sha256sum -c CHECKSUMS.txt
`);
