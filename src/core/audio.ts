// Audio decoding helpers for cloud speech output. Gemini TTS returns raw 16-bit
// PCM (mime "audio/L16;rate=24000" or "audio/pcm"), which Web Audio's
// decodeAudioData cannot read directly — it needs a container. wrapPcmAsWav()
// prepends a minimal WAV header so the same decodeAudioData path plays both raw
// PCM and already-containered audio (wav/mp3/ogg pass through untouched).
//
// Pure (no AudioContext, no DOM): given bytes + a mime type it returns bytes, so
// the header maths and the raw-vs-container decision are unit-tested.

/** Parse the sample rate from a PCM mime like "audio/L16;codec=pcm;rate=24000".
 *  Defaults to 24000 Hz, the Gemini TTS output rate, when absent. */
export function pcmSampleRate(mimeType: string): number {
  const m = /rate=(\d+)/i.exec(mimeType);
  const rate = m ? Number(m[1]) : NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : 24000;
}

/** True when the mime type is raw PCM that needs a WAV wrapper to be decodable. */
export function isRawPcm(mimeType: string): boolean {
  return /audio\/(l16|l8|pcm)/i.test(mimeType);
}

/** Wrap raw mono 16-bit PCM in a 44-byte WAV header. Container formats (wav,
 *  mp3, ogg) are returned unchanged so the caller can always hand the result to
 *  decodeAudioData. */
export function wrapPcmAsWav(pcm: Uint8Array, mimeType: string): Uint8Array {
  if (!isRawPcm(mimeType)) return pcm;
  const sampleRate = pcmSampleRate(mimeType);
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataLen = pcm.length;
  const buf = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buf);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, 'data');
  view.setUint32(40, dataLen, true);
  new Uint8Array(buf, 44).set(pcm);
  return new Uint8Array(buf);
}

/** Decode a base64 string to bytes (browser atob / Node Buffer, both present
 *  in the test env). Returns an empty array on malformed input. */
export function base64ToBytes(data: string): Uint8Array {
  try {
    if (typeof atob === 'function') {
      const bin = atob(data);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const B = (globalThis as any).Buffer;
    if (B) return new Uint8Array(B.from(data, 'base64'));
  } catch {
    /* fall through */
  }
  return new Uint8Array(0);
}
