// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The voice catalogue, and the rules the picker's endpoints obey.
 *
 * `npm run voices` prints the catalogue; the picker page shows it and plays it.
 * Both want the same three things: a tidy row per voice, a filter, and a
 * validated preview request. None of that needs a browser or a network call, so
 * it lives here and is tested offline - the provider's raw JSON is the only
 * part that has to come over the wire.
 */
import { SECRET_RE } from "./storyboard.js";

/** One voice, as the picker wants it - not as the service happens to send it. */
export interface CatalogueVoice {
  /** The id you put in `voice.name`, e.g. en-US-AvaNeural. */
  id: string;
  gender: "Male" | "Female";
  locale: string;
  localeName: string;
  /** Just the given name: "Ava" out of "Microsoft Ava Online (Natural) - English (United States)". */
  given: string;
  /** The character the service assigns, e.g. ["Friendly", "Positive"]. Often empty. */
  tags: string[];
  /** A multilingual variant. Same voice, many languages, and a longer id. */
  multilingual: boolean;
}

interface RawVoice {
  ShortName?: string;
  Gender?: string;
  Locale?: string;
  LocaleName?: string;
  FriendlyName?: string;
  VoiceTag?: { VoicePersonalities?: string[] };
}

/**
 * Normalise the service's list. Anything without an id, a locale or a
 * recognised gender is dropped rather than shown as a blank row - the picker
 * exists to be chosen from, and a row you cannot reason about is noise.
 */
export function toCatalogue(raw: unknown): CatalogueVoice[] {
  if (!Array.isArray(raw)) return [];
  const out: CatalogueVoice[] = [];
  for (const item of raw as RawVoice[]) {
    const id = item?.ShortName;
    const gender = item?.Gender;
    const locale = item?.Locale;
    if (!id || !locale || (gender !== "Male" && gender !== "Female")) continue;
    out.push({
      id,
      gender,
      locale,
      localeName: item.LocaleName ?? locale,
      given: /Microsoft\s+(\S+?)(?:Multilingual)?\s+Online/.exec(item.FriendlyName ?? "")?.[1] ?? id.split("-").pop()!.replace(/Neural$/, ""),
      tags: item.VoiceTag?.VoicePersonalities ?? [],
      multilingual: /Multilingual/i.test(id),
    });
  }
  return out.sort((a, b) => a.locale.localeCompare(b.locale) || a.gender.localeCompare(b.gender) || a.id.localeCompare(b.id));
}

export interface VoiceFilter {
  /** "en" matches every English locale; "en-GB" matches only that one. */
  locale?: string;
  gender?: string;
  /** Free text over the id, given name and character tags. */
  q?: string;
  /** Hide the multilingual variants, which otherwise double the list. */
  monolingualOnly?: boolean;
}

export function filterVoices(rows: CatalogueVoice[], f: VoiceFilter = {}): CatalogueVoice[] {
  const locale = f.locale?.trim().toLowerCase();
  const gender = f.gender?.trim().toLowerCase();
  const q = f.q?.trim().toLowerCase();
  return rows.filter((v) => {
    if (locale && locale !== "all") {
      const want = locale;
      const have = v.locale.toLowerCase();
      if (want.includes("-") ? have !== want : have.split("-")[0] !== want) return false;
    }
    if (gender && gender !== "all" && v.gender.toLowerCase() !== gender) return false;
    if (f.monolingualOnly && v.multilingual) return false;
    if (q) {
      const hay = `${v.id} ${v.given} ${v.localeName} ${v.tags.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** The locales present, for the filter control. */
export function locales(rows: CatalogueVoice[]): Array<{ locale: string; localeName: string; count: number }> {
  const by = new Map<string, { locale: string; localeName: string; count: number }>();
  for (const v of rows) {
    const e = by.get(v.locale) ?? { locale: v.locale, localeName: v.localeName, count: 0 };
    e.count++;
    by.set(v.locale, e);
  }
  return [...by.values()].sort((a, b) => a.localeName.localeCompare(b.localeName));
}

export const SAMPLE_TEXT = "This is the projects page. Each card is one product.";
/** Long enough for a sentence or two; short enough that nobody uses this to render audiobooks. */
export const PREVIEW_MAX_CHARS = 240;
/** A provider voice id. Letters, digits and hyphens - no paths, no spaces, no surprises. */
const VOICE_ID = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)+$/;

export interface PreviewRequest {
  name: string;
  rate: number;
  text: string;
}

export type PreviewParse =
  | { ok: true; value: PreviewRequest }
  | { ok: false; error: string };

/**
 * Validate a preview request from a query string.
 *
 * The picker is a local page, but this is still the boundary between typed
 * input and a synthesiser, so it is checked rather than trusted: the voice id
 * has to look like one, the rate has to be in the range the schema allows, and
 * the text is capped. The credential guard applies here too - not because a
 * preview is recorded, but because "never speak a secret" should not have an
 * exception carved into it for convenience.
 */
export function parsePreview(params: Record<string, string | undefined | null>): PreviewParse {
  const name = (params.name ?? "").trim();
  if (!name) return { ok: false, error: "name is required" };
  if (name.length > 64 || !VOICE_ID.test(name)) return { ok: false, error: `not a voice id: ${name.slice(0, 64)}` };

  const rawRate = (params.rate ?? "").trim();
  let rate = 1;
  if (rawRate) {
    rate = Number(rawRate);
    if (!Number.isFinite(rate)) return { ok: false, error: `rate is not a number: ${rawRate.slice(0, 16)}` };
    if (rate < 0.5 || rate > 2) return { ok: false, error: "rate must be between 0.5 and 2" };
  }

  const text = ((params.text ?? "").trim() || SAMPLE_TEXT);
  if (text.length > PREVIEW_MAX_CHARS) return { ok: false, error: `text is longer than ${PREVIEW_MAX_CHARS} characters` };
  if (SECRET_RE.test(text)) return { ok: false, error: "that looks like a credential - the recorder never speaks one, and neither does the preview" };

  return { ok: true, value: { name, rate, text } };
}

/** The storyboard snippets the picker offers to copy, so nobody hand-writes the shape. */
export function snippets(voice: { name: string; rate: number }): { storyboard: string; step: string } {
  const rate = voice.rate === 1 ? "" : `, "rate": ${voice.rate}`;
  return {
    storyboard: `"voice": { "provider": "edge", "name": "${voice.name}"${rate} }`,
    step: `{ "narration": "…", "voice": { "name": "${voice.name}"${rate} } }`,
  };
}
