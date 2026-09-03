#!/usr/bin/env node
// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Batch render from the command line, no MCP client needed:
 *
 *   npm run render -- path/to/storyboard.json [outputDir]
 *
 * The storyboard is the artefact; this is its rendering. Prints the manifest
 * summary as JSON so a script can read the paths back.
 */
import { readFile } from "node:fs/promises";
import { render } from "../dist/session.js";

const [storyboardPath, outputDir] = process.argv.slice(2);
if (!storyboardPath) {
  console.error("usage: render.mjs <storyboard.json> [outputDir]");
  process.exit(2);
}

const started = Date.now();
try {
  const storyboard = JSON.parse(await readFile(storyboardPath, "utf8"));
  const result = await render(storyboard, { outputDir });
  console.log(JSON.stringify({ ...result, wallMs: Date.now() - started }, null, 2));
} catch (e) {
  console.error(`render failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
