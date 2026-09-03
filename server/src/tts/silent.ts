// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The provider that speaks nothing. Its whole value is that it is
 * deterministic and offline: duration comes from word count at the storyboard's
 * words-per-minute, so a test can assert exact timings and CI needs no network,
 * no key and no voice model. It is also the honest fallback when a real
 * provider is unavailable - a silent video with correct captions beats no video.
 */
import type { Voice } from "../storyboard.js";
import { silenceWav } from "../wav.js";
import { words, type Synthesis, type TtsProvider } from "./index.js";

/** Below this a step reads as a cut - see the skill's pacing rule. */
export const MIN_NARRATION_MS = 800;

export function silentDurationMs(text: string, wordsPerMinute: number): number {
  const n = words(text).length;
  return Math.max(MIN_NARRATION_MS, Math.round((n / wordsPerMinute) * 60_000));
}

export class SilentProvider implements TtsProvider {
  readonly name = "silent";

  async synthesise(text: string, voice: Voice): Promise<Synthesis> {
    const ws = words(text);
    const durationMs = silentDurationMs(text, voice.wordsPerMinute);
    const per = ws.length ? durationMs / ws.length : durationMs;
    return {
      audio: silenceWav(durationMs),
      durationMs,
      // Evenly spaced, so proportional captions and word-boundary captions
      // agree exactly for this provider - one less thing that differs in tests.
      words: ws.map((word, i) => ({ word, offsetMs: Math.round(i * per), durationMs: Math.round(per) })),
    };
  }
}
