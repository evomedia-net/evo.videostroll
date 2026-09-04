/**
 * One walkthrough, several voices.
 *
 * A storyboard names a voice and every step inherits it. A step may name its
 * own - a different speaker for a different section, a male narrator and a
 * female one, or a different provider entirely. The merge is the part worth
 * pinning: what a step does not say, it inherits, and what it does say wins.
 *
 * The end-to-end half uses the silent provider at two different speaking rates,
 * so the override is proved by a duration the test can predict rather than by
 * an audio file it would have to listen to - and it stays offline.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveVoice, VoiceSchema, parseStep, type Voice } from "../src/storyboard.js";
import { Session } from "../src/session.js";
import { startFixture, type Fixture } from "./fixture-server.js";

const base = (over: Partial<Voice> = {}): Voice =>
  VoiceSchema.parse({ provider: "edge", name: "en-US-GuyNeural", rate: 1, wordsPerMinute: 150, ...over });

describe("resolveVoice", () => {
  it("returns the storyboard's voice when a step says nothing", () => {
    expect(resolveVoice(base(), undefined)).toEqual(base());
    expect(resolveVoice(base(), {})).toEqual(base());
  });

  it("swaps only the speaker when a step names only a voice", () => {
    const v = resolveVoice(base(), { name: "en-US-AvaNeural" });
    expect(v.name).toBe("en-US-AvaNeural");
    expect(v.provider).toBe("edge");
    expect(v.rate).toBe(1);
  });

  it("keeps the inherited name when the step re-states the same provider", () => {
    expect(resolveVoice(base(), { provider: "edge", rate: 1.2 })).toMatchObject({
      provider: "edge",
      name: "en-US-GuyNeural",
      rate: 1.2,
    });
  });

  it("drops the inherited name when the step changes provider", () => {
    // en-US-GuyNeural means nothing to Piper. Carrying it across would either
    // fail deep inside the provider or, worse, be ignored silently.
    const v = resolveVoice(base(), { provider: "piper" });
    expect(v.provider).toBe("piper");
    expect(v.name).toBeUndefined();
  });

  it("keeps a name the step supplies alongside a new provider", () => {
    const v = resolveVoice(base(), { provider: "piper", name: "en_GB-alba-medium" });
    expect(v).toMatchObject({ provider: "piper", name: "en_GB-alba-medium" });
  });

  it("does not mutate the voice it was given", () => {
    const original = base();
    resolveVoice(original, { provider: "silent", rate: 2 });
    expect(original).toEqual(base());
  });
});

describe("a step may carry its own voice", () => {
  it("is accepted by the step parser and rejects an unknown field", () => {
    expect(parseStep({ narration: "x", voice: { name: "en-GB-SoniaNeural" } }).voice).toEqual({
      name: "en-GB-SoniaNeural",
    });
    expect(() => parseStep({ narration: "x", voice: { nope: 1 } })).toThrow();
  });

  it("rejects a rate outside the provider-independent range", () => {
    expect(() => parseStep({ narration: "x", voice: { rate: 9 } })).toThrow();
  });
});

describe("end to end", () => {
  let fixture: Fixture;
  beforeAll(async () => {
    fixture = await startFixture();
  });
  afterAll(async () => {
    await fixture?.close();
  });

  it("speaks one step in a different voice and records which voice each step used", async () => {
    const out = join(tmpdir(), `videostroll-voices-${process.pid}`);
    const s = await Session.start({
      url: fixture.url,
      title: "Two voices",
      voice: { provider: "silent", wordsPerMinute: 300 },
      outputDir: out,
    });

    const narration = "The same words, spoken at two different speeds.";
    const fast = await s.step({ id: "fast", narration, actions: [] });
    // Half the words per minute, so the same sentence takes about twice as long.
    const slow = await s.step({ id: "slow", narration, actions: [], voice: { wordsPerMinute: 150 } });
    const back = await s.step({ id: "back", narration, actions: [] });

    expect(fast.step.voice).toMatchObject({ provider: "silent", wordsPerMinute: 300 });
    expect(slow.step.voice).toMatchObject({ provider: "silent", wordsPerMinute: 150 });
    // The third step inherits again: an override is not sticky.
    expect(back.step.voice).toMatchObject({ provider: "silent", wordsPerMinute: 300 });

    expect(slow.step.narrationMs).toBeGreaterThan(fast.step.narrationMs * 1.5);
    expect(back.step.narrationMs).toBe(fast.step.narrationMs);

    const a = await s.finish();
    const manifest = JSON.parse(await readFile(a.manifest, "utf8"));
    expect(manifest.steps.map((x: { voice: Voice }) => x.voice.wordsPerMinute)).toEqual([300, 150, 300]);
  });
});
