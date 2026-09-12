/**
 * The setup page copies rules that live in the schema.
 *
 * It has to: it validates in the browser, with no server to ask, so the file
 * name pattern and the viewport minimums are written out a second time. A
 * second copy of a rule is a rule that will drift, and the failure is quiet
 * and nasty - the form says a value is fine, the person copies it out, and the
 * run fails on something they were told was acceptable.
 *
 * So these read the page's own source and compare it against the schema.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OUTPUT_NAME_RE, ViewportSchema } from "../src/storyboard.js";

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const page = async () => readFile(join(REPO, "docs", "setup.html"), "utf8");

/**
 * Every page carries the same menu.
 *
 * They were three pages that only sometimes linked to each other - the voices
 * picker knew about the quickstart, the quickstart knew about nothing, and
 * setup was reachable only if you read far enough down. A fourth page will be
 * added one day by someone who forgets, so this asks the directory rather than
 * a list.
 */
describe("every docs page has the same menu", () => {
  const PAGES = ["quickstart", "setup", "voices"];
  const ENTRIES = ["quickstart", "setup", "voices", "evomedia.net"];

  it("there are no docs pages this test does not know about", async () => {
    const { readdir } = await import("node:fs/promises");
    const found = (await readdir(join(REPO, "docs")))
      .filter((f) => f.endsWith(".html"))
      .map((f) => f.replace(/\.html$/, ""))
      .sort();
    expect(found).toEqual([...PAGES].sort());
  });

  it.each(PAGES)("%s.html carries the menu, with itself marked", async (name) => {
    const html = await readFile(join(REPO, "docs", `${name}.html`), "utf8");
    const nav = /<nav class="pages"[\s\S]*?<\/nav>/.exec(html);
    expect(nav, `${name}.html has no nav.pages`).not.toBeNull();

    for (const entry of ENTRIES) {
      expect(nav![0], `${name}.html is missing "${entry}"`).toContain(`>${entry}<`);
    }
    // The page you are on is shown but not a link to itself.
    expect(nav![0]).toContain(`<span aria-current="page">${name}</span>`);
    expect(nav![0]).not.toContain(`href="/${name}.html"`);
  });
});

describe("the setup page agrees with the schema", () => {
  it("uses the same file-name pattern the server enforces", async () => {
    const html = await page();
    const m = /var NAME_RE = (\/.+?\/);/.exec(html);
    expect(m, "NAME_RE not found in setup.html").not.toBeNull();
    expect(m![1]).toBe(OUTPUT_NAME_RE.toString());
  });

  it("uses the same viewport minimums", async () => {
    const html = await page();
    // The schema's own floors, read from the schema rather than retyped here.
    const floors = ViewportSchema.parse({ width: 320, height: 240 });
    expect(html).toContain(`min="${floors.width}"`);
    expect(html).toContain(`min="${floors.height}"`);
    // And the page must not offer a size the schema would reject.
    for (const m of html.matchAll(/<option value="(\d+)x(\d+)"/g)) {
      const got = ViewportSchema.safeParse({ width: +m[1], height: +m[2] });
      expect(got.success, `${m[1]}x${m[2]} is offered but invalid`).toBe(true);
    }
  });

  it("offers only voice providers that exist", async () => {
    const html = await page();
    const block = /<select id="provider">([\s\S]*?)<\/select>/.exec(html)![1];
    const offered = [...block.matchAll(/value="([a-z]+)"/g)].map((m) => m[1]);
    expect(offered.sort()).toEqual(["edge", "piper", "silent"]);
  });

  it("offers only caption modes that exist", async () => {
    const html = await page();
    const block = /<select id="captions">([\s\S]*?)<\/select>/.exec(html)![1];
    const offered = [...block.matchAll(/value="([a-z]+)"/g)].map((m) => m[1]);
    expect(offered.sort()).toEqual(["both", "burn", "sidecar"]);
  });

  it("keeps deviceScaleFactor inside the range the schema allows", async () => {
    const html = await page();
    const block = /<select id="dsf">([\s\S]*?)<\/select>/.exec(html)![1];
    for (const m of block.matchAll(/value="([\d.]+)"/g)) {
      const got = ViewportSchema.safeParse({ deviceScaleFactor: +m[1] });
      expect(got.success, `scale ${m[1]} is offered but invalid`).toBe(true);
    }
  });

  it("never puts the documentation choice in the settings file", async () => {
    // Rendering a storyboard does not read documentation, so a `docs` key in
    // the JSON would be rejected by the strict schema - a page that emitted
    // one would be handing out a file that cannot be rendered.
    const html = await page();
    const builder = /function storyboard\(v\) \{([\s\S]*?)\n  \}/.exec(html);
    expect(builder, "storyboard() not found").not.toBeNull();
    expect(builder![1]).not.toMatch(/o\.docs/);
  });
});
