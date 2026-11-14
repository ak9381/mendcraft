// three.js fullscreen 3D review for the /control dashboard. It extrudes the
// privacy-safe snapshot primitives (sceneExtrude — pure, tested) into boxes and
// orbits them with touch. Lazy-loaded from controlPage so three.js stays off the
// dashboard's main render path and never loads for the 2D wireframe preview.
//
// It reads ONLY the ScenePrimitives that already crossed the relay — no PlanDoc,
// no camera, no landmarks — so the review honours the same privacy boundary as
// the rest of the dashboard.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { extrudeScene, type ExtrudeOptions } from './sceneExtrude';
import type { ScenePrimitive } from './controlSnapshot';

export interface SceneView3d {
  update(primitives: readonly ScenePrimitive[], opts?: ExtrudeOptions): void;
  dispose(): void;
}

/** Mount a WebGL orbit view into `container` (which must have a real size). */
export function createSceneView3d(container: HTMLElement): SceneView3d {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef2f7);
  const camera = new THREE.PerspectiveCamera(50, 1, 10, 2_000_000);
  camera.up.set(0, 0, 1); // z-up, same as plan/extrude3d

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.className = 'scene3d-canvas';
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  // OrbitControls maps one-finger drag → orbit, two-finger → dolly/pan, so
  // touch orbit on the iPad works with no extra wiring.

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(1, -1, 2);
  scene.add(sun);
  scene.add(new THREE.GridHelper(20000, 20, 0xcbd5e1, 0xe2e8f0).rotateX(Math.PI / 2));

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.9 });
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.85 });
  let group = new THREE.Group();
  scene.add(group);
  let framed = false;

  function update(primitives: readonly ScenePrimitive[], opts?: ExtrudeOptions): void {
    const { boxes, frame } = extrudeScene(primitives, opts);
    scene.remove(group);
    disposeGroup(group);
    group = new THREE.Group();
    for (const b of boxes) {
      const geo = new THREE.BoxGeometry(b.len, b.width, b.depth);
      const mesh = new THREE.Mesh(geo, b.kind === 'wall' ? wallMat : slabMat);
      mesh.position.set(b.cx, b.cy, b.cz);
      mesh.rotation.z = b.angle;
      group.add(mesh);
    }
    scene.add(group);
    // Only reframe the camera on the first scene so the viewer can keep orbiting
    // from their chosen angle as later snapshots arrive.
    if (!framed) {
      controls.target.set(frame.target.x, frame.target.y, frame.target.z);
      camera.position.set(frame.position.x, frame.position.y, frame.position.z);
      controls.update();
      framed = true;
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
    update,
    dispose() {
      animating = false;
      ro.disconnect();
      controls.dispose();
      disposeGroup(group);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

function disposeGroup(g: THREE.Group): void {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
}
