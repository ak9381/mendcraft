// SceneState -> three.js meshes. Z is up (matches scene.ts); lengths are mm.
// CSG (hole/subtract/union) via three-bvh-csg; fillet-lite approximates a
// rounded box for box parts only (other shapes ignore filletRadius).

import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, ADDITION } from 'three-bvh-csg';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { BoxParams, ConeParams, CylinderParams, SphereParams, TorusParams, Vec3 } from './ops';
import { localHalfExtents, type Part, type SceneState, type Transform } from './scene';

const HOLE_THROUGH_DEPTH = 1000;
const SELECTED_COLOR = 0x3b82f6;
const DEFAULT_COLOR = 0xd4d4d8;

function localShapeGeometry(part: Part): THREE.BufferGeometry {
  switch (part.shape) {
    case 'box': {
      const p = part.params as BoxParams;
      const radius = part.filletRadius;
      if (radius && radius > 0) {
        const r = Math.min(radius, p.w / 2, p.d / 2, p.h / 2);
        return new RoundedBoxGeometry(p.w, p.h, p.d, 4, r).rotateX(Math.PI / 2);
      }
      return new THREE.BoxGeometry(p.w, p.d, p.h);
    }
    case 'cylinder': {
      const p = part.params as CylinderParams;
      return new THREE.CylinderGeometry(p.diameter / 2, p.diameter / 2, p.height, 32).rotateX(Math.PI / 2);
    }
    case 'sphere': {
      const p = part.params as SphereParams;
      return new THREE.SphereGeometry(p.diameter / 2, 32, 24);
    }
    case 'cone': {
      const p = part.params as ConeParams;
      const top = p.topDiameter ?? 0;
      return new THREE.CylinderGeometry(top / 2, p.diameter / 2, p.height, 32).rotateX(Math.PI / 2);
    }
    case 'torus': {
      const p = part.params as TorusParams;
      return new THREE.TorusGeometry(p.diameter / 2, p.tube / 2, 16, 48);
    }
  }
}

function applyTransform(obj: THREE.Object3D, t: Transform): void {
  obj.position.set(t.position.x, t.position.y, t.position.z);
  obj.rotation.set(t.rotationDeg.x * (Math.PI / 180), t.rotationDeg.y * (Math.PI / 180), t.rotationDeg.z * (Math.PI / 180), 'XYZ');
  obj.scale.set(
    t.scale.x * (t.mirror.x ? -1 : 1),
    t.scale.y * (t.mirror.y ? -1 : 1),
    t.scale.z * (t.mirror.z ? -1 : 1),
  );
  obj.updateMatrix();
}

function transformMatrix(t: Transform): THREE.Matrix4 {
  const dummy = new THREE.Object3D();
  applyTransform(dummy, t);
  return dummy.matrix;
}

function holeToolGeometry(diameter: number, depth: number | 'through', axis: 'x' | 'y' | 'z', offset: Vec3): THREE.BufferGeometry {
  const length = depth === 'through' ? HOLE_THROUGH_DEPTH : depth;
  const geom = new THREE.CylinderGeometry(diameter / 2, diameter / 2, length, 24);
  // CylinderGeometry's axis is Y; rotate so its axis matches the requested local axis.
  if (axis === 'z') geom.rotateX(Math.PI / 2);
  else if (axis === 'x') geom.rotateZ(Math.PI / 2);
  geom.translate(offset.x, offset.y, offset.z);
  return geom;
}

const evaluator = new Evaluator();

/**
 * Build a part's composite brush in its own local frame (identity matrix,
 * origin-centred) — hole/subtract/union features baked in. The caller is
 * responsible for placing the result with the part's current transform.
 */
function buildPartBrush(part: Part): Brush {
  let brush = new Brush(localShapeGeometry(part));
  brush.updateMatrixWorld();

  const partMatrixInverse = transformMatrix(part.transform).clone().invert();

  for (const feature of part.csg) {
    if (feature.kind === 'hole') {
      const toolBrush = new Brush(holeToolGeometry(feature.diameter, feature.depth, feature.axis, feature.offset));
      toolBrush.updateMatrixWorld();
      brush = evaluator.evaluate(brush, toolBrush, SUBTRACTION);
    } else {
      const childPart = feature.kind === 'subtract' ? feature.tool : feature.part;
      const childBrush = buildPartBrush(childPart);
      const relative = partMatrixInverse.clone().multiply(transformMatrix(childPart.transform));
      relative.decompose(childBrush.position, childBrush.quaternion, childBrush.scale);
      childBrush.updateMatrix();
      childBrush.updateMatrixWorld();
      brush = evaluator.evaluate(brush, childBrush, feature.kind === 'subtract' ? SUBTRACTION : ADDITION);
    }
  }
  return brush;
}

/** One mesh per part, world-transformed and positioned; selected part highlighted. */
export function buildScene(state: SceneState): THREE.Mesh[] {
  const material = (selected: boolean) =>
    new THREE.MeshStandardMaterial({
      color: selected ? SELECTED_COLOR : DEFAULT_COLOR,
      roughness: 0.5,
      metalness: 0.05,
    });

  return state.parts.map((part) => {
    const brush = buildPartBrush(part);
    applyTransform(brush, part.transform);
    brush.geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(brush.geometry, material(part.id === state.selectedId));
    mesh.position.copy(brush.position);
    mesh.rotation.copy(brush.rotation);
    mesh.scale.copy(brush.scale);
    mesh.userData.partId = part.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  });
}

export { localHalfExtents };
