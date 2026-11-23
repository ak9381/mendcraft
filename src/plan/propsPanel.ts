// Floating properties panel for the plan selection. Every edit is an op via
// controller.applyOp (validated + undoable): wall length/thickness, opening
// width/offset + door swing flip, room name. Read-only derived values (area,
// wall height) are labelled as such. Rebuilt on every render; cheap at plan
// scale.

import {
  mm2ToM2Label,
  mmToMetresLabel,
  roomArea,
  wallLength,
  type Opening,
  type PlanDoc,
} from './doc';
import { DEFAULTS } from './ops';

export interface PropsPanelIO {
  apply(op: unknown): { ok: boolean; error?: string };
  snapshot(): PlanDoc;
  selectedId(): string | null;
  /** On-screen twins of the keyboard chords (Ctrl+R, Ctrl+D, Delete) so a
   *  hand — or a touch screen — can do what the keys do. Each returns whether
   *  it applied. */
  actions?: { rotate?(): boolean; duplicate?(): boolean; remove?(): boolean };
}

export interface PropsPanelHandle {
  update(): void;
  dispose(): void;
}

export function createPropsPanel(host: HTMLElement, io: PropsPanelIO): PropsPanelHandle {
  const root = document.createElement('div');
  root.className = 'mc-props';
  root.setAttribute('aria-label', 'Properties');
  host.appendChild(root);

  function row(label: string, control: HTMLElement | string): HTMLElement {
    const r = document.createElement('label');
    r.className = 'mc-props-row';
    const span = document.createElement('span');
    span.textContent = label;
    r.appendChild(span);
    if (typeof control === 'string') {
      const v = document.createElement('span');
      v.className = 'mc-props-ro';
      v.textContent = control;
      r.appendChild(v);
    } else {
      r.appendChild(control);
    }
    return r;
  }

  function numInput(value: number, step: number, onCommit: (v: number) => void): HTMLInputElement {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = String(step);
    inp.value = String(Math.round(value));
    inp.addEventListener('change', () => {
      const v = Number(inp.value);
      if (Number.isFinite(v)) onCommit(v);
    });
    return inp;
  }

  function actionsRow(canRotate: boolean): HTMLElement | null {
    const a = io.actions;
    if (!a) return null;
    const box = document.createElement('div');
    box.className = 'mc-props-row mc-props-actions';
    const add = (label: string, title: string, fn?: () => boolean) => {
      if (!fn) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', () => { fn(); });
      box.appendChild(b);
    };
    if (canRotate) add('Rotate 90°', 'Rotate 90° (Ctrl+R)', a.rotate);
    add('Duplicate', 'Duplicate (Ctrl+D)', a.duplicate);
    add('Delete', 'Delete (Del)', a.remove);
    return box.children.length ? box : null;
  }

  let expanded = false;
  function update(): void {
    root.innerHTML = '';
    const d = io.snapshot();
    const id = io.selectedId();
    const ids = d.selectedIds?.length ? d.selectedIds : id ? [id] : [];
    if (ids.length === 0) {
      root.hidden = true;
      root.classList.remove('is-expanded');
      return;
    }
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'mc-props-title';
    title.setAttribute('aria-expanded', String(expanded));
    title.addEventListener('click', () => {
      expanded = !expanded;
      root.classList.toggle('is-expanded', expanded);
      title.setAttribute('aria-expanded', String(expanded));
    });
    root.classList.toggle('is-expanded', expanded);
    root.appendChild(title);

    // Multi-selection: show the count and edit the props the items share.
    if (ids.length > 1) {
      title.textContent = `${ids.length} items`;
      const walls = ids.map((x) => d.walls.find((w) => w.id === x)).filter((w): w is NonNullable<typeof w> => !!w);
      const kinds: string[] = [];
      if (walls.length) kinds.push(`${walls.length} wall${walls.length > 1 ? 's' : ''}`);
      const nOpen = ids.filter((x) => d.openings.some((o) => o.id === x)).length;
      if (nOpen) kinds.push(`${nOpen} opening${nOpen > 1 ? 's' : ''}`);
      const nFix = ids.filter((x) => d.fixtures.some((f) => f.id === x)).length;
      if (nFix) kinds.push(`${nFix} fixture${nFix > 1 ? 's' : ''}`);
      root.appendChild(row('Selection', kinds.join(', ') || `${ids.length} objects`));
      if (walls.length === ids.length) {
        // All walls: common thickness/height editors apply to the whole set
        // as ONE undoable batch.
        const batch = (envs: Array<Record<string, unknown>>) => io.apply({ op: 'batch', ops: envs });
        root.appendChild(row('Thickness (mm)', numInput(walls[0].thickness, 10, (v) =>
          batch(walls.map((w) => ({ op: 'set_thickness', target: w.id, thickness: v }))))));
        root.appendChild(row('Height (mm)', numInput(walls[0].height ?? DEFAULTS.wallHeight, 100, (v) =>
          batch(walls.map((w) => ({ op: 'set_height', target: w.id, height: v }))))));
      }
      const act = actionsRow(ids.some((x) => d.fixtures.some((f) => f.id === x) || d.openings.some((o) => o.id === x && o.kind === 'door')));
      if (act) root.appendChild(act);
      root.hidden = false;
      return;
    }

    const wall = d.walls.find((w) => w.id === id);
    const opening = d.openings.find((o) => o.id === id);
    const room = d.rooms.find((r) => r.id === id);
    const fixture = d.fixtures.find((f) => f.id === id);
    const text = d.texts.find((t) => t.id === id);

    if (wall) {
      title.textContent = `Wall ${wall.id}`;
      root.appendChild(row('Length (mm)', numInput(wallLength(wall), 100, (v) => io.apply({ op: 'set_length', target: wall.id, length: v }))));
      root.appendChild(row('Thickness (mm)', numInput(wall.thickness, 10, (v) => io.apply({ op: 'set_thickness', target: wall.id, thickness: v }))));
      root.appendChild(row('Height (mm)', numInput(wall.height ?? DEFAULTS.wallHeight, 100, (v) => io.apply({ op: 'set_height', target: wall.id, height: v }))));
    } else if (opening) {
      const o: Opening = opening;
      const host2 = d.walls.find((w) => w.id === o.wallId);
      title.textContent = `${o.kind === 'door' ? 'Door' : o.kind === 'window' ? 'Window' : 'Opening'} ${o.id} on ${o.wallId}`;
      root.appendChild(row('Width (mm)', numInput(o.width, 50, (v) => io.apply({ op: 'set_width', target: o.id, width: v }))));
      root.appendChild(row('Offset (mm)', numInput(o.offset, 50, (v) => io.apply({ op: 'move_opening', target: o.id, offset: v }))));
      const defH = o.kind === 'window' ? DEFAULTS.windowHeight : DEFAULTS.doorHeight;
      root.appendChild(row('Height (mm)', numInput(o.height ?? defH, 50, (v) => io.apply({ op: 'set_height', target: o.id, height: v }))));
      if (host2) root.appendChild(row('Host wall', `${host2.id} · ${mmToMetresLabel(wallLength(host2))}`));
      if (o.kind === 'door') {
        const flip = document.createElement('button');
        flip.type = 'button';
        flip.textContent = `Swing: ${o.swing ?? 'left'} — flip (X)`;
        flip.addEventListener('click', () => io.apply({ op: 'set_swing', target: o.id }));
        root.appendChild(row('Swing', flip));
      }
      if (o.kind === 'window')
        root.appendChild(row('Sill (mm)', numInput(o.sill ?? DEFAULTS.windowSill, 50, (v) => io.apply({ op: 'set_sill', target: o.id, sill: v }))));
    } else if (fixture) {
      title.textContent = `${fixture.kind} ${fixture.id}`;
      root.appendChild(row('Kind', fixture.kind));
      root.appendChild(row('Width (mm)', numInput(fixture.w, 50, (v) => io.apply({ op: 'set_size', target: fixture.id, w: v }))));
      root.appendChild(row('Depth (mm)', numInput(fixture.d, 50, (v) => io.apply({ op: 'set_size', target: fixture.id, d: v }))));
      root.appendChild(row('Rotation (°)', numInput(fixture.rotation, 15, (v) =>
        io.apply({ op: 'rotate', target: fixture.id, angle: v - fixture.rotation }))));
    } else if (text) {
      title.textContent = `Text ${text.id}`;
      const ti = document.createElement('input');
      ti.type = 'text';
      ti.value = text.text;
      ti.addEventListener('change', () => {
        if (ti.value.trim()) io.apply({ op: 'set_text', target: text.id, text: ti.value.trim() });
      });
      root.appendChild(row('Text', ti));
      root.appendChild(row('Font size (mm)', numInput(text.size, 50, (v) => io.apply({ op: 'set_font', target: text.id, size: v }))));
    } else if (room) {
      title.textContent = room.name;
      const name = document.createElement('input');
      name.type = 'text';
      name.value = room.name;
      name.addEventListener('change', () => {
        if (name.value.trim()) io.apply({ op: 'rename', target: room.id, name: name.value.trim() });
      });
      root.appendChild(row('Name', name));
      root.appendChild(row('Area', mm2ToM2Label(roomArea(room, d))));
      root.appendChild(row('Walls', room.wallIds.join(', ')));
    } else {
      const dim = d.dims.find((x) => x.id === id);
      if (!dim) {
        root.hidden = true;
        return;
      }
      const w = d.walls.find((x) => x.id === dim.wallId);
      title.textContent = `Dimension ${dim.id}`;
      root.appendChild(row('Measures', w ? `${w.id} · ${mmToMetresLabel(wallLength(w))}` : '—'));
    }
    const act = actionsRow(!!fixture || opening?.kind === 'door');
    if (act) root.appendChild(act);
    root.hidden = false;
  }

  update();
  return { update, dispose: () => root.remove() };
}
