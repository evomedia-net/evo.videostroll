#!/usr/bin/env node
// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Live check of the Edge voice - deliberately a script, not a test. The test
 * suite must pass on a plane; this must fail the moment Microsoft changes an
 * unofficial endpoint. Run it before trusting a release:
 *
 *   npm run check:edge            # default voice
 *   npm run check:edge -- en-GB-RyanNeural
 *
 * Prints the duration, the word boundaries, and writes check-edge.wav beside
 * this script so a human can listen to it.
 */
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EdgeProvider, DEFAULT_EDGE_VOICE } from "../dist/tts/edge.js";
import { VoiceSchema } from "../dist/storyboard.js";

const text = "This is evo.videostroll, checking that the Edge voice still answers. Twelve words, one sentence, then another.";
const name = process.argv[2] ?? DEFAULT_EDGE_VOICE;
const voice = VoiceSchema.parse({ provider: "edge", name });
const started = Date.now();

try {
  const s = await new EdgeProvider().synthesise(text, voice);
  const out = join(dirname(fileURLToPath(import.meta.url)), "check-edge.wav");
  await writeFile(out, s.audio);
  console.log(`edge voice ${name}: ${s.durationMs} ms of audio in ${Date.now() - started} ms, ${s.words.length} word boundaries`);
  console.log(`  first: ${s.words.slice(0, 5).map((w) => `${w.word}@${w.offsetMs}`).join("  ")}`);
  console.log(`  last:  ${s.words.slice(-3).map((w) => `${w.word}@${w.offsetMs}+${w.durationMs}`).join("  ")}`);
  console.log(`  wrote ${out}`);
  if (s.words.length < 10) {
    console.error("FAIL: expected word boundaries for every spoken word - captions would fall back to proportional timing");
    process.exit(2);
  }
} catch (e) {
  console.error(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
