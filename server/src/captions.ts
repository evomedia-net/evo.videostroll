// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Captions with timestamps. One cue per sentence; cue times come from the
 * provider's word boundaries when it has them, else proportionally by word
 * count across the narration's duration. Lines wrap at ~42 characters, two
 * lines per cue - the broadcast convention that keeps captions readable.
 *
 * Word boundaries are ALIGNED to the narration, not assumed to match it one
 * for one. A real engine reports "co-founder" as one word or two, drops a
 * standalone dash, and attaches or detaches punctuation as it likes; an exact
 * count check threw all of that away and fell back to proportional timing for
 * the whole step. Alignment keeps the exact times for every sentence it can
 * place and falls back per sentence, not per step.
 */
import type { Synthesis, WordBoundary } from "./tts/index.js";
import { words } from "./tts/index.js";

export interface Cue {
  /** 1-based, in output order. */
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

export const MAX_LINE = 42;
export const MIN_CUE_MS = 300;

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

/** Letters and digits only, lower-cased: "Co-founder," and "co founder" compare equal in pieces. */
export function normalise(w: string): string {
  return w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Find the boundary span for a sentence, starting the search at `from`.
 * Walks the sentence's normalised words and consumes boundaries whose
 * normalised text is a prefix-match of what remains - so one narration word
 * may span several boundaries ("co-founder" -> "co", "founder") or one
 * boundary may cover several narration words. Returns null when it cannot
 * place the sentence, so the caller falls back for that sentence only.
 */
export function alignSentence(sentence: string, wb: WordBoundary[], from: number): { start: number; end: number; next: number } | null {
  const target = words(sentence).map(normalise).filter(Boolean).join("");
  if (!target) return null;
  let i = from;
  // Skip boundaries that are pure punctuation.
  while (i < wb.length && !normalise(wb[i].word)) i++;
  if (i >= wb.length) return null;
  const first = i;
  let acc = "";
  while (i < wb.length && acc.length < target.length) {
    const piece = normalise(wb[i].word);
    if (piece && !target.startsWith(acc + piece)) return null;
    acc += piece;
    i++;
  }
  if (acc !== target) return null;
  const last = wb[i - 1];
  return { start: wb[first].offsetMs, end: last.offsetMs + last.durationMs, next: i };
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
  let wbCursor = 0;
  for (let i = 0; i < sentences.length; i++) {
    const n = words(sentences[i]).length;
    let start: number | undefined;
    let end: number | undefined;
    if (wb.length) {
      const a = alignSentence(sentences[i], wb, wbCursor);
      if (a) {
        start = a.start;
        end = a.end;
        wbCursor = a.next;
      }
    }
    if (start === undefined || end === undefined) {
      // Proportional by word count - per sentence, so one unalignable
      // sentence does not cost the others their exact timing.
      start = Math.round((wordCursor / total) * synthesis.durationMs);
      end = Math.round(((wordCursor + n) / total) * synthesis.durationMs);
    }
    end = Math.max(end, start + MIN_CUE_MS);
    cues.push({ index: firstIndex + i, startMs: stepStartMs + start, endMs: stepStartMs + end, text: wrapCue(sentences[i]) });
    wordCursor += n;
  }
  // Never overlapping, never past the narration.
  for (let i = 0; i + 1 < cues.length; i++) {
    if (cues[i].endMs > cues[i + 1].startMs) cues[i].endMs = cues[i + 1].startMs;
  }
  const limit = stepStartMs + Math.max(synthesis.durationMs, MIN_CUE_MS);
  for (const c of cues) if (c.endMs > limit) c.endMs = limit;
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
