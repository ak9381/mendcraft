// Parametric templates: each returns an ops array that the engine applies in order.
// Target refs use 'last' so templates are position-independent in the op log.

import type { Op } from './ops';

export type TemplateName = 'cupGrip' | 'phoneStand' | 'hook' | 'utensilHolder';
export const TEMPLATE_NAMES: readonly TemplateName[] = ['cupGrip', 'phoneStand', 'hook', 'utensilHolder'] as const;

export interface CupGripParams {
  cupDiameterMm?: number;
  heightMm?: number;
  wallMm?: number;
}

/** Sleeve that slides over a cup, with a bar handle for a whole-hand grip. */
export function cupGrip(p: CupGripParams = {}): Op[] {
  const cup = p.cupDiameterMm ?? 80;
  const height = p.heightMm ?? 60;
  const wall = p.wallMm ?? 4;
  const outer = cup + 2 * wall;
  return [
    { op: 'add', shape: 'cylinder', params: { diameter: outer, height }, name: 'grip sleeve' },
    { op: 'hole', target: 'last', diameter: cup, depth: 'through', axis: 'z' },
    {
      op: 'add',
      shape: 'box',
      params: { w: 25, d: 14, h: height },
      position: { x: outer / 2 + 10, y: 0, z: height / 2 },
      name: 'grip handle',
    },
    { op: 'fillet', target: 'last', radius: 5 },
    {
      op: 'add',
      shape: 'box',
      params: { w: 12, d: 14, h: 12 },
      position: { x: outer / 2 + 2, y: 0, z: height / 2 },
      name: 'handle bridge',
    },
    { op: 'union', targets: ['grip sleeve', 'grip handle', 'handle bridge'] },
  ];
}

export interface PhoneStandParams {
  angleDeg?: number;
  phoneThicknessMm?: number;
  widthMm?: number;
}

/** Wedge stand: base + tilted back rest + lip slot sized to the phone. */
export function phoneStand(p: PhoneStandParams = {}): Op[] {
  const angle = p.angleDeg ?? 60;
  const slot = (p.phoneThicknessMm ?? 9) + 2; // clearance
  const width = p.widthMm ?? 80;
  return [
    { op: 'add', shape: 'box', params: { w: width, d: 70, h: 8 }, name: 'stand base' },
    { op: 'fillet', target: 'last', radius: 3 },
    {
      op: 'add',
      shape: 'box',
      params: { w: width, d: 6, h: 90 },
      position: { x: 0, y: 20, z: 45 },
      name: 'back rest',
    },
    { op: 'rotate', target: 'last', axis: 'x', deg: -(90 - angle) },
    { op: 'align', target: 'last', to: 'floor', mode: 'center' },
    {
      op: 'add',
      shape: 'box',
      params: { w: width, d: slot, h: 10 },
      position: { x: 0, y: -18, z: 8 + 5 },
      name: 'slot cutter',
    },
    { op: 'subtract', target: 'stand base', tool: 'slot cutter' },
    {
      op: 'add',
      shape: 'box',
      params: { w: width, d: 8, h: 14 },
      position: { x: 0, y: -28, z: 7 },
      name: 'front lip',
    },
  ];
}

export interface HookParams {
  depthMm?: number;
  rodDiameterMm?: number;
}

/** Wall hook: screw plate with two holes + protruding rod with a cone tip. */
export function hook(p: HookParams = {}): Op[] {
  const depth = p.depthMm ?? 40;
  const rod = p.rodDiameterMm ?? 12;
  return [
    { op: 'add', shape: 'box', params: { w: 30, d: 8, h: 70 }, name: 'hook plate' },
    { op: 'fillet', target: 'last', radius: 3 },
    { op: 'hole', target: 'last', diameter: 4.5, depth: 'through', axis: 'y', offset: { x: 0, y: 0, z: 25 } },
    { op: 'hole', target: 'last', diameter: 4.5, depth: 'through', axis: 'y', offset: { x: 0, y: 0, z: -25 } },
    {
      op: 'add',
      shape: 'cylinder',
      params: { diameter: rod, height: depth },
      position: { x: 0, y: -(4 + depth / 2), z: 20 },
      name: 'hook rod',
    },
    { op: 'rotate', target: 'last', axis: 'x', deg: 90 },
    {
      op: 'add',
      shape: 'cone',
      params: { diameter: rod, height: 10, topDiameter: rod + 8 },
      position: { x: 0, y: -(4 + depth), z: 20 },
      name: 'hook tip',
    },
    { op: 'rotate', target: 'last', axis: 'x', deg: 90 },
  ];
}

export interface UtensilHolderParams {
  diameterMm?: number;
  heightMm?: number;
  wallMm?: number;
}

/** Weighted-base cup for utensils/pens: thick wall, blind pocket, drain hole. */
export function utensilHolder(p: UtensilHolderParams = {}): Op[] {
  const outer = p.diameterMm ?? 70;
  const height = Math.min(p.heightMm ?? 100, 240);
  const wall = p.wallMm ?? 3;
  const pocket = outer - 2 * wall;
  return [
    { op: 'add', shape: 'cylinder', params: { diameter: outer, height }, name: 'holder body' },
    {
      op: 'hole',
      target: 'last',
      diameter: pocket,
      depth: height - 6, // keep a 6 mm floor
      axis: 'z',
    },
    { op: 'hole', target: 'last', diameter: 5, depth: 'through', axis: 'z' },
    {
      op: 'add',
      shape: 'cone',
      params: { diameter: outer + 16, height: 6, topDiameter: outer },
      position: { x: 0, y: 0, z: 3 },
      name: 'holder foot',
    },
  ];
}

const BUILDERS: Record<TemplateName, (params?: Record<string, number>) => Op[]> = {
  cupGrip: (params) =>
    cupGrip({ cupDiameterMm: params?.cupDiameterMm, heightMm: params?.heightMm, wallMm: params?.wallMm }),
  phoneStand: (params) =>
    phoneStand({ angleDeg: params?.angleDeg, phoneThicknessMm: params?.phoneThicknessMm, widthMm: params?.widthMm }),
  hook: (params) => hook({ depthMm: params?.depthMm, rodDiameterMm: params?.rodDiameterMm }),
  utensilHolder: (params) =>
    utensilHolder({ diameterMm: params?.diameterMm, heightMm: params?.heightMm, wallMm: params?.wallMm }),
};

export function buildTemplate(name: TemplateName, params?: Record<string, number>): Op[] {
  return BUILDERS[name](params);
}

export function isTemplateName(v: unknown): v is TemplateName {
  return typeof v === 'string' && (TEMPLATE_NAMES as readonly string[]).includes(v);
}
