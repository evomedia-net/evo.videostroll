// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Narration providers, behind one interface. Every provider returns the same
 * thing: a canonical WAV (see wav.ts), its duration, and per-word timing when
 * the engine knows it. The step is paced to durationMs BEFORE any action runs,
 * which is why synthesis happens first - see session.ts.
 *
 * No provider falls back to another on its own. A silent video where a voice
 * was asked for is a wrong-looking success; the error names the alternatives
 * and the caller chooses.
 */
import type { Voice } from "../storyboard.js";
import { EdgeProvider } from "./edge.js";
import { PiperProvider } from "./piper.js";
import { SilentProvider } from "./silent.js";

export interface WordBoundary {
  word: string;
  offsetMs: number;
  durationMs: number;
}

export interface Synthesis {
  /** 16-bit PCM mono 24 kHz WAV, header included. */
  audio: Buffer;
  durationMs: number;
  /** Empty when the provider cannot report word timing; captions then fall back to proportional-by-word. */
  words: WordBoundary[];
}

export interface TtsProvider {
  readonly name: string;
  synthesise(text: string, voice: Voice): Promise<Synthesis>;
}

export function getProvider(voice: Voice): TtsProvider {
  switch (voice.provider) {
    case "silent":
      return new SilentProvider();
    case "edge":
      return new EdgeProvider();
    case "piper":
      return new PiperProvider();
  }
}

/** Split narration into the words the provider will speak. Shared by providers and captions so counts agree. */
export function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}
