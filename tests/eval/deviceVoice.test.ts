import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SCRIPTED_KN_PACK } from '../../src/canvas/languagePack';
import { looksKannada, pct } from '../../src/eval/commandEval';
import {
  EVAL_DEVICES,
  labelIntents,
  resolveDeviceVoice,
  scoreDeviceVoice,
  type DeviceVoiceCase,
} from '../../src/eval/deviceVoiceEval';

const evalDir = fileURLToPath(new URL('.', import.meta.url));

describe('device-voice 20-phrase eval', () => {
  const data = JSON.parse(readFileSync(join(evalDir, 'device-voice.json'), 'utf8')) as {
    cases: DeviceVoiceCase[];
  };

  it('has exactly 20 well-formed cases, including a few Kannada', () => {
    expect(data.cases).toHaveLength(20);
    const kn = data.cases.filter((c) => looksKannada(c.text));
    expect(kn.length).toBeGreaterThanOrEqual(3);
    for (const c of data.cases) {
      expect(c.text.length).toBeGreaterThan(0);
      expect(c.expect.length).toBeGreaterThan(0);
    }
    for (const c of kn) expect(c.expect.startsWith('intent:')).toBe(true);
  });

  it('scores 20/20 on the sim path (English parser + scripted Kannada pack)', () => {
    const score = scoreDeviceVoice(data.cases, EVAL_DEVICES, SCRIPTED_KN_PACK);
    const misses = score.results.filter((r) => !r.pass);
    expect(misses, misses.map((m) => `${m.text} → ${m.got} (want ${m.expect})`).join('; ')).toEqual([]);
    expect(score.correct).toBe(20);
    expect(pct(score.accuracy)).toBe('100%');
  });
});

describe('labelIntents / resolveDeviceVoice', () => {
  it('serializes on/off and brightness in a stable order', () => {
    expect(labelIntents([{ deviceId: 'wiz-desk', on: false }, { deviceId: 'wiz-ceiling', on: false }]))
      .toBe('wiz-desk:off|wiz-ceiling:off');
    expect(labelIntents([{ deviceId: 'speaker-1', volume: 20 }])).toBe('speaker-1:v20');
  });

  it('Kannada pack phrases win; unknown English is none', () => {
    expect(resolveDeviceVoice('ದೀಪ ಆಫ್ ಮಾಡು', EVAL_DEVICES, SCRIPTED_KN_PACK)).toBe('intent:lampOff');
    expect(resolveDeviceVoice('hello there', EVAL_DEVICES, SCRIPTED_KN_PACK)).toBe('none');
  });
});
