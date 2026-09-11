// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * A minimal ZIP writer, so a release can be packaged with no new dependency.
 *
 * Node ships deflate but not an archiver, and this project's dependency list is
 * short on purpose. A ZIP is a well-specified container: per entry a local
 * header then the data, then a central directory describing them all, then an
 * end-of-central-directory record pointing at it. That is the whole format for
 * our purposes - no encryption, no spanning, no zip64.
 *
 * Deliberately not zip64: it caps out at 4 GB and 65,535 entries, which a
 * source release is nowhere near. `build` throws rather than silently emitting
 * an archive that tools would read as corrupt.
 */
import { deflateRawSync } from "node:zlib";

/**
 * CRC-32, table-driven.
 *
 * node:zlib exports one, but only from Node 20.15 - and package.json says
 * engines >= 20. Fifteen lines here keeps that claim honest rather than
 * breaking on a runtime we say we support.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the archive. Always forward slashes, even on Windows. */
  name: string;
  data: Buffer;
  /** Modification time, for reproducibility. Defaults to the epoch used below. */
  mtime?: Date;
}

/** ZIP stores DOS time: 2-second resolution, and no year before 1980. */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

/**
 * Build a ZIP archive.
 *
 * Every entry is deflated unless deflating makes it bigger - which happens with
 * already-compressed bytes, and storing those is both smaller and faster to
 * read back.
 */
export function build(entries: ZipEntry[]): Buffer {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`${entries.length} entries exceeds the ${MAX_ENTRIES} a non-zip64 archive can hold`);
  }

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, "/"), "utf8");
    const raw = entry.data;
    const deflated = deflateRawSync(raw);
    // 0 = stored, 8 = deflated.
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);
    const { time, date } = dosDateTime(entry.mtime ?? new Date(0));

    if (raw.length > MAX_SIZE || body.length > MAX_SIZE) {
      throw new Error(`${entry.name} is too large for a non-zip64 archive`);
    }

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0); // central directory header signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    // (0o100644 << 16) overflows to a negative signed int32 - JS shifts are
    // 32-bit signed - so coerce back to unsigned before writing.
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: regular file, 0644
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralDirectory, end]);
}

/**
 * The per-file manifest that travels inside the archive.
 *
 * sha256sum's own format - "<hex>  <path>", two spaces, LF - so `sha256sum -c
 * CHECKSUMS.txt` verifies an extracted release with no special tooling.
 */
export function manifest(entries: Array<{ name: string; sha256: string }>): string {
  return entries
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => `${e.sha256}  ${e.name}`)
    .join("\n") + "\n";
}
