#!/usr/bin/env node
// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * `videostroll` - the MCP server over stdio. Register it with your MCP client:
 *
 *   { "mcpServers": { "videostroll": { "command": "npx", "args": ["evo.videostroll"] } } }
 *
 * Nothing is written to stdout except the protocol; diagnostics go to stderr,
 * because stdout IS the transport.
 */
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./mcp.js";
import { installSkill } from "./skill-install.js";

// One flag, because an npm install has no `skill/` directory to copy from and
// the server without the skill is an undirected recorder.
if (process.argv.includes("--install-skill")) {
  const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const { target, outcome } = installSkill(packageRoot, homedir());
  console.error(`videostroll: skill ${outcome}\n  ${target}`);
  process.exit(outcome === "no skill in this package" ? 1 : 0);
}

startServer().catch((e) => {
  console.error(`videostroll: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(1);
});
