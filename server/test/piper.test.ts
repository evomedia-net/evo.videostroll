/**
 * Piper without Piper. The real binary and a 60 MB voice are not test
 * dependencies; what needs proving is the integration around it - the
 * arguments, the sample-rate sidecar, raw PCM in, canonical WAV out, and the
 * error a user sees when it is missing. A fake `piper` written in Node emits
 * silence at 22050 Hz for a length derived from the input, so the resampled
 * duration is checkable exactly.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VoiceSchema } from "../src/storyboard.js";
import { PiperProvider, piperModel, piperSampleRate } from "../src/tts/piper.js";
import { readWav, SAMPLE_RATE } from "../src/wav.js";

let dir: string;
let fakePiper: string;
let model: string;
const saved = { PIPER_PATH: process.env.PIPER_PATH, PIPER_MODEL: process.env.PIPER_MODEL };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "videostroll-piper-"));
  // The fake: 22050 Hz s16le mono silence, 100 ms per word of input, honouring --output-raw only.
  const js = join(dir, "fake-piper.js");
  await writeFile(
    js,
    `const args = process.argv.slice(2);
if (!args.includes("--output-raw")) { process.stderr.write("expected --output-raw\\n"); process.exit(2); }
const mi = args.indexOf("--model"); if (mi < 0) { process.stderr.write("expected --model\\n"); process.exit(2); }
let text = ""; process.stdin.on("data", d => text += d); process.stdin.on("end", () => {
  const words = text.trim().split(/\\s+/).filter(Boolean).length;
  const ms = words * 100; const bytes = Math.round(22050 * ms / 1000) * 2;
  process.stdout.write(Buffer.alloc(bytes)); });`,
  );
  // A .js PIPER_PATH runs under node - the provider's documented seam for a
  // fake or a wrapper. No .cmd launcher: Node refuses to spawn one without a
  // shell (EINVAL), and the provider deliberately never uses a shell.
  fakePiper = js;
  model = join(dir, "en_test-medium.onnx");
  await writeFile(model, "not a real model");
  await writeFile(`${model}.json`, JSON.stringify({ audio: { sample_rate: 22050 } }));
  process.env.PIPER_PATH = fakePiper;
  process.env.PIPER_MODEL = model;
});

afterAll(() => {
  process.env.PIPER_PATH = saved.PIPER_PATH;
  process.env.PIPER_MODEL = saved.PIPER_MODEL;
});

describe("piper provider", () => {
  it("reads the model's sample rate from its sidecar, defaulting to 22050 without one", async () => {
    expect(await piperSampleRate(model)).toBe(22050);
    expect(await piperSampleRate(join(dir, "nope.onnx"))).toBe(22050);
  });

  it("resolves the model from voice.name first, then PIPER_MODEL, and refuses with neither", () => {
    const v = VoiceSchema.parse({ provider: "piper" });
    expect(piperModel(v)).toBe(model);
    expect(piperModel(VoiceSchema.parse({ provider: "piper", name: "x.onnx" }))).toBe("x.onnx");
    expect(() => piperModel(v, {})).toThrow(/PIPER_MODEL/);
  });

  it("turns raw 22050 Hz PCM into the canonical 24 kHz WAV with the right duration", async () => {
    const synth = await new PiperProvider().synthesise("one two three four five", VoiceSchema.parse({ provider: "piper" }));
    const w = readWav(synth.audio);
    expect(w.rate).toBe(SAMPLE_RATE);
    expect(w.channels).toBe(1);
    expect(w.bits).toBe(16);
    expect(Math.abs(synth.durationMs - 500)).toBeLessThanOrEqual(5); // 5 words x 100 ms, resampled
    expect(synth.words).toEqual([]); // piper reports no word timing
  });

  it("names the fix when the binary is missing", async () => {
    process.env.PIPER_PATH = join(dir, "does-not-exist.exe");
    await expect(new PiperProvider().synthesise("hi", VoiceSchema.parse({ provider: "piper" }))).rejects.toThrow(/PIPER_PATH|could not start/);
    process.env.PIPER_PATH = fakePiper;
  });
});
