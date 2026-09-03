// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Minimal WAV handling for the audio timeline: one fixed format (16-bit PCM,
 * mono, 24 kHz) so clips from any provider concatenate by byte-append. A
 * provider that produces something else resamples on its own side; this file
 * never guesses.
 */

export const SAMPLE_RATE = 24_000;
export const CHANNELS = 1;
export const BITS = 16;
const BYTES_PER_SAMPLE = (BITS / 8) * CHANNELS;

export interface Wav {
  rate: number;
  channels: number;
  bits: number;
  data: Buffer;
}

export function wavHeader(dataBytes: number, rate = SAMPLE_RATE, channels = CHANNELS, bits = BITS): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); // PCM chunk size
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * (bits / 8), 28);
  h.writeUInt16LE(channels * (bits / 8), 32);
  h.writeUInt16LE(bits, 34);
  h.write("data", 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

export function msToBytes(ms: number, rate = SAMPLE_RATE): number {
  const samples = Math.round((ms / 1000) * rate);
  return samples * BYTES_PER_SAMPLE;
}

export function bytesToMs(bytes: number, rate = SAMPLE_RATE): number {
  return Math.round((bytes / BYTES_PER_SAMPLE / rate) * 1000);
}

export function silenceWav(ms: number): Buffer {
  const data = Buffer.alloc(msToBytes(ms));
  return Buffer.concat([wavHeader(data.length), data]);
}

/** Read a canonical 44-byte-header PCM WAV. Refuses anything else, loudly. */
export function readWav(buf: Buffer): Wav {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  if (buf.readUInt16LE(20) !== 1) throw new Error("not PCM WAV");
  const channels = buf.readUInt16LE(22);
  const rate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  // Walk chunks to the data chunk rather than assuming offset 44 - some
  // encoders insert a LIST chunk before it.
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "data") return { rate, channels, bits, data: buf.subarray(off + 8, off + 8 + size) };
    off += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

function assertCanonical(w: Wav): void {
  if (w.rate !== SAMPLE_RATE || w.channels !== CHANNELS || w.bits !== BITS) {
    throw new Error(`WAV must be ${BITS}-bit ${CHANNELS}ch ${SAMPLE_RATE} Hz; got ${w.bits}-bit ${w.channels}ch ${w.rate} Hz`);
  }
}

export function wavDurationMs(buf: Buffer): number {
  const w = readWav(buf);
  assertCanonical(w);
  return bytesToMs(w.data.length);
}

/** Pad (or leave alone) so the clip lasts at least targetMs. Never truncates. */
export function padWav(buf: Buffer, targetMs: number): Buffer {
  const w = readWav(buf);
  assertCanonical(w);
  const want = msToBytes(targetMs);
  if (w.data.length >= want) return Buffer.concat([wavHeader(w.data.length), w.data]);
  const pad = Buffer.alloc(want - w.data.length);
  return Buffer.concat([wavHeader(want), w.data, pad]);
}

export function concatWav(bufs: Buffer[]): Buffer {
  const datas = bufs.map((b) => {
    const w = readWav(b);
    assertCanonical(w);
    return w.data;
  });
  const total = datas.reduce((n, d) => n + d.length, 0);
  return Buffer.concat([wavHeader(total), ...datas]);
}
