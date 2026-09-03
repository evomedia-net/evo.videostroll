// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Per-step recording over Chromium's DevTools screencast. Frames arrive as
 * the page repaints, each with its own timestamp - so timestamps are exact
 * and recording naturally pauses between steps (the agent's thinking time
 * never reaches the video).
 *
 * Two bookend screenshots guarantee every step has a frame at its start and
 * at its end even when nothing repainted - a page that sits still while the
 * narration finishes produces no screencast frames at all, and a step with no
 * frames would vanish from the video.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CDPSession, Page } from "playwright";

export interface Frame {
  file: string;
  /** Wall-clock milliseconds (epoch). */
  tsMs: number;
}

export interface StepCapture {
  frames: Frame[];
  startMs: number;
  endMs: number;
}

interface ScreencastFrame {
  data: string;
  metadata: { timestamp?: number };
  sessionId: number;
}

export class StepRecorder {
  private frames: Frame[] = [];
  private pending: Promise<void>[] = [];
  private seq = 0;
  private startMs = 0;
  private handler?: (ev: ScreencastFrame) => void;

  constructor(
    private readonly page: Page,
    private readonly cdp: CDPSession,
    private readonly dir: string,
    private readonly maxWidth: number,
    private readonly maxHeight: number,
    private readonly quality = 80,
  ) {}

  private async save(data: Buffer, tsMs: number): Promise<void> {
    const file = join(this.dir, `f${String(this.seq++).padStart(5, "0")}.jpg`);
    this.frames.push({ file, tsMs });
    await writeFile(file, data);
  }

  private async bookend(): Promise<void> {
    const ts = Date.now();
    const png = await this.page.screenshot({ type: "jpeg", quality: this.quality });
    await this.save(png, ts);
  }

  async start(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    this.startMs = Date.now();
    await this.bookend();
    this.handler = (ev: ScreencastFrame) => {
      // CDP timestamps are epoch seconds; fall back to now if a build omits them.
      const tsMs = ev.metadata.timestamp ? Math.round(ev.metadata.timestamp * 1000) : Date.now();
      const p = this.save(Buffer.from(ev.data, "base64"), tsMs)
        .catch(() => undefined)
        .then(() => this.cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).then(() => undefined, () => undefined));
      this.pending.push(p);
    };
    this.cdp.on("Page.screencastFrame", this.handler);
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: this.quality,
      maxWidth: this.maxWidth,
      maxHeight: this.maxHeight,
      everyNthFrame: 1,
    });
  }

  async stop(): Promise<StepCapture> {
    await this.cdp.send("Page.stopScreencast").catch(() => undefined);
    if (this.handler) this.cdp.off("Page.screencastFrame", this.handler);
    await Promise.all(this.pending);
    await this.bookend();
    const endMs = Date.now();
    // Sorted, clamped to the step window, de-duplicated on identical timestamps.
    const frames = this.frames
      .filter((f) => f.tsMs >= this.startMs - 5 && f.tsMs <= endMs + 5)
      .sort((a, b) => a.tsMs - b.tsMs)
      .map((f) => ({ file: f.file, tsMs: Math.min(Math.max(f.tsMs, this.startMs), endMs) }));
    return { frames, startMs: this.startMs, endMs };
  }
}
