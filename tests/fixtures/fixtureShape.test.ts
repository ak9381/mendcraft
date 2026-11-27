// Every model reply kept under tests/fixtures/ has the shape of spec §12
// ({engine, model, turnKind, recordedAt, promptSha, source, reply}), passes
// the same check its kind passes in the app, and holds nothing personal.
//
// Two folders:
//   replies/  — what the whole-journey e2e replays. Filled by `npm run record`
//               from live Gemini and Nano runs; a file there that still says
//               `source: "hand-written"` is a stop-gap waiting to be recorded.
//   written/  — hand-written examples the per-section e2e checks are pinned to
//               (some carry a bad control on purpose). Always hand-written,
//               always labelled "Replay · written example".
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractJson } from '../../src/ai/cloudJson';
import { parseModelPlan } from '../../src/canvas/aiTurn';
import { devicesPlanFromNano } from '../../src/canvas/devicesTurn';
import { parseNanoPlan } from '../../src/canvas/nanoPlan';
import { planFromReply } from '../../src/canvas/planGenerate';
import { parsePlanEdit, type RoomBox } from '../../src/canvas/planEdit';
import { coerceLanguagePack } from '../../src/canvas/languagePack';
import { parseConnectorReply } from '../../src/canvas/connectorTurn';
import { coerceNextSteps } from '../../src/canvas/nextSteps';
import { TURN_KINDS, type TurnKind } from '../../src/canvas/replayEngine';
import { FORBIDDEN, foreignDevices } from '../../scripts/recordGuard.lib.mjs';
import { JOURNEY_DEVICES } from '../../scripts/journey.lib.mjs';

const ROOT = join(__dirname);
type Fixture = { file: string; dir: string; key: string; rec: Record<string, unknown> };

function load(dir: string): Fixture[] {
  const at = join(ROOT, dir);
  if (!existsSync(at)) return [];
  return readdirSync(at).filter((f) => f.endsWith('.json')).sort().map((f) => ({
    file: `${dir}/${f}`, dir, key: f.slice(0, -'.json'.length), rec: JSON.parse(readFileSync(join(at, f), 'utf8')) as Record<string, unknown>,
  }));
}
const replies = load('replies');
const written = load('written');
const all = [...replies, ...written];

/** Rooms of the plan fixture next to a planEdit reply (the edit names one). */
function roomsBeside(dir: string): RoomBox[] {
  const plan = all.find((f) => f.dir === dir && f.key === 'gemini.plan');
  const r = plan ? planFromReply(String(plan.rec.reply)) : null;
  const raw = r?.ok ? (r.doc.rooms as { name: string; x: number; y: number; w: number; h: number }[]) : [];
  return raw.map((x, i) => ({ id: `r${i}`, name: x.name, x: x.x, y: x.y, w: x.w, h: x.h }));
}

/** Recorded on the live path (or written to match it: `shape: "live"`). */
const liveShaped = (f: Fixture): boolean => f.rec.source === 'recorded' || f.rec.shape === 'live';
/** The board request the journey makes, for checking a Nano decision. */
const JOURNEY_REQ = {
  utterance: 'build the dashboard', frameTitle: 'Board 2',
  devices: (JOURNEY_DEVICES as { id: string; cls: string; label: string }[]).map((d) => ({ id: d.id, label: d.label, kind: d.cls })),
};

/** The check the app runs on a reply of this kind; null = accepted. */
function refusal(f: Fixture): string | null {
  const reply = String(f.rec.reply);
  const kind = f.rec.turnKind as TurnKind;
  const engine = f.rec.engine;
  const obj = (): Record<string, unknown> | null => { const j = extractJson(reply); return j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, unknown> : null; };
  switch (kind) {
    case 'board': case 'boardBetter': {
      // Nano's board on the live path is a decision, {t, d}, expanded in code.
      const r = engine === 'nano' && liveShaped(f) ? parseNanoPlan(reply, JOURNEY_REQ) : parseModelPlan(reply);
      return r.ok ? null : r.error;
    }
    case 'devices': {
      const r = engine === 'nano' ? devicesPlanFromNano(reply) : parseModelPlan(reply);
      return r.ok ? null : r.error;
    }
    case 'plan': { const r = planFromReply(reply); return r.ok ? null : r.error; }
    case 'planEdit': { const r = parsePlanEdit(reply, roomsBeside(f.dir)); return r.ok ? null : r.error; }
    case 'pack': { const r = coerceLanguagePack(obj()); return r.ok ? null : r.error; }
    case 'connector': { const r = parseConnectorReply(reply); return r.ok ? null : r.error; }
    case 'steps': { const o = obj(); const r = coerceNextSteps(o ? { ...o, at: 'devices' } : o); return r.ok ? null : r.error; }
    case 'break': {
      const o = obj();
      return o && typeof o.deviceId === 'string' && Object.values(o).some((v) => typeof v === 'number') ? null : 'not a device intent';
    }
    default: return reply.trim() ? null : 'empty reply';
  }
}

/** Things that must never be written into a fixture (the recorder's own list). */
const PERSONAL = FORBIDDEN as [string, RegExp][];

describe('recorded-reply fixtures', () => {
  it('there are fixtures in both folders', () => {
    expect(replies.length).toBeGreaterThan(0);
    expect(written.length).toBeGreaterThan(0);
  });

  it('every fixture has engine, model, turnKind, recordedAt, promptSha, source and a string reply', () => {
    for (const { file, key, rec } of all) {
      expect(['nano', 'gemini'], file).toContain(rec.engine);
      expect(typeof rec.model === 'string' && rec.model.length > 0, `${file}: model`).toBe(true);
      expect(TURN_KINDS, file).toContain(rec.turnKind);
      expect(typeof rec.recordedAt === 'string' && Number.isFinite(Date.parse(rec.recordedAt as string)), `${file}: recordedAt`).toBe(true);
      expect(typeof rec.promptSha, `${file}: promptSha`).toBe('string');
      if (rec.source === 'recorded') expect(rec.promptSha as string, `${file}: a recording names its prompt`).toMatch(/^[0-9a-f]{64}$/);
      expect(['recorded', 'hand-written'], file).toContain(rec.source);
      expect(typeof rec.reply === 'string' && (rec.reply as string).length > 0, `${file}: reply`).toBe(true);
      // The file name says the engine and kind it answers.
      expect(key.startsWith(`${rec.engine}.${rec.turnKind}`), `${file}: name matches engine.turnKind`).toBe(true);
    }
  });

  it('every fixture reply passes its kind\'s coercer', () => {
    for (const f of all) expect(refusal(f), f.file).toBeNull();
  });

  it('no fixture holds a key, a token, an address or an email', () => {
    for (const { file, rec } of all) {
      const text = JSON.stringify({ ...rec, promptSha: '' }); // a sha-256 by design
      for (const [what, re] of PERSONAL) expect(re.test(text), `${file} holds ${what}`).toBe(false);
    }
  });

  it('nano.board in replies/ is in the live {t, d} shape, so its replay runs the production Nano path', () => {
    const nano = replies.find((f) => f.key === 'nano.board');
    expect(nano && liveShaped(nano)).toBe(true);
  });

  it('no reply in replies/ names a device the journey did not set up', () => {
    for (const { file, rec } of replies) expect(foreignDevices(String(rec.reply), JOURNEY_DEVICES), file).toEqual([]);
  });

  it('a hand-written fixture says so and asks to be re-recorded', () => {
    for (const { file, rec } of all.filter((f) => f.rec.source === 'hand-written')) {
      expect(typeof rec.note === 'string' && /hand-written|stop-gap|written example/i.test(`${rec.model} ${rec.note}`), file).toBe(true);
    }
  });

  it('every file in written/ is hand-written (they are examples, never passed off as recordings)', () => {
    for (const { file, rec } of written) expect(rec.source, file).toBe('hand-written');
  });

  // Passes only once `npm run record` has replaced every stop-gap in replies/
  // with a live recording (the record script runs it with MC_REQUIRE_RECORDED=1).
  it.skipIf(!process.env.MC_REQUIRE_RECORDED)('no fixture is marked hand-written', () => {
    const left = replies.filter((f) => f.rec.source !== 'recorded').map((f) => f.file);
    expect(left).toEqual([]);
  });
});
