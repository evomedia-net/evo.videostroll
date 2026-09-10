/**
 * The catalogue and the picker's request boundary.
 *
 * The page is a local one, but /api/preview takes typed input and hands it to a
 * synthesiser, so it is checked rather than trusted. These run offline: the
 * only part that needs the network is the provider's raw list, and that shape
 * is pinned here with a fixture taken from the real response.
 */
import { describe, expect, it } from "vitest";
import {
  filterVoices,
  locales,
  parsePreview,
  PREVIEW_MAX_CHARS,
  SAMPLE_TEXT,
  snippets,
  toCatalogue,
  type CatalogueVoice,
} from "../src/voices.js";

/** Shaped exactly like rows from MsEdgeTTS().getVoices(). */
const RAW = [
  { ShortName: "en-US-AvaNeural", Gender: "Female", Locale: "en-US", LocaleName: "English (United States)", FriendlyName: "Microsoft Ava Online (Natural) - English (United States)", VoiceTag: { VoicePersonalities: ["Expressive", "Caring"] } },
  { ShortName: "en-US-AvaMultilingualNeural", Gender: "Female", Locale: "en-US", LocaleName: "English (United States)", FriendlyName: "Microsoft AvaMultilingual Online (Natural) - English (United States)", VoiceTag: { VoicePersonalities: ["Expressive"] } },
  { ShortName: "en-GB-RyanNeural", Gender: "Male", Locale: "en-GB", LocaleName: "English (United Kingdom)", FriendlyName: "Microsoft Ryan Online (Natural) - English (United Kingdom)", VoiceTag: { VoicePersonalities: ["Friendly", "Positive"] } },
  { ShortName: "fr-FR-DeniseNeural", Gender: "Female", Locale: "fr-FR", LocaleName: "French (France)", FriendlyName: "Microsoft Denise Online (Natural) - French (France)" },
  // The rows a picker must not show: no id, no locale, and a gender it cannot label.
  { Gender: "Female", Locale: "en-US" },
  { ShortName: "xx-Broken", Gender: "Female" },
  { ShortName: "en-US-NeutralNeural", Gender: "Neutral", Locale: "en-US" },
];

describe("toCatalogue", () => {
  const rows = toCatalogue(RAW);

  it("keeps only rows a person could choose from", () => {
    expect(rows.map((v) => v.id)).toEqual([
      "en-GB-RyanNeural",
      "en-US-AvaMultilingualNeural",
      "en-US-AvaNeural",
      "fr-FR-DeniseNeural",
    ]);
  });

  it("pulls the given name out of the service's long friendly name", () => {
    expect(rows.find((v) => v.id === "en-US-AvaNeural")!.given).toBe("Ava");
    // "AvaMultilingual" is the same person, so the name is still Ava.
    expect(rows.find((v) => v.id === "en-US-AvaMultilingualNeural")!.given).toBe("Ava");
  });

  it("falls back to the id when there is no friendly name", () => {
    expect(rows.find((v) => v.id === "fr-FR-DeniseNeural")!.given).toBe("Denise");
  });

  it("flags the multilingual variants, which otherwise double the list", () => {
    expect(rows.filter((v) => v.multilingual).map((v) => v.id)).toEqual(["en-US-AvaMultilingualNeural"]);
  });

  it("survives a response that is not a list at all", () => {
    expect(toCatalogue(null)).toEqual([]);
    expect(toCatalogue({ error: "nope" })).toEqual([]);
  });
});

describe("filterVoices", () => {
  const rows = toCatalogue(RAW);

  it("treats a bare language as every locale of it, and a full locale as one", () => {
    expect(filterVoices(rows, { locale: "en" }).length).toBe(3);
    expect(filterVoices(rows, { locale: "en-GB" }).map((v) => v.id)).toEqual(["en-GB-RyanNeural"]);
  });

  it("filters by gender", () => {
    expect(filterVoices(rows, { gender: "male" }).map((v) => v.id)).toEqual(["en-GB-RyanNeural"]);
  });

  it("searches the id, the name, the locale name and the character", () => {
    expect(filterVoices(rows, { q: "caring" }).map((v) => v.id)).toEqual(["en-US-AvaNeural"]);
    expect(filterVoices(rows, { q: "ryan" }).map((v) => v.id)).toEqual(["en-GB-RyanNeural"]);
    expect(filterVoices(rows, { q: "french" }).map((v) => v.id)).toEqual(["fr-FR-DeniseNeural"]);
  });

  it("can hide the multilingual variants", () => {
    expect(filterVoices(rows, { locale: "en-US", monolingualOnly: true }).map((v) => v.id)).toEqual(["en-US-AvaNeural"]);
  });

  it("combines filters, and 'all' means no filter", () => {
    expect(filterVoices(rows, { locale: "en", gender: "female", monolingualOnly: true }).map((v) => v.id)).toEqual(["en-US-AvaNeural"]);
    expect(filterVoices(rows, { locale: "all", gender: "all" }).length).toBe(rows.length);
  });
});

describe("locales", () => {
  it("counts the voices per locale, for the filter control", () => {
    expect(locales(toCatalogue(RAW))).toEqual([
      { locale: "en-GB", localeName: "English (United Kingdom)", count: 1 },
      { locale: "en-US", localeName: "English (United States)", count: 2 },
      { locale: "fr-FR", localeName: "French (France)", count: 1 },
    ]);
  });
});

describe("parsePreview", () => {
  it("accepts a voice id and defaults the rest", () => {
    const p = parsePreview({ name: "en-US-AvaNeural" });
    expect(p).toEqual({ ok: true, value: { name: "en-US-AvaNeural", rate: 1, text: SAMPLE_TEXT } });
  });

  it("requires a name", () => {
    expect(parsePreview({}).ok).toBe(false);
    expect(parsePreview({ name: "   " }).ok).toBe(false);
  });

  it("refuses anything that is not shaped like a voice id", () => {
    // Not a shell or a path, but a synthesiser argument is still an argument.
    for (const bad of ["../../etc/passwd", "en US Ava", "en-US-Ava;rm -rf /", "en-US-Ava/../x", "a".repeat(65)]) {
      expect(parsePreview({ name: bad }).ok, bad).toBe(false);
    }
  });

  it("holds the rate to the range the storyboard schema allows", () => {
    expect(parsePreview({ name: "en-US-AvaNeural", rate: "1.5" })).toMatchObject({ ok: true, value: { rate: 1.5 } });
    for (const bad of ["0.4", "2.1", "-1", "abc", "Infinity"]) {
      expect(parsePreview({ name: "en-US-AvaNeural", rate: bad }).ok, bad).toBe(false);
    }
  });

  it("caps the text, so nobody renders an audiobook through the preview", () => {
    expect(parsePreview({ name: "en-US-AvaNeural", text: "a".repeat(PREVIEW_MAX_CHARS) }).ok).toBe(true);
    expect(parsePreview({ name: "en-US-AvaNeural", text: "a".repeat(PREVIEW_MAX_CHARS + 1) }).ok).toBe(false);
  });

  it("will not speak a credential, here either", () => {
    // The recorder refuses this at the tool boundary; the preview is not an
    // exception carved out for convenience.
    const p = parsePreview({ name: "en-US-AvaNeural", text: "the password: hunter2" });
    expect(p.ok).toBe(false);
    if (p.ok) throw new Error("unreachable");
    expect(p.error).toMatch(/credential/i);
  });
});

describe("snippets", () => {
  it("omits the rate when it is the default, so the copied line stays minimal", () => {
    expect(snippets({ name: "en-US-AvaNeural", rate: 1 })).toEqual({
      storyboard: '"voice": { "provider": "edge", "name": "en-US-AvaNeural" }',
      step: '{ "narration": "…", "voice": { "name": "en-US-AvaNeural" } }',
    });
  });

  it("includes the rate when it is not", () => {
    const s = snippets({ name: "en-GB-RyanNeural", rate: 1.15 });
    expect(s.storyboard).toContain('"rate": 1.15');
    expect(s.step).toContain('"rate": 1.15');
  });

  it("emits JSON the storyboard parser accepts", () => {
    const s = snippets({ name: "en-US-AvaNeural", rate: 1.2 });
    expect(() => JSON.parse(`{ ${s.storyboard} }`)).not.toThrow();
    expect(() => JSON.parse(s.step.replace("…", "x"))).not.toThrow();
  });
});

describe("the catalogue rows the page renders", () => {
  it("carries everything a column needs and nothing secret", () => {
    const v: CatalogueVoice = toCatalogue(RAW)[0];
    expect(Object.keys(v).sort()).toEqual(["gender", "given", "id", "locale", "localeName", "multilingual", "tags"]);
  });
});
