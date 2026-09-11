/**
 * The MCP surface, end to end: a real client spawns the real server over
 * stdio and drives a walkthrough with the tools an agent would use. M1 and
 * M2 tested the engine; this tests the thing a client actually talks to -
 * and it is the interactive loop the skill describes: observe, decide from
 * what the page says, step, verify.
 */
import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixture, type Fixture } from "./fixture-server.js";

const SERVER = join(fileURLToPath(new URL(".", import.meta.url)), "..");
let fixture: Fixture;
let client: Client;

/** Every tool returns JSON as text; parse it and surface isError as a thrown error, the way an agent would read it. */
async function call<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as { content: Array<{ type: string; text?: string }>; isError?: boolean };
  const text = res.content.find((c) => c.type === "text")?.text ?? "{}";
  if (res.isError) throw new Error(JSON.parse(text).error ?? text);
  return JSON.parse(text) as T;
}

beforeAll(async () => {
  // The server runs from dist - build it here rather than assume a prior
  // `npm run build`, so the test is honest on a fresh checkout. tsc is invoked
  // through node, not npm: Node refuses to spawn npm.cmd without a shell.
  const tsc = spawnSync(process.execPath, [join(SERVER, "node_modules", "typescript", "bin", "tsc"), "-p", join(SERVER, "tsconfig.json")], { cwd: SERVER, stdio: "pipe" });
  if (tsc.status !== 0) throw new Error(`build failed:\n${tsc.stdout}${tsc.stderr}`);
  fixture = await startFixture();
  client = new Client({ name: "videostroll-test-client", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(SERVER, "dist", "index.js")], cwd: SERVER }));
});

afterAll(async () => {
  await client?.close();
  await fixture?.close();
});

describe("MCP server over stdio", () => {
  it("exposes the seven tools with descriptions", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["videostroll_abort", "videostroll_docs", "videostroll_finish", "videostroll_observe", "videostroll_render", "videostroll_start", "videostroll_step"]);
    for (const t of tools) expect(t.description, t.name).toBeTruthy();
  });

  it("drives a walkthrough interactively: observe, decide from the page, step, finish", async () => {
    const out = join(tmpdir(), `videostroll-mcp-${process.pid}`);
    const started = await call<{ sessionId: string; page: { title: string; snapshot: string } }>("videostroll_start", {
      url: fixture.url,
      title: "MCP tour",
      voice: { provider: "silent", wordsPerMinute: 300 },
      outputDir: out,
    });
    expect(started.sessionId).toMatch(/^[0-9a-f]{12}$/);
    expect(started.page.title).toBe("Fixture — Home");

    // The agent's move: read the snapshot, find the link to the second page
    // BY ITS ACCESSIBLE NAME, and build the selector from that - nothing
    // hardcoded that the page did not say.
    const observed = await call<{ snapshot: string }>("videostroll_observe", { sessionId: started.sessionId });
    const m = /link "([^"]*Second page[^"]*)"/.exec(observed.snapshot);
    expect(m, "snapshot should list the link by name").not.toBeNull();
    const linkName = m![1];

    const s1 = await call<{ step: { index: number; startMs: number; endMs: number; narrationMs: number } }>("videostroll_step", {
      sessionId: started.sessionId,
      narration: "This is the fixture site, seen through the MCP tools.",
      actions: [{ type: "move", target: { selector: "h1" } }],
      chapter: "Home",
    });
    expect(s1.step.index).toBe(0);
    expect(s1.step.endMs - s1.step.startMs).toBeGreaterThanOrEqual(s1.step.narrationMs);

    const s2 = await call<{ step: { index: number; url: string; title: string }; page: { title: string } }>("videostroll_step", {
      sessionId: started.sessionId,
      narration: "Following the link the snapshot named takes us to the second page.",
      actions: [
        { type: "click", target: { selector: `role=link[name="${linkName}"]` } },
        { type: "waitFor", target: { selector: "#second-heading" } },
      ],
    });
    expect(s2.step.index).toBe(1);
    expect(s2.step.title).toBe("Fixture — Second page");
    expect(s2.page.title).toBe("Fixture — Second page");

    const done = await call<{ mp4: string; srt: string; manifest: string; storyboard: string; steps: number; durationMs: number }>("videostroll_finish", { sessionId: started.sessionId });
    expect(done.steps).toBe(2);
    for (const f of [done.mp4, done.srt, done.manifest, done.storyboard]) expect((await stat(f)).size, f).toBeGreaterThan(0);
    const manifest = JSON.parse(await readFile(done.manifest, "utf8"));
    expect(manifest.steps[1].url).toMatch(/page2\.html$/);

    // The session is gone once finished: the same id now errors clearly.
    await expect(call("videostroll_observe", { sessionId: started.sessionId })).rejects.toThrow(/no such session/);
  });

  it("returns a clear error for an unknown session and aborts a live one", async () => {
    await expect(call("videostroll_step", { sessionId: "000000000000", narration: "x", actions: [] })).rejects.toThrow(/no such session/);
    const s = await call<{ sessionId: string }>("videostroll_start", { url: fixture.url, outputDir: join(tmpdir(), `videostroll-mcp-abort-${process.pid}`) });
    const aborted = await call<{ aborted: string }>("videostroll_abort", { sessionId: s.sessionId });
    expect(aborted.aborted).toBe(s.sessionId);
    await expect(call("videostroll_observe", { sessionId: s.sessionId })).rejects.toThrow(/no such session/);
  });

  it("rejects a credential-shaped narration at the tool boundary", async () => {
    const s = await call<{ sessionId: string }>("videostroll_start", { url: fixture.url, outputDir: join(tmpdir(), `videostroll-mcp-secret-${process.pid}`) });
    await expect(call("videostroll_step", { sessionId: s.sessionId, narration: "The password: hunter2 unlocks it", actions: [] })).rejects.toThrow(/credential|secret/i);
    await call("videostroll_abort", { sessionId: s.sessionId });
  });
});
