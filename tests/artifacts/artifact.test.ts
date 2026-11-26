import { describe, expect, it } from 'vitest';
import { ARTIFACT_MAX_CHARS, artifactId, coerceArtifact } from '../../src/artifacts/artifact';
import { coerceSurfacePlan } from '../../src/canvas/surfacePlan';
import { board, PLAN } from './sample';

const connector = (source: string) => ({
  id: 'connector-wiz-bulb', kind: 'connector', v: 1, title: 'WiZ bulb', by: 'gemini', at: 1, status: 'approved',
  data: {
    connector: {
      deviceKind: 'bulb', brand: 'WiZ', protocol: 'udp-json', source,
      discovery: { method: 'wiz-udp-broadcast', port: 38899 },
      actions: [{ id: 'on', label: 'On', request: { transport: 'udp', port: 38899, payload: { method: 'setPilot', params: { state: true } } } }],
    },
  },
});

describe('coerceArtifact', () => {
  it('accepts a board artifact and re-coerces its plan', () => {
    const r = coerceArtifact(board());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const plan = coerceSurfacePlan(PLAN);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(r.value.data.plan).toEqual(plan.value);
    expect(r.value.data.plan).not.toBe(PLAN);
  });

  it('refuses an unknown kind', () => {
    expect(coerceArtifact({ ...board(), kind: 'script' }).ok).toBe(false);
  });

  it('refuses an id with capitals or over 64 chars', () => {
    expect(coerceArtifact(board('F1')).ok).toBe(false);
    expect(coerceArtifact({ ...board(), id: `board-${'a'.repeat(64)}` }).ok).toBe(false);
    expect(coerceArtifact({ ...board(), id: 'plan-f1' }).ok).toBe(false); // id must name its kind
  });

  it('refuses an artifact over 400000 chars', () => {
    const big = board('f1', { title: 'Desk' });
    (big.data as Record<string, unknown>).pad = 'x'.repeat(ARTIFACT_MAX_CHARS);
    const r = coerceArtifact(big);
    expect(r.ok).toBe(false);
  });

  it('corrupt row: a board whose plan fails coerceSurfacePlan is refused', () => {
    const r = coerceArtifact(board('f1', {}, { kind: 'room', tiles: 'nope' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/board failed its check/);
  });

  it('refuses a connector whose source is builtin or sim', () => {
    expect(coerceArtifact(connector('builtin')).ok).toBe(false);
    expect(coerceArtifact(connector('sim')).ok).toBe(false);
    expect(coerceArtifact(connector('cloud')).ok).toBe(true);
  });

  it('refuses a bad envelope: version, maker, status, title with markup', () => {
    expect(coerceArtifact({ ...board(), v: 0 }).ok).toBe(false);
    expect(coerceArtifact({ ...board(), v: 1.5 }).ok).toBe(false);
    expect(coerceArtifact({ ...board(), by: 'script' }).ok).toBe(false);
    expect(coerceArtifact({ ...board(), status: 'proposed' }).ok).toBe(false);
    expect(coerceArtifact({ ...board(), title: '<b>Desk</b>' }).ok).toBe(false);
  });

  it('a plan artifact keeps only the sanitized drawing', () => {
    const r = coerceArtifact({
      id: 'plan-f2-f2-cad', kind: 'plan', v: 1, title: 'Floor plan', by: 'gemini', at: 1, status: 'approved',
      data: { frameId: 'f2', boardId: 'f2-cad', doc: { walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 3, y: 0 }, thickness: 0.1, evil: 'x' }], openings: [] } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.stringify(r.value.data)).not.toContain('evil');
  });
});

describe('artifactId', () => {
  it('slugs its parts and stays within 64 characters', () => {
    expect(artifactId('board', 'f1')).toBe('board-f1');
    expect(artifactId('connector', 'WiZ Bulb')).toBe('connector-wiz-bulb');
    expect(artifactId('plan', 'f2', 'f2-cad')).toBe('plan-f2-f2-cad');
    expect(artifactId('steps', 'x'.repeat(100)).length).toBeLessThanOrEqual(64);
  });
});
