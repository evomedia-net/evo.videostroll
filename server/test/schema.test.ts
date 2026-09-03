/**
 * The storyboard contract, from both sides: the published JSON Schema and the
 * runtime zod schema must agree on the example, and both must reject a
 * credential-shaped narration - the one mistake this guard exists for.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { parseStoryboard, SECRET_RE } from "../src/storyboard.js";

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const load = async (p: string) => JSON.parse(await readFile(join(REPO, p), "utf8"));

describe("storyboard contract", () => {
  it("the example validates under the published JSON Schema", async () => {
    const schema = await load("server/schema/storyboard.schema.json");
    const example = await load("examples/storyboards/example-com.json");
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    expect(validate(example), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("the example validates under the runtime zod schema, with defaults applied", async () => {
    const example = await load("examples/storyboards/example-com.json");
    const sb = parseStoryboard(example);
    expect(sb.steps.length).toBe(6);
    expect(sb.viewport.width).toBe(1920);
    expect(sb.voice.provider).toBe("silent");
  });

  it("both schemas reject a password-shaped narration", async () => {
    const schema = await load("server/schema/storyboard.schema.json");
    const example = await load("examples/storyboards/example-com.json");
    const bad = structuredClone(example);
    bad.steps[0].narration = "The admin password: hunter2 is shown here";
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    expect(ajv.compile(schema)(bad)).toBe(false);
    expect(() => parseStoryboard(bad)).toThrow(/credential|secret/i);
  });

  it("the secret pattern catches the shapes that matter and lets prose through", () => {
    for (const s of ["password: hunter2", "api_key=abc", "Bearer abcdefghijklmnop123", "ghp_abcdefghijklmnopqrstuvwxyz", "-----BEGIN RSA PRIVATE KEY-----"]) {
      expect(SECRET_RE.test(s), s).toBe(true);
    }
    for (const s of ["The password field has a show/hide toggle.", "Tokens are issued per tenant.", "Secrets never go in a storyboard."]) {
      expect(SECRET_RE.test(s), s).toBe(false);
    }
  });

  it("rejects unknown action types and unknown fields, so typos fail loudly", async () => {
    const example = await load("examples/storyboards/example-com.json");
    const bad = structuredClone(example);
    bad.steps[1].actions.push({ type: "teleport", target: { selector: "h1" } });
    expect(() => parseStoryboard(bad)).toThrow();
    const bad2 = structuredClone(example);
    bad2.steps[0].narrator = "me";
    expect(() => parseStoryboard(bad2)).toThrow();
  });
});
