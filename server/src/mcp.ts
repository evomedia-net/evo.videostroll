// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The MCP surface over the engine. Six tools, JSON in and out. Sessions live
 * in this process; a client that forgets to finish or abort one leaves a
 * browser open until the server exits, which is why abort exists and why
 * finish closes the browser itself.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Session, render } from "./session.js";
import { ActionSchema } from "./storyboard.js";

const sessions = new Map<string, Session>();

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  return { isError: true as const, content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }] };
}

function get(sessionId: string): Session {
  const s = sessions.get(sessionId);
  if (!s) throw new Error(`no such session: ${sessionId}`);
  return s;
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "videostroll", version: "0.0.0-alpha.1" });

  server.registerTool(
    "videostroll_start",
    {
      title: "Start a walkthrough session",
      description:
        "Open the URL in a recording-ready browser with a visible cursor. Returns a sessionId and the page's accessibility snapshot - read it before deciding the first step.",
      inputSchema: {
        url: z.string().describe("Where the walkthrough begins"),
        title: z.string().optional(),
        viewport: z.object({ width: z.number().int().optional(), height: z.number().int().optional(), deviceScaleFactor: z.number().optional() }).optional(),
        voice: z
          .object({
            provider: z.enum(["edge", "piper", "openai", "elevenlabs", "silent"]).optional(),
            name: z.string().optional(),
            rate: z.number().optional(),
            wordsPerMinute: z.number().int().optional(),
          })
          .optional(),
        captions: z.enum(["sidecar", "burn", "both"]).optional(),
        storageState: z.string().optional().describe("Path to a Playwright storage-state file for an authenticated site. Never a credential."),
        outputDir: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const s = await Session.start(args);
        sessions.set(s.id, s);
        return json({ sessionId: s.id, outputDir: s.outputDir, page: await s.observe() });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "videostroll_step",
    {
      title: "Record one step",
      description:
        "One idea, at most two sentences of narration, and the actions that show it. Narration is synthesised first and the step is held until the voice finishes. Returns the step's timings and the page state after it.",
      inputSchema: {
        sessionId: z.string(),
        narration: z.string().min(1).max(400),
        actions: z.array(ActionSchema).default([]),
        id: z.string().optional(),
        minDurationMs: z.number().int().min(0).optional(),
        chapter: z.string().optional(),
      },
    },
    async ({ sessionId, ...step }) => {
      try {
        return json(await get(sessionId).step(step));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "videostroll_observe",
    {
      title: "Look without recording",
      description: "The current page's URL, title and accessibility snapshot. Records nothing.",
      inputSchema: { sessionId: z.string() },
    },
    async ({ sessionId }) => {
      try {
        return json(await get(sessionId).observe());
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "videostroll_finish",
    {
      title: "Assemble the walkthrough",
      description: "Encode, mux the narration, write captions (SRT/VTT), the manifest and the storyboard; close the browser. Read the manifest back before delivering.",
      inputSchema: { sessionId: z.string(), title: z.string().optional(), captions: z.enum(["sidecar", "burn", "both"]).optional() },
    },
    async ({ sessionId, ...o }) => {
      try {
        const s = get(sessionId);
        const result = await s.finish(o);
        sessions.delete(sessionId);
        return json(result);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "videostroll_abort",
    {
      title: "Abandon a session",
      description: "Close the browser and discard the recording.",
      inputSchema: { sessionId: z.string() },
    },
    async ({ sessionId }) => {
      try {
        await get(sessionId).abort();
        sessions.delete(sessionId);
        return json({ aborted: sessionId });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "videostroll_render",
    {
      title: "Render a whole storyboard",
      description: "Batch mode: the complete storyboard JSON in, the finished walkthrough out. Reproducible; the storyboard is the artefact.",
      inputSchema: { storyboard: z.record(z.string(), z.unknown()), outputDir: z.string().optional() },
    },
    async ({ storyboard, outputDir }) => {
      try {
        return json(await render(storyboard, { outputDir }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const shutdown = async () => {
    await Promise.all([...sessions.values()].map((s) => s.abort().catch(() => undefined)));
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
