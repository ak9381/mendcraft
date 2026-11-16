// Optional 3D extrude VIEW for the plan (not a second editor): walls become
// boxes, doors leave a full-height gap, windows leave a sill + head gap. Lazy-
// loaded so three.js stays out of the plan editor's main path.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { wallDir, wallLength, wallMidpoint, type Fixture, type PlanDoc } from './doc';
// Segment math lives in editing.ts (pure, unit-tested): per-wall height and
// per-opening sill/height are honoured there.
import { wallSegments } from './editing';
import { fixtureSpec, stairStepCount } from './fixtures';
import { roomCentroid, planBounds } from './doc';
import { MATERIAL_PRESETS, sunVector, type MaterialPlan } from '../cad/materials';

export type WalkStep = 'forward' | 'back' | 'left' | 'right' | 'turn_left' | 'turn_right';

export interface ExtrudeView {
  update(): void;
  dispose(): void;
  /** Apply Gemini (or preset) materials + lighting to the scene. */
  setMaterials(plan: MaterialPlan): void;
  /** First-person walk mode at eye height; `room` = start in that room. */
  walk(on: boolean, room?: string): boolean;
  walkStep(step: WalkStep): void;
  walking(): boolean;
}

/** Eye height and step sizes for the walkthrough, mm / degrees. */
export const WALK = { eye: 1550, step: 600, turnDeg: 30 } as const;

export function createExtrudeView(
  container: HTMLElement,
  getDoc: () => PlanDoc,
  height: number,
): ExtrudeView {
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

  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(1, -1, 2);
  scene.add(sun);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.95 });

  let group = new THREE.Group();
  scene.add(group);
  const material = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.9 });
  const structMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.85 });
  const furnMat = new THREE.MeshStandardMaterial({ color: 0xb08968, roughness: 0.85 });
  const sanMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.6 });

  /** Add a component's 3D blocks: stairs step up, columns are prisms/cylinders,
   *  everything else is a simple low box at its sensible sitting height. */
  function addFixture(g: THREE.Group, f: Fixture): void {
    const spec = fixtureSpec(f.kind);
    const mat = spec.group === 'structure' ? structMat : spec.group === 'sanitary' ? sanMat : furnMat;
    const rot = (f.rotation * Math.PI) / 180;
    const base = spec.base ?? 0;
    const place = (mesh: THREE.Mesh, localX: number, z: number): void => {
      mesh.position.set(f.x + Math.cos(rot) * localX, f.y + Math.sin(rot) * localX, z);
      mesh.rotation.z = rot;
      g.add(mesh);
    };
    if (f.kind === 'stairs') {
      const n = f.steps ?? stairStepCount(f.w);
      const step = f.w / n;
      const riser = f.rise ?? spec.height / n;
      for (let i = 0; i < n; i++) {
        const h = (i + 1) * riser;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(step, f.d, h), structMat);
        place(mesh, -f.w / 2 + (i + 0.5) * step, h / 2);
      }
      return;
    }
    if (spec.outline === 'round') {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(f.w, f.d) / 2, Math.min(f.w, f.d) / 2, spec.height, 24), mat);
      mesh.rotation.x = Math.PI / 2; // cylinder axis → world Z
      mesh.position.set(f.x, f.y, base + spec.height / 2);
      g.add(mesh);
      return;
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(f.w, f.d, spec.height), mat);
    place(mesh, 0, base + spec.height / 2);
  }

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
    for (const f of doc.fixtures) addFixture(group, f);
    // A floor slab under the plan, so materials and the walk read as a room.
    const b = planBounds(doc);
    if (b) {
      const fw = b.max.x - b.min.x + 400;
      const fh = b.max.y - b.min.y + 400;
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), floorMat);
      floor.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, -1);
      group.add(floor);
    }
    scene.add(group);
    if (walkState) return; // keep her place while walking
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

  // ---- materials ----
  function setMaterials(plan: MaterialPlan): void {
    const set = (m: THREE.MeshStandardMaterial, look: { color: string; roughness: number }) => {
      m.color.set(look.color);
      m.roughness = look.roughness;
      m.needsUpdate = true;
    };
    set(material, plan.walls);
    set(floorMat, plan.floor);
    set(structMat, plan.structure);
    set(furnMat, plan.furniture);
    set(sanMat, plan.sanitary);
    const l = plan.lighting;
    sun.intensity = l.sunIntensity;
    sun.color.set(l.sunColor);
    const v = sunVector(l);
    sun.position.set(v.x, v.y, v.z);
    hemi.intensity = l.ambientIntensity;
    scene.background = new THREE.Color(l.skyColor);
  }

  // ---- first-person walk ----
  let walkState: { x: number; y: number; heading: number; tx: number; ty: number; th: number } | null = null;
  function placeWalkCamera(): void {
    if (!walkState) return;
    const w = walkState;
    camera.position.set(w.x, w.y, WALK.eye);
    camera.lookAt(w.x + Math.cos(w.heading) * 1000, w.y + Math.sin(w.heading) * 1000, WALK.eye);
  }
  function walk(on: boolean, room?: string): boolean {
    if (!on) {
      walkState = null;
      controls.enabled = true;
      camera.fov = 50;
      camera.updateProjectionMatrix();
      build();
      return false;
    }
    const doc = getDoc();
    const want = room?.trim().toLowerCase();
    const r = (want && doc.rooms.find((x) => x.name.toLowerCase().includes(want))) || doc.rooms[0];
    const c = r ? roomCentroid(r, doc) : null;
    const b = planBounds(doc);
    const start = c ?? (b ? { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 } : { x: 0, y: 0 });
    walkState = { x: start.x, y: start.y, heading: Math.PI / 2, tx: start.x, ty: start.y, th: Math.PI / 2 };
    controls.enabled = false;
    camera.fov = 70;
    camera.updateProjectionMatrix();
    placeWalkCamera();
    return true;
  }
  function walkStep(step: WalkStep): void {
    if (!walkState) return;
    const w = walkState;
    const turn = (WALK.turnDeg * Math.PI) / 180;
    if (step === 'turn_left') { w.th += turn; return; }
    if (step === 'turn_right') { w.th -= turn; return; }
    const ang = w.th + (step === 'left' ? Math.PI / 2 : step === 'right' ? -Math.PI / 2 : step === 'back' ? Math.PI : 0);
    w.tx += Math.cos(ang) * WALK.step;
    w.ty += Math.sin(ang) * WALK.step;
  }
  function onWalkKey(e: KeyboardEvent): void {
    if (!walkState) return;
    const map: Record<string, WalkStep> = {
      ArrowUp: 'forward', w: 'forward', ArrowDown: 'back', s: 'back',
      ArrowLeft: 'turn_left', a: 'turn_left', ArrowRight: 'turn_right', d: 'turn_right',
    };
    const st = map[e.key];
    if (st) { walkStep(st); e.preventDefault(); }
  }
  window.addEventListener('keydown', onWalkKey);

  let animating = true;
  function loop(): void {
    if (!animating) return;
    if (walkState) {
      // Ease towards the target so each step glides (no motion-sick jumps).
      const w = walkState;
      w.x += (w.tx - w.x) * 0.15;
      w.y += (w.ty - w.y) * 0.15;
      w.heading += (w.th - w.heading) * 0.15;
      placeWalkCamera();
    } else {
      controls.update();
    }
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  loop();
  setMaterials(MATERIAL_PRESETS.default);

  return {
    update: build,
    setMaterials,
    walk,
    walkStep,
    walking: () => !!walkState,
    dispose() {
      window.removeEventListener('keydown', onWalkKey);
      animating = false;
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
