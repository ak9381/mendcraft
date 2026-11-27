// @vitest-environment happy-dom
// A WiZ lamp's tile names who made its connector. The replay route line a
// replayed connector names is looked up once, not on every label sync.
import { afterEach, describe, expect, it } from 'vitest';
import { mountCanvas, type CanvasHandle } from '../../src/canvas/canvasApp';
import { createReplayEngines } from '../../src/canvas/replayEngine';
import { connectorArtifactId } from '../../src/canvas/connectorTurn';
import { coerceArtifact, type Artifact } from '../../src/artifacts/artifact';
import { WIZ_INTENTS, wizConnector } from '../devices/wizSample';

let handle: CanvasHandle | null = null;
afterEach(() => { handle?.destroy(); handle = null; document.body.innerHTML = ''; });

describe('the connector maker line', () => {
  it('says "Connector by" the replay kind, and asks the engines for it once', () => {
    if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    const c = wizConnector();
    const art = coerceArtifact({ id: connectorArtifactId(c.key), kind: 'connector', v: 1, title: 'WiZ bulb', by: 'replay', at: 1, status: 'approved', data: { connector: c, intents: WIZ_INTENTS } });
    expect(art.ok).toBe(true);
    const base = createReplayEngines({ 'gemini.connector': '{}' });
    let asked = 0;
    const engines = { ...base, gemini: (kind: Parameters<NonNullable<typeof base.gemini>>[0]) => { if (kind === 'connector') asked++; return base.gemini!(kind); } };
    const root = document.createElement('div');
    document.body.append(root);
    handle = mountCanvas(root, {
      autoHands: false, reducedMotion: true, sim: true, engines,
      devices: { 'wiz-lamp-1': { id: 'wiz-lamp-1', cls: 'lamp', label: 'Lamp', on: false, brightness: 50 } as never },
      connectors: [(art as { value: Artifact }).value],
    });
    const d = handle.store.get('wiz-lamp-1') as { connectorBy?: string } | undefined;
    expect(d?.connectorBy).toBe('Connector by Replay · written example');
    expect(asked).toBeLessThanOrEqual(1);
  });
});
