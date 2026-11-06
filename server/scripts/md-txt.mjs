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

/** HTML element names, so a tag can be told from prose that merely looks like
 * one. An allowlist and not `</?\w+>`, because these docs are full of
 * placeholders written the same way - `docs.<site>`, `auth/<host>.storage-state.json`,
 * `npm run login -- <url>` - and deleting those would take words out of the
 * twin, which is the one thing it must never do. */
const HTML = new RegExp(
  "</?(?:picture|source|img|div|span|br|p|a|table|thead|tbody|tfoot|tr|td|th" +
    "|details|summary|sup|sub|kbd|em|strong|code|pre|hr|h[1-6]|ul|ol|li" +
    "|blockquote|center|figure|figcaption|video|audio|iframe|small|b|i|u|s)" +
    "(?:\\s[^<>]*)?/?>",
  "g",
);

/**
 * Strip the inline markup, keeping the words and the link targets.
 *
 * Inline code is lifted out FIRST and put back last. What is inside backticks
 * is content, not markup, and running the emphasis rules over it corrupts it:
 * a glob documented as `Civil Parties*JWEB*.txt` loses its asterisks to the
 * italic rule and becomes "Civil PartiesJWEB.txt", two words glued into one.
 * This repo documents `role=button[name="Save"]` and `steps[i].title` the same
 * way. Same reasoning for the HTML rules - `<ol>`, written here as an example
 * of what the docs scanner looks for, is a word and not a tag.
 */
function inline(text) {
  const code = [];
  let out = text.replace(/`([^`]+)`/g, (_, body) => `\u0000${code.push(body) - 1}\u0000`);
  const restore = (s) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => code[Number(i)]);

  // An <img> carries its words in alt=, exactly as a markdown image does.
  out = out.replace(/<img\b[^<>]*?\balt=["']([^"']*)["'][^<>]*>/g, "$1");
  out = out.replace(HTML, "");
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1"); // images -> alt text
  // Links -> text (url), except when the text already is the url: the README
  // links `build-version.json` to itself, and SECURITY.md links dev@evomedia.net
  // to mailto:dev@evomedia.net. Either read as "x (x)", which tells the reader
  // nothing twice. Compared after putting the code back, because such a link is
  // usually written with backticks around its text.
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, shown, url) => {
    const bare = restore(shown);
    const target = restore(url);
    return bare === target || target === `mailto:${bare}` ? shown : `${shown} (${url})`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1"); // bold
  out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1"); // italic
  // Strikethrough, same class as the two above. Left in place, its markers read
  // as punctuation AND collide with the `~` a third-level heading is underlined
  // with. Safe unconditionally: no document in this repo - or anywhere in the
  // fleet - uses `~~~` as a code fence, which is the one thing this would
  // disturb, and a tilde inside backticks is already lifted out of reach.
  out = out.replace(/~~([^~]+)~~/g, "$1"); // strikethrough
  return restore(out);
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
    const rendered = inline(line);
    // A line that was only a tag - <picture>, </picture>, a bare <source> -
    // leaves nothing behind once the HTML rules have run. Emitting the blank
    // would turn one HTML block into a run of empty lines mid-paragraph.
    if (line.trim() && !rendered.trim()) continue;
    out.push(rendered);
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
