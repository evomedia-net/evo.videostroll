#!/usr/bin/env node
/**
 * Render every prose .md in the repository to its .txt twin.
 *
 * The twins exist because markdown renders in only some of the places these
 * docs get read. GitHub renders it when browsing a file, but shows raw markup
 * in diffs and review; editors, pagers and `type`/`cat` show raw markup
 * always. Plain text opens in anything with no configuration, and is the
 * form LLM ingestion prefers - the same reason llms.txt exists.
 *
 * They are generated, never edited by hand:
 *
 *     node scripts/md-txt.mjs          # rewrite every twin
 *     node scripts/md-txt.mjs --check  # exit 1 if any is out of sync
 *
 * test/md-twin.test.ts runs --check, so an edit that forgets to regenerate
 * fails the suite instead of shipping a mirror that quietly disagrees with
 * its source. That is the whole point of generating them: a hand-kept
 * duplicate drifts, and the drift is invisible precisely because nobody
 * reads both copies. Before this script the four twins were hand-written and
 * already inconsistent with each other - some em dashes had become hyphens,
 * some list text had been re-wrapped, and nothing anywhere would have said so.
 *
 * Sources are discovered, not listed: a hand-kept list is one more thing to
 * forget, and the twin that gets forgotten is the one nobody notices is
 * stale.
 *
 * `server/` is skipped. prepack copies README.md and skill/SKILL.* in there
 * at pack time; those copies are gitignored and regenerated on every pack, so
 * twinning them would only produce files the next prepack overwrites.
 *
 * Line endings: the working tree is CRLF on Windows (core.autocrlf), the
 * repository is LF. Twins are written LF and every comparison normalises
 * first, so --check cannot fail merely because of the platform it ran on.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Directories that hold no prose worth twinning - build output, tooling, and prepack's copies. */
const SKIP = new Set(["node_modules", "dist", ".git", ".claude", "server", "releases", "coverage"]);

/** Setext-style underlines by heading depth; `=`, `-` and `~` are what the repo's twins already used. */
const UNDERLINE = ["=", "-", "~", ".", ".", "."];

/** Strip the inline markup, keeping the words and the link targets. */
function inline(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images -> alt text
    // Links -> text (url), except when the text already is the url: README
    // links `build-version.json` to itself, and "build-version.json
    // (build-version.json)" tells the reader nothing twice. The comparison
    // ignores inline-code markers, because that link is written with them
    // ([`build-version.json`](build-version.json)) and they come off below.
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => (text.replace(/`/g, "") === url ? text : `${text} (${url})`))
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1") // italic
    .replace(/`([^`]+)`/g, "$1"); // inline code
}

/** Render one markdown document to its plain-text form. */
export function render(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;

  // YAML frontmatter is machine-parsed, not prose. It goes through byte for
  // byte: stripping a backtick or an asterisk out of a `description:` would
  // change the value a client actually reads, which is the one thing a
  // plain-text mirror must never do.
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end !== -1) {
      out.push(...lines.slice(0, end + 1));
      i = end + 1;
    }
  }

  let inFence = false;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      // Drop the fence markers; the code itself stays, indented so it still
      // reads as a block without them.
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(line ? `    ${line}` : "");
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const text = inline(heading[2]);
      out.push(text, UNDERLINE[heading[1].length - 1].repeat(text.length));
      continue;
    }
    out.push(inline(line));
  }

  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/** Every .md that owes a .txt, discovered, in a stable order. */
export function sources(dir = REPO, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) sources(full, found);
    } else if (entry.name.endsWith(".md")) {
      found.push(full);
    }
  }
  return found;
}

/** The twin a source owes, and its repo-relative name for reporting. */
export function twinOf(source) {
  const path = source.replace(/\.md$/, ".txt");
  return { path, name: relative(REPO, path).split(sep).join("/") };
}

/** The twins whose content no longer matches their source. */
export function stale() {
  const out = [];
  for (const source of sources()) {
    const { path, name } = twinOf(source);
    const current = existsSync(path) ? readFileSync(path, "utf8").replace(/\r\n/g, "\n") : "";
    if (current !== render(readFileSync(source, "utf8"))) out.push(name);
  }
  return out;
}

function main() {
  if (process.argv.includes("--check")) {
    const out = stale();
    if (out.length > 0) {
      console.error(`out of sync: ${out.join(", ")} - run: npm run docs:twins`);
      return 1;
    }
    console.log(`${sources().length} twin(s) in sync`);
    return 0;
  }
  for (const source of sources()) {
    const { path, name } = twinOf(source);
    const rendered = render(readFileSync(source, "utf8"));
    writeFileSync(path, rendered, "utf8");
    console.log(`Wrote ${name} (${rendered.split("\n").length - 1} lines)`);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
