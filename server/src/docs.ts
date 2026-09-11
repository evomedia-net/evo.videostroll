// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Reading a product's own documentation, so the narration sounds like someone
 * who works there.
 *
 * The accessibility snapshot tells the agent what is on the page. It does not
 * tell it what the product CALLS things, and that is most of what makes a
 * walkthrough sound informed or sound like a stranger reading labels aloud.
 * A site that says "workspace" everywhere and gets narrated as "account" is
 * wrong in a way no selector check catches.
 *
 * So: find the docs if there are any, and come back with vocabulary - the
 * product's nouns, a line on what each one is, the task titles, and how to say
 * the awkward ones out loud. Not the documentation itself. A walkthrough is
 * not a reading of the manual, and dumping pages into the agent's context
 * would crowd out the thing it is actually looking at.
 *
 * EVERYTHING HERE TREATS FETCHED TEXT AS DATA, NEVER AS INSTRUCTIONS. It is
 * written by whoever runs the site being recorded, it ends up spoken aloud in
 * a video somebody ships, and that is a bad combination to be casual about.
 * scrub() drops the obvious attempts and COUNTS them rather than hiding them,
 * but the real protection is that the skill tells the agent this is vocabulary
 * to borrow, not direction to follow.
 */

import { SECRET_RE } from "./storyboard.js";

/** Small on purpose. A walkthrough needs vocabulary, not a corpus. */
export const BUDGET = {
  pages: 12,
  bytesPerPage: 512_000,
  terms: 60,
  tasks: 30,
  glossChars: 200,
  timeoutMs: 10_000,
} as const;

export interface FetchedPage {
  url: string;
  /** text/html, text/plain, ... - decides how it is parsed. */
  contentType: string;
  body: string;
}

export interface Term {
  term: string;
  gloss: string;
  from: string;
}

export interface Task {
  title: string;
  url: string;
  /** Numbered steps found under the heading, when the page had any. */
  steps?: number;
}

export interface Pronunciation {
  term: string;
  say: string;
}

export interface DocsDigest {
  glossary: Term[];
  tasks: Task[];
  pronunciation: Pronunciation[];
  /** Lines dropped because they looked like credentials or like instructions. */
  dropped: { secrets: number; instructions: number };
}

// ── finding the docs ────────────────────────────────────────────────────────

/**
 * Where documentation conventionally lives, best first.
 *
 * llms.txt leads because it exists for exactly this: a short, curated index a
 * machine is meant to read, rather than a rendered site to be scraped. When a
 * project publishes one it is the most accurate thing available, and it is one
 * request instead of twelve.
 */
export function candidates(base: string): string[] {
  let origin: URL;
  try {
    origin = new URL(base);
  } catch {
    return [];
  }
  const at = (path: string) => new URL(path, origin.origin).toString();
  const host = origin.hostname;
  const bare = host.replace(/^www\./, "");
  const out = [
    at("/llms.txt"),
    at("/docs/"),
    at("/documentation/"),
    at("/help/"),
    at("/guide/"),
    at("/manual/"),
    at("/support/"),
  ];
  // docs.example.com is at least as common as example.com/docs, and a site
  // that has one usually does not have the other.
  if (!host.startsWith("docs.")) {
    out.splice(1, 0, `${origin.protocol}//docs.${bare}/`);
  }
  return out;
}

/**
 * Two hosts that belong to the same product: exactly equal, or one is a
 * subdomain of the other's registrable-looking root. Deliberately conservative
 * - following a link off-site is how a docs scan turns into a crawl of the
 * open web, and nothing about narration needs that.
 */
export function sameSite(a: string, b: string): boolean {
  const host = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return "";
    }
  };
  const [x, y] = [host(a), host(b)];
  if (!x || !y) return false;
  if (x === y) return true;
  const root = (h: string) => h.split(".").slice(-2).join(".");
  return root(x) === root(y);
}

const DOCS_WORDS =
  /\b(docs?|documentation|help|guide|guides|manual|handbook|reference|getting[- ]started|user[- ]guide|knowledge[- ]base)\b/i;

/** Is this link, as a person would read it, a way into the documentation? */
export function isDocsLink(href: string, text: string): boolean {
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("javascript:")) return false;
  return DOCS_WORDS.test(text) || DOCS_WORDS.test(href);
}

/**
 * The `Disallow:` prefixes that apply to everyone, from a robots.txt.
 *
 * Honoured because this fetches somebody else's site unattended. The rules are
 * read for `User-agent: *` only - claiming to match a named agent would be
 * pretending to be a crawler the operator has an opinion about, and this is
 * not that. A malformed or missing file means no restrictions, which is what
 * every other client does with one.
 */
export function robotsDisallows(txt: string): string[] {
  const out: string[] = [];
  let applies = false;
  for (const raw of txt.split("\n")) {
    const line = raw.split("#")[0].trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      applies = value === "*";
      continue;
    }
    if (field === "disallow" && applies && value) out.push(value);
  }
  return out;
}

/** Does robots.txt permit this URL? An empty rule list permits everything. */
export function robotsAllows(url: string, disallows: string[]): boolean {
  let path: string;
  try {
    const u = new URL(url);
    path = `${u.pathname}${u.search}`;
  } catch {
    return false;
  }
  return !disallows.some((rule) => path.startsWith(rule));
}

/**
 * A page that arrived as an empty shell for a client-side framework to fill.
 *
 * Worth knowing because the fix is expensive: hand the URL to the real browser
 * and let it render. Most documentation sites are statically generated and
 * never need it, so this is the exception that decides whether to pay.
 */
export function needsBrowser(html: string): boolean {
  if (!/<\s*(script|div\s+id=["'](root|app|__next|__nuxt))/i.test(html)) return false;
  return textOf(html).length < 200;
}

// ── reading what came back ──────────────────────────────────────────────────

/**
 * Lines that are trying to talk to the agent rather than describe the product.
 *
 * A speed bump, not a wall: anyone who wants past this gets past it. It is
 * here because the cheap attempts are common and the cost of catching them is
 * one regex, and because dropping them QUIETLY would be worse than not
 * checking - scrub() returns the count so the tool can say so out loud.
 */
const INSTRUCTION_RE =
  /(ignore\s+(all\s+)?(the\s+)?(previous|prior|above|preceding)|disregard\s+(all\s+)?(previous|prior|your)|system\s*prompt|new\s+instructions?\s*:|you\s+are\s+now\s+|forget\s+(everything|all\s+previous)|<\s*\/?\s*(system|assistant|instructions?)\s*>)/i;

export interface Scrubbed {
  text: string;
  secrets: number;
  instructions: number;
}

/** Drop the lines that must not reach a narration draft, and say how many. */
export function scrub(text: string): Scrubbed {
  let secrets = 0;
  let instructions = 0;
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    if (SECRET_RE.test(line)) {
      secrets += 1;
      continue;
    }
    if (INSTRUCTION_RE.test(line)) {
      instructions += 1;
      continue;
    }
    kept.push(line);
  }
  return { text: kept.join("\n"), secrets, instructions };
}

/** Tags whose content is never prose. Dropped wholesale, contents and all. */
const DEAD = /<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;

export interface Heading {
  level: number;
  text: string;
  /** The prose between this heading and the next. */
  body: string;
  /**
   * Numbered steps in this section. The giveaway that a section is a
   * procedure regardless of what it is called - see stepCount.
   */
  steps: number;
}

const entities: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
};

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;|&#39;/gi, (e) => entities[e.toLowerCase()] ?? e);
}

/** Strip tags to readable text, keeping paragraph boundaries. */
export function textOf(html: string): string {
  return decode(
    html
      .replace(DEAD, " ")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Headings with the prose that follows them.
 *
 * Headings carry most of the signal in documentation: they are what the
 * product decided to call its own parts, chosen by someone who had to name
 * them for strangers.
 */
export function headings(html: string): Heading[] {
  const clean = html.replace(DEAD, " ");
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const found: { level: number; text: string; at: number; end: number }[] = [];
  for (let m = re.exec(clean); m; m = re.exec(clean)) {
    const text = tidy(textOf(m[2]));
    if (text) found.push({ level: Number(m[1]), text, at: m.index, end: re.lastIndex });
  }
  return found.map((h, i) => {
    const section = clean.slice(h.end, found[i + 1]?.at ?? clean.length);
    return { level: h.level, text: h.text, body: textOf(section), steps: stepCount(section) };
  });
}

/**
 * How many numbered steps a section contains.
 *
 * This is what rescues documentation whose headings are all nouns, which is
 * most documentation: "Work orders" with a numbered procedure under it IS a
 * task, and no amount of vocabulary matching on the title will ever say so.
 *
 * `<ol>` only, never `<ul>`. An unordered list is as likely to be a list of
 * features or limits as a procedure, and counting it would fill `tasks` with
 * things that are not tasks - which is worse than leaving it empty, because
 * the agent would follow them.
 */
export function stepCount(html: string): number {
  let steps = 0;
  for (const m of html.matchAll(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi)) {
    steps = Math.max(steps, (m[1].match(/<li\b/gi) ?? []).length);
  }
  return steps;
}

/** Every resolvable href in a page, with the text a person would click. */
export function links(html: string, base: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  const re = /<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  const clean = html.replace(DEAD, " ");
  for (let m = re.exec(clean); m; m = re.exec(clean)) {
    const raw = m[2] ?? m[3] ?? m[4] ?? "";
    try {
      out.push({ href: new URL(decode(raw), base).toString(), text: textOf(m[5]).replace(/\s+/g, " ").trim() });
    } catch {
      /* an href that is not a URL is not a link anyone can follow */
    }
  }
  return out;
}

// ── llms.txt ────────────────────────────────────────────────────────────────

/**
 * llms.txt is markdown with a known shape: an H1 name, an optional blockquote
 * summary, H2 sections, and link lines `- [Title](url): what it is`. Parsed
 * directly rather than run through the HTML path, because the description
 * after the colon is already the one-line gloss everything else has to guess
 * at.
 */
/**
 * Every page an llms.txt points at.
 *
 * llms.txt is an INDEX, and an index is only useful if something follows it.
 * Reading the file and stopping there yields the one-line description of each
 * page and none of their contents - which is how a site with a perfectly good
 * llms.txt returned an empty `tasks`: the procedures were all one hop away.
 */
export function llmsLinks(text: string, base: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  for (const m of text.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    try {
      out.push({ href: new URL(m[2], base).toString(), text: m[1].trim() });
    } catch {
      /* a relative link with no usable base is not worth failing over */
    }
  }
  return out;
}

export function parseLlmsTxt(text: string, from: string): { terms: Term[]; tasks: Task[] } {
  const terms: Term[] = [];
  const tasks: Task[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const link = /^[-*]\s*\[([^\]]+)\]\(([^)]+)\)\s*(?::\s*(.*))?$/.exec(line);
    if (link) {
      const [, title, href, gloss] = link;
      if (gloss) terms.push({ term: title.trim(), gloss: clip(gloss.trim()), from });
      if (isTaskTitle(title)) {
        try {
          tasks.push({ title: title.trim(), url: new URL(href, from).toString() });
        } catch {
          /* a relative link with no usable base is not worth failing over */
        }
      }
      continue;
    }
    const defn = /^[-*]\s*\*\*([^*]+)\*\*\s*[-–—:]\s*(.+)$/.exec(line);
    if (defn) terms.push({ term: defn[1].trim(), gloss: clip(defn[2].trim()), from });
  }
  return { terms, tasks };
}

// ── turning pages into vocabulary ───────────────────────────────────────────

/**
 * The verbs documentation uses when it is telling you to do something.
 *
 * Matched in both the imperative a heading usually takes ("Create a permit")
 * and the gerund a contents page usually takes ("Creating a permit"), which is
 * why the stems are listed once and the endings are the regex's problem. Word
 * boundaries keep the nouns out: `^set\b` does not match "Settings", `^manage\b`
 * does not match "Management".
 */
const TASK_VERBS = [
  "add", "approve", "archive", "assign", "close", "configure", "connect",
  "create", "customise", "customize", "delete", "disable", "download", "edit",
  "enable", "export", "generate", "import", "install", "invite", "manage",
  "migrate", "publish", "remove", "rename", "reopen", "reset", "resolve",
  "restore", "schedule", "send", "set up", "submit", "update", "upload",
];

/**
 * The two forms a heading actually uses: the imperative ("Create a permit")
 * and the gerund ("Creating a permit").
 *
 * NOT the plural. "Creates a permit" is not a heading anyone writes, while
 * "Updates" and "Downloads" are page titles everywhere - so accepting the "s"
 * form bought nothing and misread two common feature pages as tasks. A test
 * caught it.
 *
 * The gerund is why this is generated rather than written out, because English
 * spells it two awkward ways: a final "e" is dropped, so "create" gives
 * "creating"; and a short stem doubles its last consonant, so "set up" gives
 * "setting up" - which is one of the most common task headings there is.
 */
function forms(verb: string): string {
  const [head, ...rest] = verb.split(" ");
  const tail = rest.length ? `\\s+${rest.join("\\s+")}` : "";
  if (head.endsWith("e")) return `${head.slice(0, -1)}(?:e|ing)${tail}`;
  const last = head.slice(-1);
  return `${head}(?:|${last}?ing)${tail}`;
}

/**
 * Deliberately NOT exhaustive. Verbs that are just as often feature nouns in
 * documentation - log, view, run, search, build, share, track, find - are left
 * out, because a false task is worse than a missing one: the agent may build a
 * walkthrough around it. The structural signal below catches those pages
 * anyway, and catches them on better evidence.
 */
const TASK_RE = new RegExp(
  `^(how\\s+(to|do\\s+i|can\\s+i)\\b|getting\\s+started\\b|(?:${TASK_VERBS.map(forms).join("|")})\\b)`,
  "i",
);

export function isTaskTitle(title: string): boolean {
  return TASK_RE.test(title.trim());
}

/**
 * A "page not found" served with a 200.
 *
 * Static documentation sites do this constantly - a link in llms.txt goes
 * stale, the host answers with the 404 template and an OK status, and nothing
 * downstream can tell. Caught here because the first live scan put
 * "Page not found - The page you're looking for doesn't exist" at the TOP of
 * the glossary, where it was the first thing the agent would have read about
 * the product.
 */
const NOT_FOUND_RE = /^(404\b|page not found|not found$|this page (could not be|was not) found)/i;

export function looksMissing(headingTexts: string[]): boolean {
  return headingTexts.some((t) => NOT_FOUND_RE.test(t.trim()));
}

/**
 * Zero-width characters and control codes, which documentation generators
 * leave behind: VitePress puts a zero-width space in every anchor heading, so
 * "Overview" arrives as "Overview" and compares equal to nothing.
 */
function tidy(s: string): string {
  return s.replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Trim to length without cutting a character in half.
 *
 * `slice` counts UTF-16 units, so a cut that lands between the halves of an
 * emoji leaves an unpaired surrogate - which renders as the replacement
 * character and would be read aloud as one. Seen for real on the first live
 * scan: "monitor environmental compliance. <?>". Spreading the string iterates
 * by code point, so the cut lands between characters.
 */
function clip(s: string): string {
  const one = tidy(s);
  const chars = [...one];
  if (chars.length <= BUDGET.glossChars) return one;
  return `${chars.slice(0, BUDGET.glossChars - 1).join("").trimEnd()}…`;
}

/** The first sentence of a body, which is nearly always the definition. */
function firstSentence(body: string): string {
  const t = body.replace(/\s+/g, " ").trim();
  if (!t) return "";
  const stop = /(?<=[.!?])\s+(?=[A-Z(])/.exec(t);
  return clip(stop ? t.slice(0, stop.index + 1) : t);
}

/**
 * ALL-CAPS tokens anywhere in the corpus. Used to decide whether a lowercase
 * fragment like the "ehs" in "evo.ehs" is an acronym that has to be spelled
 * out loud - the docs themselves are the authority on that, and guessing from
 * the letters alone gets it wrong in both directions.
 */
export function acronyms(corpus: string): Set<string> {
  const out = new Set<string>();
  for (const m of corpus.matchAll(/\b[A-Z]{2,5}\b/g)) out.add(m[0].toLowerCase());
  return out;
}

/**
 * How to say a term out loud, or null if it already reads correctly.
 *
 * The skill's rule is "spell for the ear": the voice reads what is written, so
 * "evo.ehs" is spoken as a word unless it is written "evo dot e h s". This
 * suggests; the agent still decides. A suggestion it disagrees with costs a
 * moment, whereas the name of the product mispronounced through a whole video
 * costs the video.
 */
export function speakable(term: string, known: Set<string> = new Set()): string | null {
  const t = term.trim();
  if (!t || /\s/.test(t)) return null;

  const spell = (seg: string) => seg.split("").join(" ");
  const isAcronym = (seg: string) =>
    /^[A-Z]{2,5}$/.test(seg) || (/^[a-z]{2,5}$/.test(seg) && known.has(seg.toLowerCase()));

  if (t.includes(".")) {
    const parts = t.split(".").filter(Boolean);
    if (parts.length < 2) return null;
    return parts.map((p) => (isAcronym(p) ? spell(p.toLowerCase()) : p.toLowerCase())).join(" dot ");
  }
  if (/^[A-Z]{2,5}$/.test(t)) return spell(t);
  // camelCase and PascalCase are read as one word by the voice; a space is
  // enough to fix it and keeps the caption readable.
  if (/^[a-z]+[A-Z][a-zA-Z]*$/.test(t) || /^[A-Z][a-z]+[A-Z][a-zA-Z]*$/.test(t)) {
    return t.replace(/([a-z])([A-Z])/g, "$1 $2");
  }
  return null;
}

/**
 * Everything above, applied to what was fetched.
 *
 * Order matters: scrub first, so nothing dropped can influence what is
 * extracted; dedupe by term, keeping the first (pages are visited
 * best-source-first); cap last, so the cap trims the tail rather than
 * whichever page happened to be large.
 */
export function harvest(pages: FetchedPage[]): DocsDigest {
  const terms: Term[] = [];
  const tasks: Task[] = [];
  let secrets = 0;
  let instructions = 0;
  let corpus = "";

  for (const page of pages) {
    const cut = page.body.slice(0, BUDGET.bytesPerPage);
    const isHtml = /html/i.test(page.contentType);

    // Plain text is scrubbed whole. HTML is scrubbed per heading and per body
    // below instead - scrubbing it whole as well would count every dropped
    // line twice and report an alarming number for one bad line.
    if (!isHtml) {
      const cleaned = scrub(cut);
      secrets += cleaned.secrets;
      instructions += cleaned.instructions;
      corpus += `\n${cleaned.text}`;
      if (/llms\.txt$/i.test(page.url)) {
        const parsed = parseLlmsTxt(cleaned.text, page.url);
        terms.push(...parsed.terms);
        tasks.push(...parsed.tasks);
      }
      continue;
    }

    const found = headings(cut);
    // A 404 served with a 200 describes nothing about the product.
    if (looksMissing(found.map((h) => h.text))) continue;

    for (const h of found) {
      const heading = scrub(h.text);
      const body = scrub(h.body);
      secrets += heading.secrets + body.secrets;
      instructions += heading.instructions + body.instructions;
      // A heading that was itself dropped takes its section with it: whatever
      // it was, it is not the name of a feature.
      if (heading.secrets || heading.instructions) continue;
      const gloss = firstSentence(body.text);
      if (h.level <= 3 && gloss) terms.push({ term: h.text, gloss, from: page.url });
      if (isTaskTitle(h.text) || h.steps >= 2) {
        tasks.push({ title: h.text, url: page.url, ...(h.steps >= 2 ? { steps: h.steps } : {}) });
      }
      corpus += `\n${h.text}\n${body.text}`;
    }
  }

  const known = acronyms(corpus);
  const seen = new Set<string>();
  const glossary = terms
    .filter((t) => {
      const key = t.term.toLowerCase();
      if (seen.has(key) || !t.gloss) return false;
      seen.add(key);
      return true;
    })
    .slice(0, BUDGET.terms);

  const taskSeen = new Set<string>();
  const uniqueTasks = tasks
    .filter((t) => {
      const key = t.title.toLowerCase();
      if (taskSeen.has(key)) return false;
      taskSeen.add(key);
      return true;
    })
    .slice(0, BUDGET.tasks);

  const pronunciation: Pronunciation[] = [];
  const said = new Set<string>();
  for (const { term } of glossary) {
    for (const word of term.split(/[\s,/()]+/).filter(Boolean)) {
      const say = speakable(word, known);
      if (say && say !== word && !said.has(word)) {
        said.add(word);
        pronunciation.push({ term: word, say });
      }
    }
  }

  return { glossary, tasks: uniqueTasks, pronunciation, dropped: { secrets, instructions } };
}
