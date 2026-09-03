// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Piper: fully local neural TTS. The trade for needing no network and no
 * third party is a one-time setup - the `piper` binary and one voice model
 * (~60 MB of ONNX) - which is why it is the offline OPTION rather than the
 * default. Piper reports no word timing, so captions for it are proportional.
 *
 * Contract: the binary comes from PIPER_PATH (or `piper` on PATH), the model
 * from voice.name or PIPER_MODEL, and the model's sample rate from the
 * `<model>.json` beside it - Piper writes raw PCM at whatever rate the model
 * was trained at, and guessing 22050 would pitch-shift the wrong voice.
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { Voice } from "../storyboard.js";
import { pcmToCanonicalWav } from "../audio.js";
import { wavDurationMs } from "../wav.js";
import type { Synthesis, TtsProvider } from "./index.js";

export const DEFAULT_PIPER_RATE = 22_050;

export function piperBinary(env: NodeJS.ProcessEnv = process.env): string {
  return env.PIPER_PATH || "piper";
}

export function piperModel(voice: Voice, env: NodeJS.ProcessEnv = process.env): string {
  const model = voice.name || env.PIPER_MODEL;
  if (!model) throw new Error("piper needs a voice model: set voice.name to the .onnx path, or PIPER_MODEL in the environment");
  return model;
}

/** The model's own sample rate, from its sidecar config; falls back to Piper's usual 22050. */
export async function piperSampleRate(model: string): Promise<number> {
  try {
    const cfg = JSON.parse(await readFile(`${model}.json`, "utf8")) as { audio?: { sample_rate?: number } };
    return cfg.audio?.sample_rate ?? DEFAULT_PIPER_RATE;
  } catch {
    return DEFAULT_PIPER_RATE;
  }
}

/**
 * Run piper: text on stdin, raw s16le mono PCM on stdout. Length scale is the
 * inverse of rate.
 *
 * A PIPER_PATH ending in .js/.mjs runs under this Node - the seam the tests
 * use for a fake piper, and a wrapper script can use for a real one. It is
 * done this way rather than with shell: true because Node refuses to spawn
 * .cmd/.bat files without a shell (EINVAL, the CVE-2024-27980 hardening), and
 * a shell would put the model path and the rate through shell parsing.
 */
export function runPiper(bin: string, model: string, text: string, rate: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = ["--model", model, "--output-raw", "--length-scale", (1 / rate).toFixed(3)];
    const viaNode = /\.(m?js)$/i.test(bin);
    const child = spawn(viaNode ? process.execPath : bin, viaNode ? [bin, ...args] : args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => (err += d));
    child.on("error", (e) => reject(new Error(`could not start piper (${bin}): ${e.message}. Install Piper and set PIPER_PATH, or use voice.provider "edge" or "silent".`)));
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`piper exited ${code}: ${err.trim().slice(-400)}`))));
    child.stdin.end(text + "\n");
  });
}

export class PiperProvider implements TtsProvider {
  readonly name = "piper";

  async synthesise(text: string, voice: Voice): Promise<Synthesis> {
    const bin = piperBinary();
    const model = piperModel(voice);
    const [raw, rate] = await Promise.all([runPiper(bin, model, text, voice.rate), piperSampleRate(model)]);
    if (raw.length === 0) throw new Error("piper produced no audio");
    const audio = await pcmToCanonicalWav(raw, rate);
    return { audio, durationMs: wavDurationMs(audio), words: [] };
  }
}
