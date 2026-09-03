// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Turns captured frames and the audio timeline into the deliverables, with
 * ffmpeg from ffmpeg-static so nothing needs installing by hand.
 *
 * Per step: frames -> a constant-30fps MP4 segment, each frame held for the
 * gap to the next one (the concat demuxer's per-entry duration), so a still
 * page is one long frame and a cursor glide is many short ones. Then segments
 * concatenate stream-copy (identical encoder settings), the WAV timeline muxes
 * in as AAC, and step boundaries become MP4 chapters.
 */
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import type { Frame } from "./recorder.js";

export const FPS = 30;

export function ffmpegBinary(): string {
  if (!ffmpegPath) throw new Error("ffmpeg-static has no binary for this platform");
  return ffmpegPath;
}

export async function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBinary(), ["-hide_banner", "-loglevel", "error", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out + err) : reject(new Error(`ffmpeg exited ${code}: ${err.trim().slice(-800)}`))));
  });
}

/** ffconcat needs forward slashes and escaped quotes even on Windows. */
function concatPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/'/g, "'\\''");
}

export interface SegmentInput {
  frames: Frame[];
  startMs: number;
  endMs: number;
}

/**
 * Encode one step. Returns the segment's duration in ms, which is exactly
 * endMs - startMs: the last frame is held to the end of the step.
 */
export async function encodeSegment(seg: SegmentInput, workDir: string, outMp4: string): Promise<number> {
  if (seg.frames.length === 0) throw new Error("segment has no frames");
  const durationMs = Math.max(1, seg.endMs - seg.startMs);
  const minHold = 1 / FPS;
  const lines = ["ffconcat version 1.0"];
  for (let i = 0; i < seg.frames.length; i++) {
    const f = seg.frames[i];
    const next = i + 1 < seg.frames.length ? seg.frames[i + 1].tsMs : seg.endMs;
    const hold = Math.max(minHold, (next - f.tsMs) / 1000);
    lines.push(`file '${concatPath(f.file)}'`, `duration ${hold.toFixed(4)}`);
  }
  // The concat demuxer drops the final entry's duration unless the file is
  // listed once more after it - a documented quirk, not a bug here.
  lines.push(`file '${concatPath(seg.frames[seg.frames.length - 1].file)}'`);
  const list = join(workDir, "frames.ffconcat");
  await writeFile(list, lines.join("\n") + "\n", "utf8");
  await runFfmpeg([
    "-y",
    "-f", "concat", "-safe", "0", "-i", list,
    "-t", (durationMs / 1000).toFixed(3),
    "-vf", `fps=${FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-an",
    outMp4,
  ]);
  return durationMs;
}

export async function concatSegments(segments: string[], workDir: string, outMp4: string): Promise<void> {
  const list = join(workDir, "segments.ffconcat");
  await writeFile(list, ["ffconcat version 1.0", ...segments.map((s) => `file '${concatPath(s)}'`)].join("\n") + "\n", "utf8");
  await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", outMp4]);
}

export interface Chapter {
  title: string;
  startMs: number;
  endMs: number;
}

export async function writeChapters(chapters: Chapter[], file: string): Promise<void> {
  const esc = (s: string) => s.replace(/([=;#\\\n])/g, "\\$1");
  const body = chapters.map((c) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${c.startMs}\nEND=${c.endMs}\ntitle=${esc(c.title)}\n`).join("\n");
  await writeFile(file, `;FFMETADATA1\n\n${body}`, "utf8");
}

export interface MuxOptions {
  video: string;
  audioWav: string;
  out: string;
  chaptersFile?: string;
  /** Burn a subtitle file into the frames (re-encodes video). */
  burnSubtitles?: string;
  title?: string;
}

export async function mux(o: MuxOptions): Promise<void> {
  const args = ["-y", "-i", o.video, "-i", o.audioWav];
  if (o.chaptersFile) args.push("-i", o.chaptersFile, "-map_metadata", "2");
  args.push("-map", "0:v:0", "-map", "1:a:0");
  if (o.burnSubtitles) {
    // ffmpeg's subtitles filter takes its own escaping of ':' and '\'.
    const sub = o.burnSubtitles.replace(/\\/g, "/").replace(/:/g, "\\:");
    args.push("-vf", `subtitles='${sub}'`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23");
  } else {
    args.push("-c:v", "copy");
  }
  args.push("-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart");
  if (o.title) args.push("-metadata", `title=${o.title}`);
  args.push(o.out);
  await runFfmpeg(args);
}

/** Duration by parsing ffmpeg's own probe line; ffmpeg-static ships no ffprobe. */
export async function probeDurationMs(file: string): Promise<number> {
  const text = await new Promise<string>((resolve) => {
    const child = spawn(ffmpegBinary(), ["-hide_banner", "-i", file, "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("close", () => resolve(err));
    child.on("error", () => resolve(err));
  });
  const m = /Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/.exec(text);
  if (!m) throw new Error(`could not read duration of ${file}`);
  const [, h, mi, s, frac] = m;
  return ((+h * 60 + +mi) * 60 + +s) * 1000 + Math.round(+`0.${frac}` * 1000);
}
