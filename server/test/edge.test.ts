/**
 * The Edge provider without the network: the metadata parser and the rate
 * mapping are pure, and alignment is exercised with boundaries shaped the
 * way the real service shapes them - punctuation attached, hyphens split,
 * offsets in 100 ns ticks. The live round trip is `npm run check:edge`,
 * deliberately not a test, so the suite never depends on an unofficial
 * endpoint being up.
 */
import { describe, expect, it } from "vitest";
import { cuesForStep, alignSentence } from "../src/captions.js";
import { parseWordBoundaries, rateToProsody, TICKS_PER_MS } from "../src/tts/edge.js";
import { silenceWav } from "../src/wav.js";

const item = (text: string, offsetMs: number, durationMs: number, type = "WordBoundary") =>
  ({ Type: type, Data: { Offset: offsetMs * TICKS_PER_MS, Duration: durationMs * TICKS_PER_MS, text: { Text: text } } });

describe("edge provider (offline parts)", () => {
  it("parses WordBoundary metadata from ticks to milliseconds and ignores the rest", () => {
    const chunks = [
      JSON.stringify({ Metadata: [item("This", 100, 200), item("is", 350, 100), { Type: "SentenceBoundary", Data: { Offset: 0, Duration: 0 } }] }),
      JSON.stringify({ Metadata: [item("Edge.", 500, 400)] }),
      "{not json",
    ];
    expect(parseWordBoundaries(chunks)).toEqual([
      { word: "This", offsetMs: 100, durationMs: 200 },
      { word: "is", offsetMs: 350, durationMs: 100 },
      { word: "Edge.", offsetMs: 500, durationMs: 400 },
    ]);
  });

  it("maps voice.rate to the prosody percentage Edge expects", () => {
    expect(rateToProsody(1)).toBe("+0%");
    expect(rateToProsody(1.25)).toBe("+25%");
    expect(rateToProsody(0.8)).toBe("-20%");
  });

  it("aligns sentences to boundaries even when the engine splits or attaches punctuation", () => {
    const narration = "Meet the co-founder. She built it in 2019.";
    // The engine reports "co-founder" as two words, keeps the period on "founder.", and says "twenty nineteen".
    const wb = parseWordBoundaries([
      JSON.stringify({
        Metadata: [
          item("Meet", 0, 200), item("the", 200, 100), item("co", 300, 150), item("founder.", 450, 400),
          item("She", 1200, 150), item("built", 1350, 200), item("it", 1550, 100), item("in", 1650, 100), item("2019.", 1750, 600),
        ],
      }),
    ]);
    const synth = { audio: silenceWav(2400), durationMs: 2400, words: wb };
    const cues = cuesForStep(narration, 10_000, synth, 1);
    expect(cues.length).toBe(2);
    expect(cues[0]).toMatchObject({ startMs: 10_000, endMs: 10_850, text: "Meet the co-founder." });
    expect(cues[1]).toMatchObject({ startMs: 11_200, endMs: 12_350, text: "She built it in 2019." });
  });

  it("falls back per sentence, not per step, when one sentence cannot be aligned", () => {
    const narration = "First sentence here. Second one says something else.";
    const wb = parseWordBoundaries([
      JSON.stringify({ Metadata: [item("First", 0, 300), item("sentence", 300, 400), item("here.", 700, 300), item("Completely", 1500, 300), item("different", 1800, 300)] }),
    ]);
    const synth = { audio: silenceWav(3000), durationMs: 3000, words: wb };
    const cues = cuesForStep(narration, 0, synth, 1);
    expect(cues[0]).toMatchObject({ startMs: 0, endMs: 1000 }); // exact, from boundaries
    // second sentence: proportional (3 of 8 words done -> starts at 3/8 of 3000ms)
    expect(cues[1].startMs).toBe(Math.round((3 / 8) * 3000));
    expect(cues[1].endMs).toBe(3000);
  });

  it("alignSentence returns null rather than guessing when the words do not match", () => {
    const wb = [{ word: "Hello", offsetMs: 0, durationMs: 100 }, { word: "world", offsetMs: 100, durationMs: 100 }];
    expect(alignSentence("Goodbye world", wb, 0)).toBeNull();
    expect(alignSentence("Hello world", wb, 0)).toEqual({ start: 0, end: 200, next: 2 });
  });
});
