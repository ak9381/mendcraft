// MORPH TARGET: which tile a hold is about. Structural MorphEl/MorphDoc fake
// DOM (matches/getAttribute/getBoundingClientRect/parentElement/getRootNode/
// shadowRoot) — no jsdom needed, matching morphTarget.ts's own contract.
import { describe, expect, it } from 'vitest';
import {
  enumerateMorphTiles, morphTileLabel, resolveMorphTarget, MORPH_SNAP_PX,
  type MorphDoc, type MorphEl,
} from '../../src/canvas/morphTarget';
import type { Rect } from '../../src/canvas/handPointer';
import type { SurfacePlan, TileSpec } from '../../src/canvas/surfacePlan';

// ---- a tiny fake element implementing the MorphEl structural contract ----
class FakeEl implements MorphEl {
  attrs: Record<string, string> = {};
  parentElement: MorphEl | null = null;
  rect: Rect = { left: 0, top: 0, width: 100, height: 40 };
  selectorMatches: ((selector: string) => boolean) | null = null;
  shadowHost: MorphEl | null = null; // for getRootNode().host simulation
  shadowRoot?: { elementFromPoint?(x: number, y: number): MorphEl | null } | null = null;

  constructor(public tag = 'div') {}

  matches(selector: string): boolean {
    return this.selectorMatches ? this.selectorMatches(selector) : false;
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  getBoundingClientRect(): Rect {
    return this.rect;
  }
  getRootNode(): unknown {
    return this.shadowHost ? { host: this.shadowHost } : null;
  }
}

function tileHost(tileId: string, rect: Rect): FakeEl {
  const el = new FakeEl('div');
  el.attrs['data-mc-tile'] = tileId;
  el.rect = rect;
  return el;
}

function blockerEl(): FakeEl {
  const el = new FakeEl('div');
  el.selectorMatches = (sel) => sel.includes('data-mc-drag-handle');
  return el;
}

class FakeDoc implements MorphDoc {
  hitEl: MorphEl | null = null;
  hosts: MorphEl[] = [];
  elementFromPoint(_x: number, _y: number): MorphEl | null {
    return this.hitEl;
  }
  querySelectorAll(_selector: string): ArrayLike<MorphEl> {
    return this.hosts;
  }
}

// ---- a minimal flat/nested SurfacePlan ----
const LAMP: TileSpec = { type: 'lamp', deviceId: 'lamp-a', label: 'Desk lamp' };
const SWITCH: TileSpec = { type: 'switch', deviceId: 'wiz-switch', label: 'Fan switch' };

function flatPlan(): SurfacePlan {
  return { kind: 'room', title: 'Living room', tiles: [LAMP, SWITCH] };
}

function nestedPlan(): SurfacePlan {
  const row: TileSpec = { type: 'row', children: [LAMP, SWITCH] };
  const card: TileSpec = { type: 'card', title: 'Controls', children: [{ type: 'music', deviceId: 'wiz-speaker', label: 'Speaker' }] };
  const tabs: TileSpec = {
    type: 'tabs',
    tabs: [
      { label: 'Lights', children: [LAMP] },
      { label: 'Audio', children: [{ type: 'music', deviceId: 'wiz-speaker-2', label: 'Speaker 2' }] },
    ],
  };
  const split: TileSpec = {
    type: 'split',
    direction: 'row',
    first: [LAMP],
    second: [SWITCH],
  };
  return { kind: 'room', title: 'Dashboard', tiles: [row, card, tabs, split] };
}

describe('enumerateMorphTiles — flat plans', () => {
  it('assigns top-level paths [[0],[1]] for a flat plan', () => {
    const entries = enumerateMorphTiles(flatPlan());
    expect(entries.map((e) => e.path)).toEqual([[0], [1]]);
    expect(entries.map((e) => e.spec.type)).toEqual(['lamp', 'switch']);
  });

  it('gives stable component ids for device tiles (lamp-<deviceId>)', () => {
    const entries = enumerateMorphTiles(flatPlan());
    expect(entries[0].id).toBe('lamp-lamp-a');
    expect(entries[1].id).toBe('switch-wiz-switch');
  });

  it('labels device tiles with their own label', () => {
    expect(morphTileLabel(LAMP)).toBe('Desk lamp');
    expect(morphTileLabel(SWITCH)).toBe('Fan switch');
  });
});

describe('enumerateMorphTiles — nested row/card/tabs/split paths', () => {
  it('walks row children at [i, childIndex]', () => {
    const entries = enumerateMorphTiles(nestedPlan());
    const rowEntry = entries.find((e) => e.path.length === 1 && e.spec.type === 'row')!;
    expect(rowEntry.path).toEqual([0]);
    const rowChildren = entries.filter((e) => e.path.length === 2 && e.path[0] === 0);
    expect(rowChildren.map((e) => e.path)).toEqual([[0, 0], [0, 1]]);
    expect(rowChildren.map((e) => e.spec.type)).toEqual(['lamp', 'switch']);
  });

  it('walks card children at [i, childIndex]', () => {
    const entries = enumerateMorphTiles(nestedPlan());
    const cardChildren = entries.filter((e) => e.path.length === 2 && e.path[0] === 1);
    expect(cardChildren.map((e) => e.path)).toEqual([[1, 0]]);
    expect(cardChildren[0].spec.type).toBe('music');
  });

  it('walks tabs children at [tabsIndex, tabIndex, childIndex]', () => {
    const entries = enumerateMorphTiles(nestedPlan());
    const tabsChildren = entries.filter((e) => e.path.length === 3 && e.path[0] === 2);
    expect(tabsChildren.map((e) => e.path)).toEqual([[2, 0, 0], [2, 1, 0]]);
  });

  it('walks split first/second at [splitIndex, 0|1, childIndex]', () => {
    const entries = enumerateMorphTiles(nestedPlan());
    const splitChildren = entries.filter((e) => e.path.length === 3 && e.path[0] === 3);
    expect(splitChildren.map((e) => e.path)).toEqual([[3, 0, 0], [3, 1, 0]]);
  });

  it('gives container tiles deterministic positional ids (type-path)', () => {
    const entries = enumerateMorphTiles(nestedPlan());
    const rowEntry = entries.find((e) => e.spec.type === 'row')!;
    expect(rowEntry.id).toBe('row-0');
    const cardEntry = entries.find((e) => e.spec.type === 'card')!;
    expect(cardEntry.id).toBe('card-1');
  });
});

describe('resolveMorphTarget — direct hit on a stamped tile host', () => {
  it('resolves {tileId, path, spec} for a point directly on a stamped tile host', () => {
    const doc = new FakeDoc();
    const host = tileHost('lamp-lamp-a', { left: 10, top: 10, width: 100, height: 40 });
    doc.hitEl = host;
    doc.hosts = [host];
    const plan = flatPlan();
    const res = resolveMorphTarget(doc, { x: 50, y: 20 }, plan);
    expect(res).not.toBeNull();
    expect(res!.tileId).toBe('lamp-lamp-a');
    expect(res!.path).toEqual([0]);
    expect(res!.spec).toEqual(LAMP);
    expect(res!.host).toBe(host);
  });

  it('a child element inside a tile host resolves the enclosing tile (ancestor walk)', () => {
    const doc = new FakeDoc();
    const host = tileHost('lamp-lamp-a', { left: 10, top: 10, width: 100, height: 40 });
    const button = new FakeEl('button');
    button.parentElement = host;
    doc.hitEl = button;
    doc.hosts = [host];
    const res = resolveMorphTarget(doc, { x: 50, y: 20 }, flatPlan());
    expect(res).not.toBeNull();
    expect(res!.tileId).toBe('lamp-lamp-a');
    expect(res!.host).toBe(host);
  });
});

describe('resolveMorphTarget — blockers win outright', () => {
  it('an element matching MORPH_BLOCKERS resolves null even within snap range of a tile', () => {
    const doc = new FakeDoc();
    const host = tileHost('lamp-lamp-a', { left: 0, top: 0, width: 50, height: 40 });
    const handle = blockerEl(); // simulates a [data-mc-drag-handle] match
    handle.parentElement = null;
    doc.hitEl = handle;
    doc.hosts = [host]; // host is well within MORPH_SNAP_PX of the hit point
    const res = resolveMorphTarget(doc, { x: 55, y: 20 }, flatPlan());
    expect(res).toBeNull();
  });

  it('a blocker found via ancestor walk also wins', () => {
    const doc = new FakeDoc();
    const host = tileHost('lamp-lamp-a', { left: 0, top: 0, width: 50, height: 40 });
    const handle = blockerEl();
    const child = new FakeEl('span');
    child.parentElement = handle;
    doc.hitEl = child;
    doc.hosts = [host];
    const res = resolveMorphTarget(doc, { x: 55, y: 20 }, flatPlan());
    expect(res).toBeNull();
  });
});

describe('resolveMorphTarget — gutter snap via opts.hosts', () => {
  it('a gutter point within snapPx (56) of a stamped host snaps to it', () => {
    const doc = new FakeDoc();
    const background = new FakeEl('div'); // elementFromPoint hits plain background, no data-mc-tile
    doc.hitEl = background;
    const host = tileHost('lamp-lamp-a', { left: 100, top: 100, width: 100, height: 40 });
    const res = resolveMorphTarget(doc, { x: 95, y: 120 }, flatPlan(), { hosts: [host] }); // 5px left of the rect
    expect(res).not.toBeNull();
    expect(res!.tileId).toBe('lamp-lamp-a');
  });

  it('a gutter point farther than snapPx resolves null', () => {
    const doc = new FakeDoc();
    const background = new FakeEl('div');
    doc.hitEl = background;
    const host = tileHost('lamp-lamp-a', { left: 100, top: 100, width: 100, height: 40 });
    const res = resolveMorphTarget(doc, { x: 100 - MORPH_SNAP_PX - 1, y: 120 }, flatPlan(), { hosts: [host] });
    expect(res).toBeNull();
  });

  it('falls back to doc.querySelectorAll when opts.hosts is not given', () => {
    const doc = new FakeDoc();
    const background = new FakeEl('div');
    doc.hitEl = background;
    const host = tileHost('lamp-lamp-a', { left: 100, top: 100, width: 100, height: 40 });
    doc.hosts = [host];
    const res = resolveMorphTarget(doc, { x: 95, y: 120 }, flatPlan());
    expect(res).not.toBeNull();
    expect(res!.tileId).toBe('lamp-lamp-a');
  });
});

describe('resolveMorphTarget — shadow DOM', () => {
  it('an element inside an open shadow root resolves its tile via the host chain', () => {
    const doc = new FakeDoc();
    const host = tileHost('lamp-lamp-a', { left: 0, top: 0, width: 100, height: 40 });
    // shadowChild has no parentElement, but its getRootNode().host is `host`
    const shadowChild = new FakeEl('span');
    shadowChild.shadowHost = host;
    doc.hitEl = shadowChild;
    doc.hosts = [host];
    const res = resolveMorphTarget(doc, { x: 50, y: 20 }, flatPlan());
    expect(res).not.toBeNull();
    expect(res!.tileId).toBe('lamp-lamp-a');
  });

  it('deepAt walks into an element.shadowRoot.elementFromPoint, landing on the inner element', () => {
    const doc = new FakeDoc();
    const outerHost = new FakeEl('div'); // not itself a tile host
    const innerTileEl = tileHost('lamp-lamp-a', { left: 0, top: 0, width: 100, height: 40 });
    outerHost.shadowRoot = { elementFromPoint: () => innerTileEl };
    doc.hitEl = outerHost;
    doc.hosts = [innerTileEl];
    const res = resolveMorphTarget(doc, { x: 50, y: 20 }, flatPlan());
    expect(res).not.toBeNull();
    expect(res!.tileId).toBe('lamp-lamp-a');
  });
});

describe('resolveMorphTarget — frameId gating', () => {
  it('a host with a mismatched data-mc-frame never resolves, even snapped', () => {
    const doc = new FakeDoc();
    const host = tileHost('lamp-lamp-a', { left: 0, top: 0, width: 100, height: 40 });
    host.attrs['data-mc-frame'] = 'frame-a';
    doc.hitEl = host; // direct hit
    doc.hosts = [host];
    const res = resolveMorphTarget(doc, { x: 50, y: 20 }, flatPlan(), { frameId: 'frame-b' });
    expect(res).toBeNull();
  });

  it('a host with the matching data-mc-frame resolves', () => {
    const doc = new FakeDoc();
    const host = tileHost('lamp-lamp-a', { left: 0, top: 0, width: 100, height: 40 });
    host.attrs['data-mc-frame'] = 'frame-a';
    doc.hitEl = host;
    doc.hosts = [host];
    const res = resolveMorphTarget(doc, { x: 50, y: 20 }, flatPlan(), { frameId: 'frame-a' });
    expect(res).not.toBeNull();
  });
});

describe('resolveMorphTarget — no target', () => {
  it('a hit with no tile ancestor and nothing in snap range resolves null', () => {
    const doc = new FakeDoc();
    doc.hitEl = new FakeEl('div');
    doc.hosts = [];
    const res = resolveMorphTarget(doc, { x: 500, y: 500 }, flatPlan());
    expect(res).toBeNull();
  });

  it('elementFromPoint returning null resolves null, not a throw', () => {
    const doc = new FakeDoc();
    doc.hitEl = null;
    doc.hosts = [];
    expect(() => resolveMorphTarget(doc, { x: 0, y: 0 }, flatPlan())).not.toThrow();
    expect(resolveMorphTarget(doc, { x: 0, y: 0 }, flatPlan())).toBeNull();
  });
});
