// Binary STL export: world-space triangles from a list of meshes, no external deps.

import * as THREE from 'three';

const HEADER_BYTES = 80;

function triangleCount(geometry: THREE.BufferGeometry): number {
  const pos = geometry.getAttribute('position');
  const index = geometry.getIndex();
  return (index ? index.count : pos.count) / 3;
}

/** Pack one or more world-transformed meshes into a binary STL ArrayBuffer. */
export function meshesToSTL(meshes: THREE.Mesh[]): ArrayBuffer {
  let totalTris = 0;
  for (const mesh of meshes) totalTris += triangleCount(mesh.geometry);

  const buffer = new ArrayBuffer(HEADER_BYTES + 4 + totalTris * 50);
  const view = new DataView(buffer);
  view.setUint32(HEADER_BYTES, totalTris, true);

  let offset = HEADER_BYTES + 4;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();

  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const geometry = mesh.geometry;
    const pos = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const triCount = index ? index.count / 3 : pos.count / 3;

    for (let t = 0; t < triCount; t++) {
      const ia = index ? index.getX(t * 3) : t * 3;
      const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;

      a.fromBufferAttribute(pos, ia).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, ib).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, ic).applyMatrix4(mesh.matrixWorld);

      cb.subVectors(c, b);
      ab.subVectors(a, b);
      cb.cross(ab).normalize();
      normal.copy(cb);

      view.setFloat32(offset, normal.x, true);
      view.setFloat32(offset + 4, normal.y, true);
      view.setFloat32(offset + 8, normal.z, true);
      view.setFloat32(offset + 12, a.x, true);
      view.setFloat32(offset + 16, a.y, true);
      view.setFloat32(offset + 20, a.z, true);
      view.setFloat32(offset + 24, b.x, true);
      view.setFloat32(offset + 28, b.y, true);
      view.setFloat32(offset + 32, b.z, true);
      view.setFloat32(offset + 36, c.x, true);
      view.setFloat32(offset + 40, c.y, true);
      view.setFloat32(offset + 44, c.z, true);
      view.setUint16(offset + 48, 0, true);
      offset += 50;
    }
  }

  return buffer;
}

export function downloadSTL(buffer: ArrayBuffer, filename = 'mendcraft.stl'): void {
  const blob = new Blob([buffer], { type: 'model/stl' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
