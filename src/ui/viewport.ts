// three.js renderer: Z-up print-bed scene, orbit camera, click-to-select raycast.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildScene } from '../core/geometry';
import { BED, type SceneState } from '../core/scene';
import type { ModeController, ViewportHandle } from '../core/controller';

interface PartViewport {
  render(state: SceneState): void;
  /** Screen -> part id under the given client (CSS pixel) coordinates. */
  pick(clientX: number, clientY: number): string | null;
  /** Screen -> world XY on the print bed plane (z = planeZ), for drag. */
  screenToPlane(clientX: number, clientY: number, planeZ: number): { x: number; y: number } | null;
  dispose(): void;
}

/** Part-mode renderer bound to the generic ModeController contract. The 3D
 *  viewport keeps its own orbit/click; pinch-drag flows through the controller
 *  (dragSelectedMm), so this handle needs no world-space drag hooks. */
export function createPartRenderer(
  container: HTMLElement,
  controller: ModeController,
  onSelect: (id: string | null) => void,
): ViewportHandle {
  const vp = createViewport(container, onSelect);
  return {
    render: () => vp.render(controller.snapshot() as SceneState),
    pick: vp.pick,
    dispose: vp.dispose,
  };
}

function createViewport(container: HTMLElement, onSelect: (partId: string | null) => void): PartViewport {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f4f5);

  const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
  camera.up.set(0, 0, 1);
  camera.position.set(260, -320, 260);
  camera.lookAt(0, 0, 40);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 40);
  controls.enableDamping = true;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(200, -150, 400);
  scene.add(sun);

  const grid = new THREE.GridHelper(Math.max(BED.x, BED.y), 22, 0x9ca3af, 0xd4d4d8);
  grid.rotateX(Math.PI / 2); // default grid lies in XZ (Y up); rotate into XY (Z up)
  scene.add(grid);

  const bedOutline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-BED.x / 2, -BED.y / 2, 0),
      new THREE.Vector3(BED.x / 2, -BED.y / 2, 0),
      new THREE.Vector3(BED.x / 2, BED.y / 2, 0),
      new THREE.Vector3(-BED.x / 2, BED.y / 2, 0),
    ]),
    new THREE.LineBasicMaterial({ color: 0x3f3f46 }),
  );
  scene.add(bedOutline);

  let partGroup = new THREE.Group();
  scene.add(partGroup);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  function toNdc(clientX: number, clientY: number): void {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  function resize(): void {
    const { clientWidth, clientHeight } = container;
    if (clientWidth === 0 || clientHeight === 0) return;
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(clientWidth, clientHeight);
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  let animating = true;
  function loop(): void {
    if (!animating) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  loop();

  function onClick(e: MouseEvent): void {
    const partId = pick(e.clientX, e.clientY);
    onSelect(partId);
  }
  renderer.domElement.addEventListener('click', onClick);

  function pick(clientX: number, clientY: number): string | null {
    toNdc(clientX, clientY);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(partGroup.children, false);
    for (const hit of hits) {
      const id = hit.object.userData.partId;
      if (typeof id === 'string') return id;
    }
    return null;
  }

  function screenToPlane(clientX: number, clientY: number, planeZ: number): { x: number; y: number } | null {
    toNdc(clientX, clientY);
    raycaster.setFromCamera(ndc, camera);
    floorPlane.constant = -planeZ;
    const point = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(floorPlane, point);
    return hit ? { x: point.x, y: point.y } : null;
  }

  function render(state: SceneState): void {
    scene.remove(partGroup);
    partGroup = new THREE.Group();
    for (const mesh of buildScene(state)) partGroup.add(mesh);
    scene.add(partGroup);
  }

  function dispose(): void {
    animating = false;
    resizeObserver.disconnect();
    renderer.domElement.removeEventListener('click', onClick);
    controls.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { render, pick, screenToPlane, dispose };
}
