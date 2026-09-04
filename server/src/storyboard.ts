// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The storyboard: the contract between the agent (which writes one) and the
 * server (which renders it). The published form is schema/storyboard.schema.json;
 * this is the same contract as runtime types, and a test asserts the two agree
 * on the example.
 */
import { z } from "zod";

/**
 * Rejected wherever free text is spoken or typed. Not a security control - an
 * operator who wants to type a password into a storyboard can - but it stops
 * the obvious mistake: pasting a real login into an example.
 */
export const SECRET_RE =
  /(password\s*[:=]|passwd|api[_-]?key\s*[:=]|secret\s*[:=]|token\s*[:=]|bearer\s+[a-z0-9._-]{16,}|ghp_[a-z0-9]{20,}|sk-[a-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

const noSecret = (s: string) => !SECRET_RE.test(s);
const SECRET_MSG = "looks like a credential - storyboards never carry secrets";

const isUrl = (s: string) => {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
};

const Selector = z.string().min(1);
const Point = z.strictObject({ x: z.number(), y: z.number() });

export const TargetSchema = z.union([
  z.strictObject({ selector: Selector }),
  z.strictObject({ point: Point }),
]);
export type Target = z.infer<typeof TargetSchema>;

export const ActionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("goto"),
    url: z.string().refine(isUrl, "not a URL"),
    waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
  }),
  z.strictObject({ type: z.literal("move"), target: TargetSchema, durationMs: z.number().int().min(100).optional() }),
  z.strictObject({ type: z.literal("hover"), target: TargetSchema, holdMs: z.number().int().min(0).optional() }),
  z.strictObject({ type: z.literal("click"), target: TargetSchema, settleMs: z.number().int().min(0).optional() }),
  z.strictObject({
    type: z.literal("type"),
    target: TargetSchema,
    text: z.string().refine(noSecret, SECRET_MSG),
    msPerChar: z.number().int().min(0).optional(),
  }),
  z.strictObject({ type: z.literal("press"), key: z.string().min(1) }),
  z.strictObject({
    type: z.literal("scroll"),
    target: TargetSchema.optional(),
    deltaY: z.number().int().optional(),
    durationMs: z.number().int().min(100).optional(),
  }),
  z.strictObject({ type: z.literal("highlight"), target: TargetSchema, holdMs: z.number().int().min(0).optional() }),
  z.strictObject({ type: z.literal("wait"), ms: z.number().int().min(0).max(15000) }),
  z.strictObject({
    type: z.literal("waitFor"),
    target: TargetSchema,
    state: z.enum(["visible", "hidden", "attached"]).optional(),
    timeoutMs: z.number().int().min(0).optional(),
  }),
]);
export type Action = z.infer<typeof ActionSchema>;

export const ViewportSchema = z.strictObject({
  width: z.number().int().min(320).default(1920),
  height: z.number().int().min(240).default(1080),
  deviceScaleFactor: z.number().min(1).max(3).default(1),
});

/**
 * The field shapes, declared once without defaults, so the full voice and the
 * per-step override can each apply their own rule to them.
 */
const voiceFields = {
  provider: z.enum(["edge", "piper", "openai", "elevenlabs", "silent"]),
  name: z.string(),
  rate: z.number().min(0.5).max(2),
  wordsPerMinute: z.number().int().min(60).max(300),
};

export const VoiceSchema = z.strictObject({
  provider: voiceFields.provider.default("edge"),
  name: voiceFields.name.optional(),
  rate: voiceFields.rate.default(1),
  wordsPerMinute: voiceFields.wordsPerMinute.default(150),
});
export type Voice = z.infer<typeof VoiceSchema>;

/**
 * What a step may say about its own voice. Every field optional: a step that
 * names only `name` swaps the speaker and keeps the storyboard's provider and
 * rate, which is the common case - one walkthrough, two narrators.
 *
 * Deliberately NOT `VoiceSchema.partial()`. That keeps the defaults, so parsing
 * `{ name: "en-US-AvaNeural" }` yields a provider of "edge" and a rate of 1 as
 * though the step had asked for them - and the merge below cannot tell an
 * inherited default from a stated choice. A storyboard on Piper would have had
 * every step with a named voice silently dragged back to Edge.
 */
export const VoiceOverrideSchema = z.strictObject({
  provider: voiceFields.provider.optional(),
  name: voiceFields.name.optional(),
  rate: voiceFields.rate.optional(),
  wordsPerMinute: voiceFields.wordsPerMinute.optional(),
});
export type VoiceOverride = z.infer<typeof VoiceOverrideSchema>;

/**
 * Merge a step's voice over the storyboard's.
 *
 * One rule is not plain object-spread: a voice `name` belongs to the provider
 * that defines it, so an override naming a DIFFERENT provider does not inherit
 * the old provider's name. `en-US-GuyNeural` means nothing to Piper, and
 * silently carrying it across would fail deep inside a provider - or worse,
 * be ignored and record the wrong speaker.
 */
export function resolveVoice(base: Voice, override?: VoiceOverride): Voice {
  if (!override) return base;
  const changesProvider = override.provider !== undefined && override.provider !== base.provider;
  const merged: Record<string, unknown> = { ...base };
  if (changesProvider && override.name === undefined) delete merged.name;
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined) merged[key] = value;
  }
  return VoiceSchema.parse(merged);
}

export const StepSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  narration: z.string().min(1).max(400).refine(noSecret, SECRET_MSG),
  actions: z.array(ActionSchema).default([]),
  minDurationMs: z.number().int().min(0).optional(),
  chapter: z.string().optional(),
  /** Speak this step in a different voice. Merged over the storyboard's by resolveVoice. */
  voice: VoiceOverrideSchema.optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const StoryboardSchema = z.strictObject({
  version: z.literal(1),
  title: z.string().min(1).max(200),
  url: z.string().refine(isUrl, "not a URL"),
  goal: z.string().optional(),
  audience: z.string().optional(),
  viewport: ViewportSchema.default({ width: 1920, height: 1080, deviceScaleFactor: 1 }),
  voice: VoiceSchema.default({ provider: "edge", rate: 1, wordsPerMinute: 150 }),
  captions: z.enum(["sidecar", "burn", "both"]).default("sidecar"),
  storageState: z.string().optional(),
  steps: z.array(StepSchema).min(1),
});
export type Storyboard = z.infer<typeof StoryboardSchema>;

/** Parse and validate; throws a ZodError naming the path of the first problem. */
export function parseStoryboard(input: unknown): Storyboard {
  return StoryboardSchema.parse(input);
}

/** Validate a single step, as the interactive `step` tool receives it. */
export function parseStep(input: unknown): Step {
  return StepSchema.parse(input);
}
