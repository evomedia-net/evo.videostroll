#!/usr/bin/env node
/**
 * Put the README and the licence inside the package, before npm packs it.
 *
 * The package root is `server/`, and `files` cannot reach above it - so a
 * README and a LICENSE at the repository root are simply absent from the
 * tarball. The published page on npmjs.com is then blank, and the package
 * carries no licence text at all while claiming MIT in its metadata.
 *
 * npm runs `prepack` before both `npm pack` and `npm publish`, so copying here
 * means the two files cannot be forgotten. The copies are gitignored: the
 * originals at the repository root stay canonical, and these are regenerated
 * every time, so they cannot drift.
 */
import { copyFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REPO = resolve(SERVER, "..");

for (const name of ["README.md", "LICENSE"]) {
  const from = join(REPO, name);
  if (!existsSync(from)) {
    console.error(`prepack: ${name} is missing from the repository root - the published package would have none.`);
    process.exit(1);
  }
  copyFileSync(from, join(SERVER, name));
  console.log(`prepack: ${name} -> package root`);
}
