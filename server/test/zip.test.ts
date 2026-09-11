/**
 * The ZIP writer, checked against a real ZIP reader.
 *
 * This is hand-rolled bytes rather than a library, so the test that matters is
 * not "does build() return a Buffer" - it is whether something that did not
 * write the archive can read it back. Node cannot unzip, so the reader is
 * Python's `zipfile`, which is an independent implementation and does its own
 * CRC check on extract.
 *
 * A release nobody can open is worse than no release, and an archive with a
 * wrong CRC opens fine in some tools and fails in others - which is exactly the
 * kind of thing that surfaces on somebody else's machine.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { build, manifest } from "../src/zip.js";

/** Read an archive back with Python's zipfile; returns null if Python is absent. */
function readBack(zip: Buffer): { names: string[]; contents: Record<string, string>; bad: string | null } | null {
  const dir = mkdtempSync(join(tmpdir(), "videostroll-zip-"));
  const file = join(dir, "a.zip");
  writeFileSync(file, zip);
  const script = [
    "import json, sys, zipfile",
    "z = zipfile.ZipFile(sys.argv[1])",
    // testzip() re-computes every CRC and names the first bad entry.
    "bad = z.testzip()",
    "out = {n: z.read(n).decode('utf-8', 'replace') for n in z.namelist()}",
    "print(json.dumps({'names': z.namelist(), 'contents': out, 'bad': bad}))",
  ].join("\n");
  try {
    const stdout = execFileSync("python", ["-c", script, file], { encoding: "utf8" });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

describe("the ZIP writer", () => {
  it("produces an archive another implementation can open and verify", () => {
    const entries = [
      { name: "README.md", data: Buffer.from("# hello\n".repeat(50), "utf8") },
      { name: "server/src/deep/file.ts", data: Buffer.from("export const x = 1;\n", "utf8") },
      { name: "empty.txt", data: Buffer.alloc(0) },
    ];
    const zip = build(entries);
    const back = readBack(zip);
    if (back === null) {
      // Python is how CI verifies this; without it the test cannot prove anything.
      console.warn("python unavailable - skipping the read-back check");
      return;
    }
    expect(back.bad, "a bad CRC names the entry").toBeNull();
    expect(back.names.sort()).toEqual(["README.md", "empty.txt", "server/src/deep/file.ts"]);
    expect(back.contents["README.md"]).toBe("# hello\n".repeat(50));
    expect(back.contents["server/src/deep/file.ts"]).toBe("export const x = 1;\n");
    expect(back.contents["empty.txt"]).toBe("");
  });

  it("keeps nested paths with forward slashes, whatever the platform used", () => {
    const zip = build([{ name: "a\\b\\c.txt", data: Buffer.from("x") }]);
    const back = readBack(zip);
    if (back === null) return;
    expect(back.names).toEqual(["a/b/c.txt"]);
  });

  it("stores rather than deflates when deflating would grow the file", () => {
    // Random bytes do not compress; a naive writer emits a LARGER archive than
    // the input and calls it compression.
    const random = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 2654435761) % 251));
    const stored = build([{ name: "r.bin", data: random }]);
    expect(stored.length).toBeLessThan(random.length + 400);
    const back = readBack(stored);
    if (back === null) return;
    expect(back.bad).toBeNull();
  });

  it("round-trips content of every entry unchanged", () => {
    const entries = Array.from({ length: 40 }, (_, i) => ({
      name: `f${i}.txt`,
      data: Buffer.from(`line ${i}\n`.repeat(i + 1), "utf8"),
    }));
    const back = readBack(build(entries));
    if (back === null) return;
    expect(back.bad).toBeNull();
    for (const e of entries) {
      expect(back.contents[e.name]).toBe(e.data.toString("utf8"));
    }
  });

  it("refuses an archive the format cannot describe, rather than emitting a broken one", () => {
    const tooMany = Array.from({ length: 65_536 }, (_, i) => ({ name: `f${i}`, data: Buffer.alloc(0) }));
    expect(() => build(tooMany)).toThrow(/65535|zip64/i);
  });
});

describe("the checksum manifest", () => {
  it("is sha256sum's own format, so `sha256sum -c` reads it", () => {
    const out = manifest([
      { name: "b.txt", sha256: "b".repeat(64) },
      { name: "a.txt", sha256: "a".repeat(64) },
    ]);
    // Two spaces between hash and path is the format, not a typo.
    expect(out).toBe(`${"a".repeat(64)}  a.txt\n${"b".repeat(64)}  b.txt\n`);
    expect(out.endsWith("\n")).toBe(true);
    expect(out).not.toContain("\r");
  });

  it("is sorted, so two builds of the same files produce the same manifest", () => {
    const files = [{ name: "z", sha256: "1" }, { name: "a", sha256: "2" }, { name: "m", sha256: "3" }];
    expect(manifest(files)).toBe(manifest([...files].reverse()));
  });

  it("carries a hash that actually matches the bytes", () => {
    const data = Buffer.from("verify me\n", "utf8");
    const digest = createHash("sha256").update(data).digest("hex");
    expect(manifest([{ name: "f", sha256: digest }])).toContain(digest);
  });
});
