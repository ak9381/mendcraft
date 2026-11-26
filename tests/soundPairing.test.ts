import { describe, expect, it } from 'vitest';
import { CODE_LENGTH, normalizeCode } from '../src/relay/protocol';
import {
  addGaussianNoise,
  codeFromPayloadBits,
  decodePairingChime,
  encodePairingChime,
  isShortCode,
  payloadBitsOf,
} from '../src/relay/soundPairing';

const CODE = 'K7MP2Q4X';

describe('soundPairing', () => {
  it('encodes and decodes an 8-character Crockford code', () => {
    const samples = encodePairingChime(CODE);
    expect(samples.length).toBeGreaterThan(48_000); // > 1 s at 48 kHz
    expect(samples.length).toBeLessThan(48_000 * 3);
    expect(decodePairingChime(samples)).toBe(CODE);
  });

  it('accepts a grouped or lowercase code on encode', () => {
    const samples = encodePairingChime('k7mp-2q4x');
    expect(decodePairingChime(samples)).toBe(normalizeCode('k7mp-2q4x'));
  });

  it('still decodes with modest Gaussian noise', () => {
    const clean = encodePairingChime(CODE);
    // sigma 0.12 on a 0.32-amp motif is a noticeable hiss, not a wash-out.
    const noisy = addGaussianNoise(clean, 0.12, (() => {
      // Deterministic LCG so the test isn't flaky across runs.
      let s = 0xC0FFEE;
      return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 0x100000000;
      };
    })());
    expect(decodePairingChime(noisy)).toBe(CODE);
  });

  it('rejects a payload whose checksum is wrong', () => {
    const bits = payloadBitsOf(CODE);
    expect(bits).toHaveLength(40 + 8);
    expect(codeFromPayloadBits(bits)).toBe(CODE);
    bits[47] = bits[47] ? 0 : 1; // flip the last CRC bit
    expect(codeFromPayloadBits(bits)).toBeNull();
  });

  it('returns null for silence or a truncated motif', () => {
    expect(decodePairingChime(new Float32Array(8_000))).toBeNull();
    const samples = encodePairingChime(CODE);
    expect(decodePairingChime(samples.subarray(0, Math.floor(samples.length / 3)))).toBeNull();
  });

  it('isShortCode only accepts a normalised 8-char Crockford string', () => {
    expect(isShortCode(CODE)).toBe(true);
    expect(CODE).toHaveLength(CODE_LENGTH);
    expect(isShortCode('K7MP-2Q4X')).toBe(false);
    expect(isShortCode('IIIIIIII')).toBe(false); // I is not in the alphabet
  });

  it('still finds the motif when it is padded with leading silence', () => {
    const motif = encodePairingChime(CODE);
    const padded = new Float32Array(4_800 + motif.length);
    padded.set(motif, 4_800);
    expect(decodePairingChime(padded)).toBe(CODE);
  });
});
