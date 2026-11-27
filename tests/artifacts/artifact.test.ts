import { describe, expect, it } from 'vitest';
import { ARTIFACT_MAX_CHARS, artifactId, coerceArtifact, frameIdOfArtifactId } from '../../src/artifacts/artifact';
import { coerceSurfacePlan } from '../../src/canvas/surfacePlan';
import { coerceConnector } from '../../src/devices/connector';
import { board, PLAN } from './sample';

const connector = (source: string) => ({
  id: 'connector-wiz-bulb', kind: 'connector', v: 1, title: 'WiZ bulb', by: 'gemini', at: 1, status: 'approved',
  data: {
    connector: {
      deviceKind: 'bulb', brand: 'WiZ', protocol: 'udp-json', source,
      discovery: { method: 'wiz-udp-broadcast', port: 38899 },
      actions: [{ id: 'on', label: 'On', request: { transport: 'udp', port: 38899, payload: { method: 'setPilot', params: { state: true } } } }],
    },
    intents: { on: { action: 'on' } },
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

  it('refuses a connector with no usable intent map, or stored under another device', () => {
    const c = connector('cloud');
    expect(coerceArtifact({ ...c, data: { connector: c.data.connector } }).ok).toBe(false);
    expect(coerceArtifact({ ...c, data: { ...c.data, intents: { on: { action: 'reboot' } } } }).ok).toBe(false);
    expect(coerceArtifact({ ...c, id: 'connector-govee-strip' }).ok).toBe(false);
  });

  it('a connector action on a port outside the allow-list (21, 22, 443, 65535) is dropped, and such a stored connector is refused', () => {
    const c = connector('cloud');
    for (const port of [21, 22, 443, 65535]) {
      const raw = { ...c.data.connector, actions: [{ id: 'on', label: 'On', request: { transport: 'udp', port, payload: { method: 'setPilot', params: { state: true } } } }] };
      const got = coerceConnector(raw, 'cloud');
      expect(got === null || got.actions.length === 0, `port ${port}`).toBe(true);
      expect(coerceArtifact({ ...c, data: { ...c.data, connector: raw } }).ok, `port ${port}`).toBe(false);
    }
    expect(coerceConnector(c.data.connector, 'cloud')?.actions).toHaveLength(1); // 38899 passes
  });

  it('refuses a stored connector with a port outside the allow-list, not just that action', () => {
    const c = connector('cloud');
    const extra = { id: 'ssh', label: 'Shell', request: { transport: 'udp', port: 22, payload: { x: 1 } } };
    expect(coerceArtifact({ ...c, data: { ...c.data, connector: { ...c.data.connector, actions: [...c.data.connector.actions, extra] } } }).ok).toBe(false);
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
      id: 'plan-2-f2-f2-cad', kind: 'plan', v: 1, title: 'Floor plan', by: 'gemini', at: 1, status: 'approved',
      data: { frameId: 'f2', boardId: 'f2-cad', doc: { walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 3, y: 0 }, thickness: 0.1, evil: 'x' }], openings: [] } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.stringify(r.value.data)).not.toContain('evil');
  });
});

describe('artifactId', () => {
  it('keeps ids in the charset as they are and length-prefixes multi-part ids', () => {
    expect(artifactId('board', 'f1')).toBe('board-f1');
    expect(artifactId('pack', 'kn')).toBe('pack-kn');
    expect(artifactId('plan', 'f2', 'f2-cad')).toBe('plan-2-f2-f2-cad');
    expect(frameIdOfArtifactId('plan-2-f2-f2-cad')).toBe('f2');
    expect(frameIdOfArtifactId('board-my-room-2')).toBe('my-room-2');
  });

  it('never collides: hyphens and slug-like parts stay distinct', () => {
    expect(artifactId('plan', 'a-b', 'c')).not.toBe(artifactId('plan', 'a', 'b-c'));
    expect(artifactId('connector', 'WiZ Bulb')).not.toBe(artifactId('connector', 'wiz-bulb'));
    expect(artifactId('connector', 'WiZ Bulb')).toMatch(/^connector-x[0-9a-f]+$/);
  });

  it('a long id is hashed within 64 characters, and differs per input', () => {
    const a = artifactId('steps', 'x'.repeat(100)), b = artifactId('steps', `${'x'.repeat(99)}y`);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a).toMatch(/^steps-h[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
  });

  it('a plan artifact whose id does not match its board is refused', () => {
    const r = coerceArtifact({
      id: 'plan-f2-f2-cad', kind: 'plan', v: 1, title: 'Floor plan', by: 'gemini', at: 1, status: 'approved',
      data: { frameId: 'f2', boardId: 'f2-cad', doc: { walls: [], openings: [] } },
    });
    expect(r.ok).toBe(false);
  });
});
