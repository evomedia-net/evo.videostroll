/**
 * Captions are arithmetic on top of the narration timing, so they are tested
 * without a browser: sentence splitting, proportional and word-boundary
 * timing, wrapping, and the exact SRT/VTT byte shapes players expect.
 */
import { describe, expect, it } from "vitest";
import { cuesForStep, fmtSrt, fmtVtt, splitSentences, toSrt, toVtt, wrapCue } from "../src/captions.js";
import { SilentProvider, silentDurationMs } from "../src/tts/silent.js";
import { VoiceSchema } from "../src/storyboard.js";

const voice = VoiceSchema.parse({ provider: "silent", wordsPerMinute: 150 });

describe("captions", () => {
  it("splits on sentence punctuation and keeps it", () => {
    expect(splitSentences("This is one. This is two! Is this three? Yes.")).toEqual(["This is one.", "This is two!", "Is this three?", "Yes."]);
    expect(splitSentences("No punctuation at all")).toEqual(["No punctuation at all"]);
    expect(splitSentences("Version 1.2 ships today. Read the notes.")).toEqual(["Version 1.2 ships today.", "Read the notes."]);
  });

  it("wraps at 42 characters, at most two lines, never dropping a word", () => {
    const long = "The heading is the only thing on the page that is not a paragraph or a link, and that is deliberate.";
    const wrapped = wrapCue(long);
    const lines = wrapped.split("\n");
    expect(lines.length).toBe(2);
    expect(wrapped.replace("\n", " ")).toBe(long);
    expect(wrapCue("Short.")).toBe("Short.");
  });

  it("times cues from the silent provider's word boundaries, inside the step", async () => {
    const narration = "This is example dot com. Everything on it fits in one screen.";
    const synth = await new SilentProvider().synthesise(narration, voice);
    expect(synth.durationMs).toBe(silentDurationMs(narration, 150));
    const cues = cuesForStep(narration, 5_000, synth, 1);
    expect(cues.length).toBe(2);
    expect(cues[0].index).toBe(1);
    expect(cues[0].startMs).toBe(5_000);
    expect(cues[1].endMs).toBeLessThanOrEqual(5_000 + synth.durationMs);
    expect(cues[0].endMs).toBeLessThanOrEqual(cues[1].startMs);
    expect(cues[1].text).toBe("Everything on it fits in one screen.");
  });

  it("never emits a zero-length cue", async () => {
    const synth = await new SilentProvider().synthesise("Hi.", voice);
    const [cue] = cuesForStep("Hi.", 0, synth, 7);
    expect(cue.index).toBe(7);
    expect(cue.endMs - cue.startMs).toBeGreaterThanOrEqual(300);
  });

  it("formats timestamps the way SRT and VTT parsers require", () => {
    expect(fmtSrt(0)).toBe("00:00:00,000");
    expect(fmtSrt(3_723_456)).toBe("01:02:03,456");
    expect(fmtVtt(3_723_456)).toBe("01:02:03.456");
  });

  it("writes SRT and VTT with the right skeletons", () => {
    const cues = [
      { index: 1, startMs: 0, endMs: 1500, text: "One." },
      { index: 2, startMs: 1500, endMs: 3000, text: "Two,\nwrapped." },
    ];
    expect(toSrt(cues)).toBe("1\n00:00:00,000 --> 00:00:01,500\nOne.\n\n2\n00:00:01,500 --> 00:00:03,000\nTwo,\nwrapped.\n\n");
    expect(toVtt(cues).startsWith("WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.500\nOne.\n")).toBe(true);
  });
});
