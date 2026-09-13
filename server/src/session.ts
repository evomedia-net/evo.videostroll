// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The engine. A session owns one browser page and produces one walkthrough:
 *
 *   start  -> launch, inject the cursor, open the URL
 *   step   -> synthesise the narration FIRST (so its duration is known),
 *             record while the actions run, hold until the voice would have
 *             finished, stop recording, remember the timings
 *   finish -> encode every step, build the audio timeline, mux, write
 *             captions and the manifest, close the browser
 *
 * Interactive callers drive step by step; render() drives a whole storyboard.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";
import { executeAction } from "./actions.js";
import { concatSegments, encodeSegment, mux, probeDurationMs, writeChapters, type Chapter } from "./assemble.js";
import { cuesForStep, toSrt, toVtt, type Cue } from "./captions.js";
import { CURSOR_INIT_SCRIPT, Cursor } from "./cursor.js";
import { StepRecorder, type StepCapture } from "./recorder.js";
import { OutputName, parseStep, parseStoryboard, resolveVoice, StoryboardSchema, ViewportSchema, VoiceSchema, type Step, type Storyboard, type Voice } from "./storyboard.js";
import { getProvider, type Synthesis, type TtsProvider } from "./tts/index.js";
import { concatWav, padWav } from "./wav.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Breathing room after the voice or the last action, so a step never ends on the frame the action landed. */
export const STEP_TAIL_MS = 300;

export interface StartOptions {
  /** Base name for the output files. Defaults to "walkthrough". */
  name?: string;
  url: string;
  title?: string;
  viewport?: Partial<{ width: number; height: number; deviceScaleFactor: number }>;
  voice?: Partial<Voice>;
  captions?: "sidecar" | "burn" | "both";
  storageState?: string;
  outputDir?: string;
  headless?: boolean;
}

export interface PageState {
  url: string;
  title: string;
  /** Accessibility-tree summary: roles, names, structure. Enough to choose selectors. */
  snapshot: string;
}

export interface StepRecord {
  index: number;
  id: string;
  narration: string;
  actions: Step["actions"];
  chapter?: string;
  /** Output-timeline milliseconds. */
  startMs: number;
  endMs: number;
  narrationMs: number;
  /** The voice this step was actually spoken in, after any per-step override. */
  voice: Voice;
  url: string;
  title: string;
  thumbnail: string;
  frameCount: number;
}

export interface StepResult {
  step: StepRecord;
  page: PageState;
}

export interface FinishOptions {
  title?: string;
  captions?: "sidecar" | "burn" | "both";
}

export interface FinishResult {
  outputDir: string;
  mp4: string;
  srt: string;
  vtt: string;
  manifest: string;
  storyboard: string;
  durationMs: number;
  steps: number;
}

interface Recorded {
  step: StepRecord;
  capture: StepCapture;
  synthesis: Synthesis;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "walkthrough";
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

/**
 * A thumbnail's file name: the walkthrough's base name, the step's position,
 * and the step's id.
 *
 * The base name is in there for the same reason it is on every other output -
 * `name` exists so a second walkthrough can share an output folder without
 * overwriting the first, and thumbnails were the one artefact that ignored it.
 * Two differently-named walkthroughs in one folder used to fight over
 * `01-intro.jpg`.
 */
export function thumbName(base: string, index: number, id: string): string {
  return `${base}-${String(index + 1).padStart(2, "0")}-${id}.jpg`;
}

const THUMB_TAIL_RE = /^\d{2,}-.+\.jpg$/i;

/** Is this file a thumbnail from an earlier render of THIS walkthrough? */
export function isStaleThumb(name: string, base: string): boolean {
  const prefix = `${base}-`;
  return name.startsWith(prefix) && THUMB_TAIL_RE.test(name.slice(prefix.length));
}

/**
 * Drop the previous render's thumbnails before writing this one's.
 *
 * Thumbnails are numbered by step, so inserting a step shifts every name after
 * it and the old ones survive under their old numbers - a re-cut of an
 * eleven-step walkthrough into twelve left eighteen files, two of them the same
 * step from different runs and one a frame of a video that no longer existed.
 * Nothing distinguished them but the file timestamp.
 *
 * That matters because `thumbs/` is not scratch: the skill tells the agent to
 * open thumbnails to verify what it recorded, and a stale one looks exactly as
 * authoritative as a real one. Re-rendering is the path the storyboard exists
 * for, so this is the normal case, not an edge case.
 *
 * Only this walkthrough's own thumbnails go - a folder shared with another
 * `name`, or anything a person put there, is left alone.
 */
async function clearThumbs(outputDir: string, base: string): Promise<void> {
  const dir = join(outputDir, "thumbs");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return; // no folder yet, which is the usual case
  }
  await Promise.all(
    names.filter((n) => isStaleThumb(n, base)).map((n) => rm(join(dir, n), { force: true })),
  );
}

export class Session {
  readonly id: string;
  readonly outputDir: string;
  /** Base name for the output files; every artefact below is named from it. */
  private outputName = "walkthrough";
  private readonly workDir: string;
  private readonly records: Recorded[] = [];
  private cumulativeMs = 0;
  private finished = false;
  /** Providers for voices a step named that are not the storyboard's, keyed by provider. */
  private readonly extraProviders = new Map<Voice["provider"], TtsProvider>();

  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly cdp: CDPSession,
    private readonly cursor: Cursor,
    private readonly provider: TtsProvider,
    readonly voice: Voice,
    readonly viewport: { width: number; height: number; deviceScaleFactor: number },
    readonly title: string,
    readonly startUrl: string,
    readonly captions: "sidecar" | "burn" | "both",
    outputDir: string,
  ) {
    this.id = createHash("sha1").update(`${title}${startUrl}${Date.now()}`).digest("hex").slice(0, 12);
    this.outputDir = outputDir;
    this.workDir = join(outputDir, ".work");
  }

  static async start(o: StartOptions): Promise<Session> {
    const viewport = ViewportSchema.parse(o.viewport ?? {});
    const voice = VoiceSchema.parse({ provider: "silent", ...(o.voice ?? {}) });
    const provider = getProvider(voice);
    const title = o.title ?? new URL(o.url).host;
    const outputDir = resolve(o.outputDir ?? join("output", `${slug(title)}-${stamp()}`));
    await mkdir(join(outputDir, ".work"), { recursive: true });

    const browser = await chromium.launch({ headless: o.headless ?? true });
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
      storageState: o.storageState,
    });
    await context.addInitScript(CURSOR_INIT_SCRIPT);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await page.goto(o.url, { waitUntil: "load" });
    // Park the cursor mid-screen so the overlay is on screen from frame one.
    const cursor = new Cursor(page, viewport.width / 2, viewport.height / 2);
    await page.mouse.move(viewport.width / 2, viewport.height / 2);

    const session = new Session(browser, context, page, cdp, cursor, provider, voice, viewport, title, o.url, o.captions ?? "sidecar", outputDir);
    // Through the schema so a name with a slash in it is refused here, at
    // the boundary, rather than writing outside the output directory.
    if (o.name !== undefined) session.outputName = OutputName.parse(o.name);
    await clearThumbs(outputDir, session.outputName);
    return session;
  }

  /**
   * The provider for a resolved voice. The session's own provider is reused for
   * the storyboard's voice - the common path, and the one the constructor
   * already built - and any other provider a step names is made once and kept.
   * Providers are stateless per call, so one instance serves every step.
   */
  private providerFor(voice: Voice): TtsProvider {
    if (voice.provider === this.voice.provider) return this.provider;
    let provider = this.extraProviders.get(voice.provider);
    if (!provider) {
      provider = getProvider(voice);
      this.extraProviders.set(voice.provider, provider);
    }
    return provider;
  }

  async observe(): Promise<PageState> {
    let snapshot = "";
    try {
      snapshot = await this.page.locator("body").ariaSnapshot();
    } catch {
      snapshot = "(no accessibility snapshot available)";
    }
    return { url: this.page.url(), title: await this.page.title(), snapshot };
  }

  async step(input: unknown): Promise<StepResult> {
    if (this.finished) throw new Error("session already finished");
    const step = parseStep(input);
    const index = this.records.length;
    const id = step.id ?? `step-${String(index + 1).padStart(2, "0")}`;

    // 1. Narration first, so the pacing is known before anything moves. A step
    // may name its own voice; anything it does not name it inherits.
    const voice = resolveVoice(this.voice, step.voice);
    const synthesis = await this.providerFor(voice).synthesise(step.narration, voice);

    // 2. Record while the actions run.
    const frameDir = join(this.workDir, `frames-${String(index).padStart(3, "0")}`);
    const recorder = new StepRecorder(this.page, this.cdp, frameDir, this.viewport.width, this.viewport.height);
    await recorder.start();
    const t0 = Date.now();
    let highlighted = false;
    try {
      for (const action of step.actions) {
        const r = await executeAction(this.page, this.cursor, action);
        highlighted = highlighted || r.highlighted;
      }
      // 3. Hold until the voice would have finished, and at least minDurationMs.
      const elapsed = Date.now() - t0;
      const want = Math.max(synthesis.durationMs, step.minDurationMs ?? 0);
      if (elapsed < want) await sleep(want - elapsed);
      await sleep(STEP_TAIL_MS);
    } finally {
      if (highlighted) await this.cursor.clearHighlight();
    }
    const capture = await recorder.stop();

    // 4. Place it on the output timeline.
    const durationMs = capture.endMs - capture.startMs;
    const thumbDir = join(this.outputDir, "thumbs");
    await mkdir(thumbDir, { recursive: true });
    const thumbnail = join(thumbDir, thumbName(this.outputName, index, id));
    await copyFile(capture.frames[capture.frames.length - 1].file, thumbnail);

    const record: StepRecord = {
      index,
      id,
      narration: step.narration,
      actions: step.actions,
      chapter: step.chapter,
      startMs: this.cumulativeMs,
      endMs: this.cumulativeMs + durationMs,
      narrationMs: synthesis.durationMs,
      voice,
      url: this.page.url(),
      title: await this.page.title(),
      thumbnail,
      frameCount: capture.frames.length,
    };
    this.cumulativeMs += durationMs;
    this.records.push({ step: record, capture, synthesis });
    return { step: record, page: await this.observe() };
  }

  async finish(o: FinishOptions = {}): Promise<FinishResult> {
    if (this.finished) throw new Error("session already finished");
    if (this.records.length === 0) throw new Error("nothing recorded - call step at least once");
    this.finished = true;
    const title = o.title ?? this.title;
    const captions = o.captions ?? this.captions;

    // Video: per-step segments, then one stream-copy concat.
    const segments: string[] = [];
    for (const r of this.records) {
      const seg = join(this.workDir, `seg-${String(r.step.index).padStart(3, "0")}.mp4`);
      await encodeSegment(r.capture, this.workDir, seg);
      segments.push(seg);
    }
    const video = join(this.workDir, "video.mp4");
    await concatSegments(segments, this.workDir, video);

    // Audio: each clip padded to its step's length, then joined - the timeline
    // is the same arithmetic as the video's, so they cannot drift apart.
    const audio = join(this.workDir, "audio.wav");
    await writeFile(audio, concatWav(this.records.map((r) => padWav(r.synthesis.audio, r.step.endMs - r.step.startMs))));

    // Captions.
    const cues: Cue[] = [];
    for (const r of this.records) cues.push(...cuesForStep(r.step.narration, r.step.startMs, r.synthesis, cues.length + 1));
    const base = this.outputName;
    const srt = join(this.outputDir, `${base}.srt`);
    const vtt = join(this.outputDir, `${base}.vtt`);
    await writeFile(srt, toSrt(cues), "utf8");
    await writeFile(vtt, toVtt(cues), "utf8");

    // Chapters: every step that declares one; the first step always opens one.
    const chapters: Chapter[] = [];
    for (const r of this.records) {
      const t = r.step.chapter ?? (r.step.index === 0 ? title : undefined);
      if (t) chapters.push({ title: t, startMs: r.step.startMs, endMs: r.step.endMs });
    }
    for (let i = 0; i + 1 < chapters.length; i++) chapters[i].endMs = chapters[i + 1].startMs;
    if (chapters.length) chapters[chapters.length - 1].endMs = this.cumulativeMs;
    const chaptersFile = join(this.workDir, "chapters.txt");
    await writeChapters(chapters, chaptersFile);

    // Mux. "burn" re-encodes with the captions in the frames; "both" writes a second file.
    const mp4 = join(this.outputDir, `${base}.mp4`);
    await mux({ video, audioWav: audio, out: mp4, chaptersFile, title, burnSubtitles: captions === "burn" ? srt : undefined });
    if (captions === "both") {
      await mux({ video, audioWav: audio, out: join(this.outputDir, `${base}.captioned.mp4`), chaptersFile, title, burnSubtitles: srt });
    }
    const durationMs = await probeDurationMs(mp4);

    // The storyboard this run amounts to, so it can be re-rendered in batch.
    const storyboard: Storyboard = StoryboardSchema.parse({
      version: 1,
      title,
      name: base,
      url: this.startUrl,
      viewport: this.viewport,
      voice: this.voice,
      captions,
      steps: this.records.map((r) => ({ id: r.step.id, narration: r.step.narration, actions: r.step.actions, chapter: r.step.chapter })),
    });
    const storyboardFile = join(this.outputDir, `${base}.storyboard.json`);
    await writeFile(storyboardFile, JSON.stringify(storyboard, null, 2) + "\n", "utf8");

    const manifestFile = join(this.outputDir, `${base}.json`);
    const manifest = {
      generated: new Date().toISOString(),
      title,
      url: this.startUrl,
      viewport: this.viewport,
      voice: this.voice,
      captions,
      durationMs,
      storyboardSha1: createHash("sha1").update(JSON.stringify(storyboard)).digest("hex"),
      files: { mp4, srt, vtt, storyboard: storyboardFile },
      chapters,
      steps: this.records.map((r) => r.step),
      cues,
    };
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n", "utf8");

    await this.close();
    await rm(this.workDir, { recursive: true, force: true });
    return { outputDir: this.outputDir, mp4, srt, vtt, manifest: manifestFile, storyboard: storyboardFile, durationMs, steps: this.records.length };
  }

  async abort(): Promise<void> {
    this.finished = true;
    await this.close();
    await rm(this.workDir, { recursive: true, force: true }).catch(() => undefined);
  }

  private async close(): Promise<void> {
    await this.context.close().catch(() => undefined);
    await this.browser.close().catch(() => undefined);
  }
}

/** Batch: render a whole storyboard. The storyboard is the artefact; the video is its rendering. */
export async function render(input: unknown, o: { outputDir?: string; headless?: boolean } = {}): Promise<FinishResult> {
  const sb = parseStoryboard(input);
  const session = await Session.start({
    url: sb.url,
    title: sb.title,
    viewport: sb.viewport,
    voice: sb.voice,
    captions: sb.captions,
    name: sb.name,
    storageState: sb.storageState,
    outputDir: o.outputDir,
    headless: o.headless,
  });
  try {
    for (const step of sb.steps) await session.step(step);
    return await session.finish();
  } catch (e) {
    await session.abort();
    throw e;
  }
}
