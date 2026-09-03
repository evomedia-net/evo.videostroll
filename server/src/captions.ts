// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Captions with timestamps. One cue per sentence; cue times come from the
 * provider's word boundaries when it has them, else proportionally by word
 * count across the narration's duration. Lines wrap at ~42 characters, two
 * lines per cue - the broadcast convention that keeps captions readable.
 */
import type { Synthesis } from "./tts/index.js";
import { words } from "./tts/index.js";

export interface Cue {
  /** 1-based, in output order. */
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

export const MAX_LINE = 42;

/** Split on sentence-ending punctuation. Keeps the punctuation with its sentence. */
export function splitSentences(text: string): string[] {
  const out = text
    .trim()
    .split(/(?<=[.!?…])\s+(?=[^a-z])/)
    .map((s) => s.trim())
    .filter(Boolean);
  return out.length ? out : [text.trim()];
}

/** Greedy wrap at MAX_LINE, at most two lines; a third line would be cut by most players. */
export function wrapCue(text: string): string {
  const ws = words(text);
  const lines: string[] = [];
  let line = "";
  for (const w of ws) {
    if (line && (line + " " + w).length > MAX_LINE) {
      lines.push(line);
      line = w;
    } else {
      line = line ? line + " " + w : w;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= 2) return lines.join("\n");
  // Rebalance into two lines rather than truncate: better a long line than a lost word.
  const mid = Math.ceil(ws.length / 2);
  return ws.slice(0, mid).join(" ") + "\n" + ws.slice(mid).join(" ");
}

/**
 * Cues for one step. stepStartMs is the step's start on the OUTPUT timeline.
 * The narration occupies [stepStartMs, stepStartMs + synthesis.durationMs];
 * the step may run longer (an action outlasting the voice) and that tail has
 * no caption, correctly - nothing is being said.
 */
export function cuesForStep(narration: string, stepStartMs: number, synthesis: Synthesis, firstIndex: number): Cue[] {
  const sentences = splitSentences(narration);
  const total = words(narration).length || 1;
  const wb = synthesis.words;
  const cues: Cue[] = [];
  let wordCursor = 0;
  for (let i = 0; i < sentences.length; i++) {
    const n = words(sentences[i]).length;
    let start: number;
    let end: number;
    if (wb.length === total) {
      // Exact: first word's offset to last word's end.
      const first = wb[wordCursor];
      const last = wb[Math.min(wordCursor + n - 1, wb.length - 1)];
      start = first.offsetMs;
      end = last.offsetMs + last.durationMs;
    } else {
      // Proportional by word count.
      start = Math.round((wordCursor / total) * synthesis.durationMs);
      end = Math.round(((wordCursor + n) / total) * synthesis.durationMs);
    }
    // Never zero-length, never overlapping the next cue.
    end = Math.max(end, start + 300);
    cues.push({ index: firstIndex + i, startMs: stepStartMs + start, endMs: stepStartMs + end, text: wrapCue(sentences[i]) });
    wordCursor += n;
  }
  for (let i = 0; i + 1 < cues.length; i++) {
    if (cues[i].endMs > cues[i + 1].startMs) cues[i].endMs = cues[i + 1].startMs;
  }
  return cues;
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, "0");
}

export function fmtSrt(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms % 1000, 3)}`;
}

export function fmtVtt(ms: number): string {
  return fmtSrt(ms).replace(",", ".");
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c) => `${c.index}\n${fmtSrt(c.startMs)} --> ${fmtSrt(c.endMs)}\n${c.text}\n`).join("\n") + (cues.length ? "\n" : "");
}

export function toVtt(cues: Cue[]): string {
  const body = cues.map((c) => `${c.index}\n${fmtVtt(c.startMs)} --> ${fmtVtt(c.endMs)}\n${c.text}\n`).join("\n");
  return "WEBVTT\n\n" + body + (cues.length ? "\n" : "");
}
