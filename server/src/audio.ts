// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Anything a provider returns becomes the one canonical WAV (wav.ts) here,
 * through the pinned ffmpeg. Edge returns MP3; Piper returns raw PCM at its
 * model's rate; a future provider may return Opus. The timeline code never
 * has to know - it only ever sees 16-bit mono 24 kHz.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFfmpeg } from "./assemble.js";
import { readWav, SAMPLE_RATE } from "./wav.js";

async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "videostroll-audio-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const CANON = ["-ac", "1", "-ar", String(SAMPLE_RATE), "-sample_fmt", "s16", "-f", "wav"];

/** Decode a container/codec ffmpeg understands (mp3, opus, wav, ...) into the canonical WAV. */
export async function toCanonicalWav(input: Buffer, ext: string): Promise<Buffer> {
  // Already canonical? Skip the round trip; the check is cheap and exact.
  try {
    const w = readWav(input);
    if (w.rate === SAMPLE_RATE && w.channels === 1 && w.bits === 16) return input;
  } catch {
    /* not a WAV - decode below */
  }
  return withTemp(async (dir) => {
    const src = join(dir, `in.${ext.replace(/^\./, "")}`);
    const out = join(dir, "out.wav");
    await writeFile(src, input);
    await runFfmpeg(["-y", "-i", src, ...CANON, out]);
    return readFile(out);
  });
}

/** Raw signed 16-bit little-endian mono PCM at `rate` Hz (what Piper emits) into the canonical WAV. */
export async function pcmToCanonicalWav(raw: Buffer, rate: number): Promise<Buffer> {
  return withTemp(async (dir) => {
    const src = join(dir, "in.pcm");
    const out = join(dir, "out.wav");
    await writeFile(src, raw);
    await runFfmpeg(["-y", "-f", "s16le", "-ar", String(rate), "-ac", "1", "-i", src, ...CANON, out]);
    return readFile(out);
  });
}
