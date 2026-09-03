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

export const StepSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  narration: z.string().min(1).max(400).refine(noSecret, SECRET_MSG),
  actions: z.array(ActionSchema).default([]),
  minDurationMs: z.number().int().min(0).optional(),
  chapter: z.string().optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const ViewportSchema = z.strictObject({
  width: z.number().int().min(320).default(1920),
  height: z.number().int().min(240).default(1080),
  deviceScaleFactor: z.number().min(1).max(3).default(1),
});

export const VoiceSchema = z.strictObject({
  provider: z.enum(["edge", "piper", "openai", "elevenlabs", "silent"]).default("edge"),
  name: z.string().optional(),
  rate: z.number().min(0.5).max(2).default(1),
  wordsPerMinute: z.number().int().min(60).max(300).default(150),
});
export type Voice = z.infer<typeof VoiceSchema>;

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
