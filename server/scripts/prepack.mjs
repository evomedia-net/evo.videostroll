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
 *
 * Progress goes to stderr: `npm pack --json` puts a machine-readable list on
 * stdout, and anything printed there makes it unparseable.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
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
  console.error(`prepack: ${name} -> package root`);
}

// The skill travels with the server. They are two halves of one thing - the
// server records, the skill is the method - and a tarball with only the server
// half installs a recorder that does not know how to make a good walkthrough.
// `npx evo.videostroll --install-skill` puts this where Claude Code looks.
mkdirSync(join(SERVER, "skill"), { recursive: true });
for (const name of ["SKILL.md", "SKILL.txt"]) {
  const from = join(REPO, "skill", name);
  if (!existsSync(from)) {
    console.error(`prepack: skill/${name} is missing - the package would ship a recorder with no method.`);
    process.exit(1);
  }
  copyFileSync(from, join(SERVER, "skill", name));
  console.error(`prepack: skill/${name} -> package root`);
}
