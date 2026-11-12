import { describe, expect, it } from 'vitest';
import { Engine } from '../src/core/scene';
import { buildTemplate } from '../src/core/templates';
import { buildScene } from '../src/core/geometry';
import { meshesToSTL } from '../src/core/stl';

describe('geometry + STL export', () => {
  it('builds a cup grip with CSG and exports a valid binary STL', () => {
    const engine = new Engine();
    for (const op of buildTemplate('cupGrip')) engine.apply(op);
    const r = engine.apply({ op: 'hole', target: 'last', diameter: 6, depth: 'through', axis: 'z' } as never);
    expect(r.ok).toBe(true);
    const meshes = buildScene(engine.getState());
    expect(meshes.length).toBeGreaterThan(0);
    const buf = meshesToSTL(meshes);
    const view = new DataView(buf);
    const tris = view.getUint32(80, true);
    expect(tris).toBeGreaterThan(0);
    expect(buf.byteLength).toBe(84 + tris * 50);
  });
});
