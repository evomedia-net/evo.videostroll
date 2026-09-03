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
import { startServer } from "./mcp.js";

startServer().catch((e) => {
  console.error(`videostroll: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(1);
});
