#!/usr/bin/env node
/**
 * Serve `docs/` over HTTP, and back the voice picker.
 *
 * Static half: the recorder navigates to a URL, so recording a page that lives
 * on disk needs one. A `file://` URL would work on the machine that wrote it
 * and nowhere else, and the path would have to go into the storyboard - which
 * is exactly the kind of local detail that must not be committed. So: a fixed
 * port and a storyboard anyone can re-render.
 *
 * API half: docs/voices.html is a picker, and picking a voice without hearing
 * it is guessing. Two endpoints, both local-only:
 *
 *   GET /api/voices                       the catalogue, normalised
 *   GET /api/preview?name=&rate=&text=    that voice speaking, as a WAV
 *
 * The catalogue is fetched once and kept for the life of the process - it is a
 * few hundred rows that change about never, and the picker re-filters client
 * side. Preview is synthesised per request through the same provider the
 * recorder uses, so what you hear is what you will get.
 *
 * It binds to 127.0.0.1 only. That is the whole security model, so the request
 * is still validated rather than trusted: see parsePreview in src/voices.ts.
 *
 *   node scripts/serve-docs.mjs [port]     # default 8099
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { EdgeProvider } from "../dist/tts/edge.js";
import { filterVoices, locales, parsePreview, toCatalogue } from "../dist/voices.js";

const DOCS = resolve(fileURLToPath(new URL("../../docs", import.meta.url)));
const PORT = Number(process.argv[2] ?? 8099);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  // llms.txt, and anything else plain. Without this it falls through to
  // application/octet-stream, which makes a browser download the file instead
  // of showing it - the opposite of what a file meant to be read is for.
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

// ── the picker's two endpoints ───────────────────────────────────────────────

/** Fetched once per process; a few hundred rows that change about never. */
let catalogue = null;

async function getCatalogue() {
  if (catalogue) return catalogue;
  const { MsEdgeTTS } = await import("msedge-tts");
  catalogue = toCatalogue(await new MsEdgeTTS().getVoices());
  return catalogue;
}

function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": buf.length, "cache-control": "no-store" });
  res.end(buf);
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/voices") {
    const rows = await getCatalogue();
    const q = url.searchParams;
    const filtered = filterVoices(rows, {
      locale: q.get("locale") ?? undefined,
      gender: q.get("gender") ?? undefined,
      q: q.get("q") ?? undefined,
      monolingualOnly: q.get("mono") === "1",
    });
    sendJson(res, 200, { total: rows.length, count: filtered.length, locales: locales(rows), voices: filtered });
    return true;
  }

  if (url.pathname === "/api/preview") {
    const q = url.searchParams;
    const parsed = parsePreview({ name: q.get("name"), rate: q.get("rate"), text: q.get("text") });
    if (!parsed.ok) {
      sendJson(res, 400, { error: parsed.error });
      return true;
    }
    const { name, rate, text } = parsed.value;
    // The same provider the recorder uses, so the preview is the real thing
    // rather than an approximation of it.
    const synth = await new EdgeProvider().synthesise(text, { provider: "edge", name, rate, wordsPerMinute: 150 });
    res.writeHead(200, {
      "content-type": "audio/wav",
      "content-length": synth.audio.length,
      "cache-control": "no-store",
      "x-duration-ms": String(synth.durationMs),
      "x-word-count": String(synth.words.length),
    });
    res.end(synth.audio);
    return true;
  }

  return false;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      if (await handleApi(req, res, url)) return;
      sendJson(res, 404, { error: `no such endpoint: ${url.pathname}` });
      return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "quickstart.html";
    // Resolve inside DOCS and refuse anything that escapes it.
    const target = resolve(join(DOCS, normalize(rel)));
    if (target !== DOCS && !target.startsWith(DOCS + sep)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const info = await stat(target);
    if (!info.isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
      "content-length": body.length,
      "cache-control": "no-store",
    });
    res.end(body);
  } catch (e) {
    // An API failure is usually the voice service being unreachable, and a bare
    // 404 would send you looking in the wrong place for it.
    if ((req.url ?? "").startsWith("/api/")) {
      sendJson(res, 502, { error: e?.message ?? String(e) });
      return;
    }
    res.writeHead(404).end("not found");
  }
});

/**
 * The banner, read rather than inlined.
 *
 * The art contains both backticks and backslashes, so a template literal
 * mangles it and a quoted string turns it into an escaping puzzle that the
 * next person editing the art has to solve. A file is the honest place for
 * a picture. Missing is not fatal - the URLs below are the point.
 */
function banner() {
  try {
    return readFileSync(new URL("banner.txt", import.meta.url), "utf8").replace(/\n+$/, "");
  } catch {
    return null;
  }
}

/**
 * The project's own GitHub URL, taken from package.json rather than typed
 * here. One source of truth: if the repository ever moves, the banner follows
 * it instead of pointing confidently at nothing.
 */
function repoUrl() {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const raw = pkg.repository?.url ?? pkg.homepage ?? "";
    const clean = raw.replace(/^git\+/, "").replace(/\.git$/, "").replace(/#.*$/, "");
    return clean.startsWith("http") ? clean : null;
  } catch {
    return null;
  }
}

/** Green, unless the output is not a terminal or NO_COLOR asks otherwise. */
function green(text) {
  const plain = !process.stdout.isTTY || process.env.NO_COLOR !== undefined;
  return plain ? text : `\u001b[32m${text}\u001b[0m`;
}

server.listen(PORT, "127.0.0.1", () => {
  const art = banner();
  if (art) {
    console.log("");
    console.log(green(art));
    console.log("");
  }
  console.log(`docs   http://127.0.0.1:${PORT}/quickstart.html`);
  console.log(`setup  http://127.0.0.1:${PORT}/setup.html`);
  console.log(`voices http://127.0.0.1:${PORT}/voices.html`);
  console.log("");
  const repo = repoUrl();
  if (repo) { console.log(`github ${repo}`); }
  console.log("site   https://evomedia.net");
  console.log("");
  console.log("Ctrl-C to stop.");
});
