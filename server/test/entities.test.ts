/**
 * Entity decoding, tested because the output is spoken aloud.
 *
 * textOf() feeds the glossary, and the glossary is handed to an agent as the
 * vocabulary to narrate with. An entry carrying `&mdash;` is not a cosmetic
 * defect - it is a string the voice will attempt to pronounce and the captions
 * will show. Found on our own docs site: the glossary came back with
 * "MCP server + Claude Code skill quickstart &middot; setup &middot; voices".
 */
import { describe, expect, it } from "vitest";
import { textOf } from "../src/docs.js";

describe("entities in harvested text", () => {
  it("decodes the typography a documentation page is full of", () => {
    expect(textOf("<p>a &middot; b &mdash; c &ndash; d &hellip;</p>")).toBe("a · b — c – d …");
    expect(textOf("<p>&ldquo;quoted&rdquo; and it&rsquo;s fine</p>")).toBe("“quoted” and it’s fine");
  });

  it("still decodes the handful it always did", () => {
    expect(textOf("<p>a &amp; b &lt; c &gt; d &quot;e&quot; f&apos;g</p>")).toBe('a & b < c > d "e" f\'g');
  });

  it("decodes numeric references, decimal and hex", () => {
    expect(textOf("<p>&#8212; &#x2014; &#39;</p>")).toBe("— — '");
  });

  it("handles characters outside the basic plane", () => {
    // String.fromCharCode silently mangles these; fromCodePoint does not.
    expect(textOf("<p>&#128077;</p>")).toBe("\u{1F44D}");
  });

  it("leaves an entity it does not know rather than guessing", () => {
    expect(textOf("<p>&zzz; &notareal;</p>")).toBe("&zzz; &notareal;");
  });

  it("does not decode twice", () => {
    // Text that means the literal string "&mdash;" must survive as that.
    expect(textOf("<p>write &amp;mdash; for an em dash</p>")).toBe("write &mdash; for an em dash");
  });

  it("tells &prime; from &Prime;", () => {
    expect(textOf("<p>&prime; &Prime;</p>")).toBe("′ ″");
  });

  it("refuses a numeric reference that is not a character", () => {
    // A lone surrogate would produce a broken string that reaches the .srt.
    expect(textOf("<p>&#xD800; &#0;</p>")).toBe("&#xD800; &#0;");
  });

  it("clears the case from the report", () => {
    const html = '<h1>evo videostroll</h1><p>quickstart &middot; setup &middot; voices &middot; evomedia.net</p>';
    expect(textOf(html)).not.toMatch(/&[a-z]+;/i);
  });
});
