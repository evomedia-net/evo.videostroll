/**
 * Serves test/fixture over HTTP on an ephemeral port. Node's http module, no
 * dependency, no network: the whole suite runs on a plane.
 */
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "fixture");
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };

export interface Fixture {
  url: string;
  close(): Promise<void>;
}

export async function startFixture(): Promise<Fixture> {
  const server: Server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]));
    const file = join(ROOT, path === "/" || path === "\\" ? "index.html" : path);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("fixture server has no port");
  return {
    url: `http://127.0.0.1:${addr.port}/`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
