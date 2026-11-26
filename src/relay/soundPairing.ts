// In-repo data-over-sound pairing chime — PURE over Float32Array. A short
// pleasant mid-band FSK motif carries the 8-character Crockford room code
// plus a checksum so a phone can join without typing or scanning. Frames
// never leave the device; this module has no mic, no network, no DOM.

import { CODE_LENGTH, TOKEN_ALPHABET, normalizeCode } from './protocol';

export const PAIRING_SAMPLE_RATE = 48_000;
/** Space / mark in a comfortable mid-band (reliable on iPhone 15 Pro and Nothing 3a mics). */
export const FREQ_SPACE = 1_600;
export const FREQ_MARK = 2_200;
/** Rising E6–G6–A6–C7 arpeggio that opens the motif. */
export const PREAMBLE_HZ = [1_318.51, 1_567.98, 1_760, 2_093] as const;
export const PREAMBLE_MS = 70;
export const GAP_MS = 30;
export const SYMBOL_MS = 30;
/** Unique 16-bit sync word (0xA5A5) ahead of the payload. */
export const SYNC_BITS: readonly number[] = [
  1, 0, 1, 0, 0, 1, 0, 1,
  1, 0, 1, 0, 0, 1, 0, 1,
];

const AMP = 0.32;
const CRC_POLY = 0x07;

export function isShortCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  for (const ch of code) if (!TOKEN_ALPHABET.includes(ch)) return false;
  return true;
}

function crc8(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x80) ? ((crc << 1) ^ CRC_POLY) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

/** 40 data bits (8 × 5) + 8 CRC bits for a normalised short code. */
export function payloadBitsOf(code: string): number[] {
  const bits: number[] = [];
  for (const ch of code) {
    const v = TOKEN_ALPHABET.indexOf(ch);
    for (let i = 4; i >= 0; i--) bits.push((v >> i) & 1);
  }
  const bytes = new Uint8Array(code.length);
  for (let i = 0; i < code.length; i++) bytes[i] = code.charCodeAt(i);
  const crc = crc8(bytes);
  for (let i = 7; i >= 0; i--) bits.push((crc >> i) & 1);
  return bits;
}

/** Inverse of payloadBitsOf. Returns null when the CRC does not match. */
export function codeFromPayloadBits(bits: number[]): string | null {
  if (bits.length < 48) return null;
  let code = '';
  for (let c = 0; c < 8; c++) {
    let v = 0;
    for (let i = 0; i < 5; i++) v = (v << 1) | (bits[c * 5 + i] ? 1 : 0);
    if (v < 0 || v >= TOKEN_ALPHABET.length) return null;
    code += TOKEN_ALPHABET[v];
  }
  let crc = 0;
  for (let i = 0; i < 8; i++) crc = (crc << 1) | (bits[40 + i] ? 1 : 0);
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) bytes[i] = code.charCodeAt(i);
  if (crc !== crc8(bytes)) return null;
  return code;
}

function samplesForMs(ms: number, sampleRate: number): number {
  return Math.max(1, Math.round((sampleRate * ms) / 1000));
}

function tone(freq: number, n: number, sampleRate: number, amp = AMP): Float32Array {
  const out = new Float32Array(n);
  const fade = Math.min(Math.floor(sampleRate * 0.002), Math.floor(n / 4));
  const omega = (2 * Math.PI * freq) / sampleRate;
  for (let i = 0; i < n; i++) {
    let a = amp;
    if (i < fade) a *= i / fade;
    else if (n - i < fade) a *= (n - i) / fade;
    out[i] = a * Math.sin(omega * i);
  }
  return out;
}

function concat(parts: Float32Array[]): Float32Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Render one pairing motif (about 1–3 s) for the 8-character short code. */
export function encodePairingChime(code: string, sampleRate = PAIRING_SAMPLE_RATE): Float32Array {
  const norm = normalizeCode(code);
  if (!isShortCode(norm)) {
    throw new Error('pairing chime: need an 8-character Crockford code');
  }
  const preN = samplesForMs(PREAMBLE_MS, sampleRate);
  const gapN = samplesForMs(GAP_MS, sampleRate);
  const symN = samplesForMs(SYMBOL_MS, sampleRate);
  const parts: Float32Array[] = [];
  for (const f of PREAMBLE_HZ) parts.push(tone(f, preN, sampleRate));
  parts.push(new Float32Array(gapN));
  const bits = [...SYNC_BITS, ...payloadBitsOf(norm)];
  for (const bit of bits) {
    parts.push(tone(bit ? FREQ_MARK : FREQ_SPACE, symN, sampleRate));
  }
  return concat(parts);
}

function goertzelPower(
  samples: Float32Array,
  start: number,
  len: number,
  freq: number,
  sampleRate: number,
): number {
  const n = Math.min(len, samples.length - start);
  if (n < 8) return 0;
  const k = Math.round((n * freq) / sampleRate);
  const w = (2 * Math.PI * k) / n;
  const coeff = 2 * Math.cos(w);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  const end = start + n;
  for (let i = start; i < end; i++) {
    s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const real = s1 - s2 * Math.cos(w);
  const imag = s2 * Math.sin(w);
  return real * real + imag * imag;
}

function bitAt(samples: Float32Array, start: number, symN: number, sampleRate: number): number {
  const mark = goertzelPower(samples, start, symN, FREQ_MARK, sampleRate);
  const space = goertzelPower(samples, start, symN, FREQ_SPACE, sampleRate);
  return mark >= space ? 1 : 0;
}

function preambleScore(
  samples: Float32Array,
  start: number,
  preN: number,
  sampleRate: number,
): number {
  let score = 0;
  for (let i = 0; i < PREAMBLE_HZ.length; i++) {
    const off = start + i * preN;
    const want = goertzelPower(samples, off, preN, PREAMBLE_HZ[i], sampleRate);
    // Competing energy at the other preamble freqs + the FSK pair.
    let other = 0;
    for (let j = 0; j < PREAMBLE_HZ.length; j++) {
      if (j === i) continue;
      other += goertzelPower(samples, off, preN, PREAMBLE_HZ[j], sampleRate);
    }
    other += goertzelPower(samples, off, preN, FREQ_MARK, sampleRate);
    other += goertzelPower(samples, off, preN, FREQ_SPACE, sampleRate);
    if (want <= 0) return 0;
    score += want / (other / 5 + 1e-9);
  }
  return score;
}

function bitsMatch(got: number[], expect: readonly number[]): boolean {
  if (got.length < expect.length) return false;
  for (let i = 0; i < expect.length; i++) if (got[i] !== expect[i]) return false;
  return true;
}

function tryDecodeAt(
  samples: Float32Array,
  start: number,
  preN: number,
  gapN: number,
  symN: number,
  sampleRate: number,
): string | null {
  const dataStart = start + PREAMBLE_HZ.length * preN + gapN;
  const need = dataStart + (SYNC_BITS.length + 48) * symN;
  if (need > samples.length) return null;
  const sync: number[] = [];
  for (let i = 0; i < SYNC_BITS.length; i++) {
    sync.push(bitAt(samples, dataStart + i * symN, symN, sampleRate));
  }
  if (!bitsMatch(sync, SYNC_BITS)) return null;
  const payload: number[] = [];
  const payloadStart = dataStart + SYNC_BITS.length * symN;
  for (let i = 0; i < 48; i++) {
    payload.push(bitAt(samples, payloadStart + i * symN, symN, sampleRate));
  }
  return codeFromPayloadBits(payload);
}

/**
 * Recover the 8-character short code from a captured motif (or a sliding
 * window that contains one). Returns null when the preamble, sync or CRC fail.
 */
export function decodePairingChime(
  samples: Float32Array,
  sampleRate = PAIRING_SAMPLE_RATE,
): string | null {
  if (samples.length < 16) return null;
  const preN = samplesForMs(PREAMBLE_MS, sampleRate);
  const gapN = samplesForMs(GAP_MS, sampleRate);
  const symN = samplesForMs(SYMBOL_MS, sampleRate);
  const packet = PREAMBLE_HZ.length * preN + gapN + (SYNC_BITS.length + 48) * symN;
  if (samples.length < packet * 0.9) return null;

  const hop = Math.max(8, Math.floor(preN / 6));
  const last = samples.length - packet;
  let bestScore = 0;
  let bestAt = -1;
  for (let t = 0; t <= Math.max(0, last); t += hop) {
    const score = preambleScore(samples, t, preN, sampleRate);
    if (score > bestScore) {
      bestScore = score;
      bestAt = t;
    }
  }
  // Also try a tight cluster around the peak in case the hop landed off-centre.
  const candidates = new Set<number>();
  if (bestAt >= 0) {
    for (let d = -hop; d <= hop; d += Math.max(4, Math.floor(hop / 4))) {
      const t = bestAt + d;
      if (t >= 0 && t <= Math.max(0, last)) candidates.add(t);
    }
  }
  // And the obvious "starts at 0" case used by the unit encoder.
  candidates.add(0);

  for (const t of candidates) {
    const code = tryDecodeAt(samples, t, preN, gapN, symN, sampleRate);
    if (code) return code;
  }
  return null;
}

/** Add modest Gaussian noise in place (for tests). `sigma` is amplitude std-dev. */
export function addGaussianNoise(samples: Float32Array, sigma: number, rng: () => number = Math.random): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    // Box–Muller
    const u = Math.max(1e-9, rng());
    const v = rng();
    const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    out[i] = samples[i] + sigma * g;
  }
  return out;
}
