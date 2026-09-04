#!/usr/bin/env node
/**
 * Serve `docs/` over HTTP so a storyboard can point at a stable URL.
 *
 * The recorder navigates to a URL, so recording a page that lives on disk needs
 * one. A `file://` URL would work on the machine that wrote it and nowhere
 * else, and the path would have to go into the storyboard - which is exactly
 * the kind of local detail that must not be committed. So: a fixed port, no
 * dependencies, and a storyboard anyone can re-render.
 *
 *   node scripts/serve-docs.mjs [port]     # default 8099
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS = resolve(fileURLToPath(new URL("../../docs", import.meta.url)));
const PORT = Number(process.argv[2] ?? 8099);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
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
  } catch {
    res.writeHead(404).end("not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`docs on http://127.0.0.1:${PORT}/quickstart.html`);
});
