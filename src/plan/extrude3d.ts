// Optional 3D extrude VIEW for the plan (not a second editor): walls become
// boxes, doors leave a full-height gap, windows leave a sill + head gap. Lazy-
// loaded so three.js stays out of the plan editor's main path.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { wallDir, wallLength, wallMidpoint, type PlanDoc } from './doc';
// Segment math lives in editing.ts (pure, unit-tested): per-wall height and
// per-opening sill/height are honoured there.
import { wallSegments } from './editing';

export function createExtrudeView(
  container: HTMLElement,
  getDoc: () => PlanDoc,
  height: number,
): { update(): void; dispose(): void } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef2f7);
  const camera = new THREE.PerspectiveCamera(50, 1, 10, 500000);
  camera.up.set(0, 0, 1);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.className = 'plan-3d';
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(1, -1, 2);
  scene.add(sun);

  let group = new THREE.Group();
  scene.add(group);
  const material = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.9 });

  function build(): void {
    scene.remove(group);
    group = new THREE.Group();
    const doc = getDoc();
    let cx = 0;
    let cy = 0;
    let n = 0;
    for (const wall of doc.walls) {
      const dir = wallDir(wall);
      const angle = Math.atan2(dir.y, dir.x);
      const mid = wallMidpoint(wall);
      for (const seg of wallSegments(wall, doc, height)) {
        const len = seg.e - seg.s;
        if (len <= 1) continue;
        const box = new THREE.BoxGeometry(len, wall.thickness, seg.z1 - seg.z0);
        const mesh = new THREE.Mesh(box, material);
        // Position the segment's centre along the wall direction.
        const along = (seg.s + seg.e) / 2 - wallLength(wall) / 2;
        mesh.position.set(
          mid.x + dir.x * along,
          mid.y + dir.y * along,
          (seg.z0 + seg.z1) / 2,
        );
        mesh.rotation.z = angle;
        group.add(mesh);
      }
      cx += mid.x;
      cy += mid.y;
      n++;
    }
    scene.add(group);
    if (n > 0) {
      const center = new THREE.Vector3(cx / n, cy / n, height / 2);
      controls.target.copy(center);
      camera.position.set(center.x + 8000, center.y - 10000, 9000);
    }
  }

  function resize(): void {
    const { clientWidth, clientHeight } = container;
    if (!clientWidth || !clientHeight) return;
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(clientWidth, clientHeight);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  let animating = true;
  function loop(): void {
    if (!animating) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  loop();

  return {
    update: build,
    dispose() {
      animating = false;
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
