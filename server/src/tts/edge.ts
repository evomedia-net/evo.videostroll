// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Microsoft Edge's neural voices, through the same endpoint the browser's
 * Read Aloud uses. Free, no account, no key - and unofficial, which is why
 * Piper exists as the offline alternative and why every failure here is
 * loud rather than silently degraded.
 *
 * The service reports a WordBoundary for each spoken word with an offset and
 * duration in 100-nanosecond ticks. Those become caption timing, aligned to
 * the narration in captions.ts.
 */
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { Voice } from "../storyboard.js";
import { toCanonicalWav } from "../audio.js";
import { wavDurationMs } from "../wav.js";
import type { Synthesis, TtsProvider, WordBoundary } from "./index.js";

/** Presenter-style, clear, widely available. Kelly can override per storyboard with voice.name. */
export const DEFAULT_EDGE_VOICE = "en-US-GuyNeural";

/** Azure/Edge metadata offsets are in 100 ns ticks. */
export const TICKS_PER_MS = 10_000;

interface EdgeMetadataItem {
  Type?: string;
  Data?: { Offset?: number; Duration?: number; text?: { Text?: string } };
}

/** Parse the metadata chunks the stream emits into word boundaries. Pure, so it is unit-tested offline. */
export function parseWordBoundaries(chunks: Array<string | Buffer>): WordBoundary[] {
  const out: WordBoundary[] = [];
  for (const chunk of chunks) {
    let obj: { Metadata?: EdgeMetadataItem[] };
    try {
      obj = JSON.parse(chunk.toString());
    } catch {
      continue; // a partial frame; the library normally hands us whole objects
    }
    for (const item of obj.Metadata ?? []) {
      if (item.Type !== "WordBoundary" || !item.Data) continue;
      const word = item.Data.text?.Text ?? "";
      if (!word) continue;
      out.push({
        word,
        offsetMs: Math.round((item.Data.Offset ?? 0) / TICKS_PER_MS),
        durationMs: Math.round((item.Data.Duration ?? 0) / TICKS_PER_MS),
      });
    }
  }
  return out.sort((a, b) => a.offsetMs - b.offsetMs);
}

/** voice.rate (0.5-2) as the SSML prosody percentage Edge expects: 1 -> "+0%", 1.25 -> "+25%". */
export function rateToProsody(rate: number): string {
  const pct = Math.round((rate - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function collect(stream: NodeJS.ReadableStream | null): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    if (!stream) return resolve([]);
    const parts: Buffer[] = [];
    stream.on("data", (d: Buffer | string) => parts.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    stream.on("end", () => resolve(parts));
    stream.on("close", () => resolve(parts));
    stream.on("error", reject);
  });
}

export class EdgeProvider implements TtsProvider {
  readonly name = "edge";

  async synthesise(text: string, voice: Voice): Promise<Synthesis> {
    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(voice.name ?? DEFAULT_EDGE_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { wordBoundaryEnabled: true });
      const { audioStream, metadataStream } = await tts.toStream(text, { rate: rateToProsody(voice.rate) });
      const [audioParts, metaParts] = await Promise.all([collect(audioStream), collect(metadataStream)]);
      const mp3 = Buffer.concat(audioParts);
      if (mp3.length === 0) throw new Error("Edge TTS returned no audio");
      const audio = await toCanonicalWav(mp3, "mp3");
      return { audio, durationMs: wavDurationMs(audio), words: parseWordBoundaries(metaParts) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`edge voice failed (${msg}). Edge TTS needs network and is an unofficial endpoint; use voice.provider "piper" for offline, or "silent".`);
    } finally {
      try {
        tts.close();
      } catch {
        /* already closed */
      }
    }
  }
}
