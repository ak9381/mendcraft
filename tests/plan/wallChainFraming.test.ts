// B-028: each wall-chain click applies add_wall inside the tool's onDown —
// before the renderer marks the tool busy — so the bounds change reframed the
// view mid-chain and the NEXT click landed somewhere else (both mouse and
// hand). The wall tool now reports busy() while its chain has points, and the
// renderer's reframe guard honours it.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('wall chain holds the framing still (B-028)', () => {
  it('the wall tool is busy while its chain has points', () => {
    const tools = readFileSync('src/plan/tools.ts', 'utf8');
    const wall = tools.slice(tools.indexOf('function createWallTool('), tools.indexOf('function createRoomTool('));
    expect(wall).toContain('busy: () => chain.pts.length > 0,');
  });
  it('render() never reframes while the active tool is busy', () => {
    const r = readFileSync('src/plan/renderer.ts', 'utf8');
    expect(r).toMatch(/!toolBusy && !liveGesture && !panning && !toolChainBusy\(\) && boundsSig\(\) !== fitSig/);
    expect(r).toContain('return toolCtl.active().busy?.() ?? false;');
  });
});
