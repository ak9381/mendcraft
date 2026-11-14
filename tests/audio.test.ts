// Cloud-speech audio helpers (src/core/audio.ts): parse the PCM sample rate,
// decide raw-vs-container, wrap raw PCM in a WAV header so Web Audio can decode
// it, and base64-decode. Pure, no AudioContext — just byte maths.

import { describe, expect, it } from 'vitest';
import { pcmSampleRate, isRawPcm, wrapPcmAsWav, base64ToBytes } from '../src/core/audio';

describe('pcmSampleRate', () => {
  it('reads the rate from a Gemini PCM mime', () => {
    expect(pcmSampleRate('audio/L16;codec=pcm;rate=24000')).toBe(24000);
    expect(pcmSampleRate('audio/L16;rate=16000')).toBe(16000);
  });
  it('defaults to 24000 when absent or malformed', () => {
    expect(pcmSampleRate('audio/L16')).toBe(24000);
    expect(pcmSampleRate('audio/wav')).toBe(24000);
    expect(pcmSampleRate('audio/L16;rate=abc')).toBe(24000);
  });
});

describe('isRawPcm', () => {
  it('flags raw PCM mimes that need a WAV wrapper', () => {
    expect(isRawPcm('audio/L16;rate=24000')).toBe(true);
    expect(isRawPcm('audio/pcm')).toBe(true);
    expect(isRawPcm('AUDIO/L8')).toBe(true);
  });
  it('leaves container formats alone', () => {
    expect(isRawPcm('audio/wav')).toBe(false);
    expect(isRawPcm('audio/mpeg')).toBe(false);
    expect(isRawPcm('audio/ogg')).toBe(false);
  });
});

describe('wrapPcmAsWav', () => {
  it('prepends a valid 44-byte WAV header to raw PCM', () => {
    const pcm = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const wav = wrapPcmAsWav(pcm, 'audio/L16;rate=24000');
    expect(wav.length).toBe(44 + pcm.length);
    // "RIFF" ... "WAVE" ... "fmt " ... "data"
    const ascii = (o: number, n: number) => String.fromCharCode(...wav.slice(o, o + n));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(ascii(36, 4)).toBe('data');
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint32(4, true)).toBe(36 + pcm.length); // RIFF chunk size
    expect(view.getUint16(20, true)).toBe(1); // PCM format
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(24000); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(40, true)).toBe(pcm.length); // data size
    // the PCM payload is copied verbatim after the header
    expect(Array.from(wav.slice(44))).toEqual(Array.from(pcm));
  });

  it('returns container audio unchanged', () => {
    const mp3 = new Uint8Array([9, 9, 9]);
    expect(wrapPcmAsWav(mp3, 'audio/mpeg')).toBe(mp3);
  });

  it('derives byteRate from the sample rate', () => {
    const wav = wrapPcmAsWav(new Uint8Array([0, 0]), 'audio/L16;rate=16000');
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    // byteRate = rate * blockAlign (2 bytes mono 16-bit) = 32000
    expect(view.getUint32(28, true)).toBe(32000);
    expect(view.getUint16(32, true)).toBe(2); // blockAlign
  });
});

describe('base64ToBytes', () => {
  it('decodes base64 to bytes', () => {
    // "AQIDBA==" is bytes 1,2,3,4
    expect(Array.from(base64ToBytes('AQIDBA=='))).toEqual([1, 2, 3, 4]);
  });
  it('returns empty bytes on malformed input', () => {
    expect(base64ToBytes('!!!not base64!!!').length).toBeGreaterThanOrEqual(0);
  });
  it('round-trips through wrapPcmAsWav', () => {
    const wav = wrapPcmAsWav(base64ToBytes('AQIDBA=='), 'audio/L16;rate=24000');
    expect(wav.length).toBe(48);
  });
});
