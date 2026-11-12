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

export interface PropsPanelIO {
  apply(op: unknown): { ok: boolean; error?: string };
  snapshot(): PlanDoc;
  selectedId(): string | null;
}

export interface PropsPanelHandle {
  update(): void;
  dispose(): void;
}

const WALL_HEIGHT_MM = 2500;

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

  function update(): void {
    root.innerHTML = '';
    const d = io.snapshot();
    const id = io.selectedId();
    if (!id) {
      root.hidden = true;
      return;
    }
    const title = document.createElement('div');
    title.className = 'mc-props-title';
    root.appendChild(title);

    const wall = d.walls.find((w) => w.id === id);
    const opening = d.openings.find((o) => o.id === id);
    const room = d.rooms.find((r) => r.id === id);

    if (wall) {
      title.textContent = `Wall ${wall.id}`;
      root.appendChild(row('Length (mm)', numInput(wallLength(wall), 100, (v) => io.apply({ op: 'set_length', target: wall.id, length: v }))));
      root.appendChild(row('Thickness (mm)', numInput(wall.thickness, 10, (v) => io.apply({ op: 'set_thickness', target: wall.id, thickness: v }))));
      root.appendChild(row('Height', `${WALL_HEIGHT_MM} mm (fixed)`));
    } else if (opening) {
      const o: Opening = opening;
      const host2 = d.walls.find((w) => w.id === o.wallId);
      title.textContent = `${o.kind === 'door' ? 'Door' : o.kind === 'window' ? 'Window' : 'Opening'} ${o.id} on ${o.wallId}`;
      root.appendChild(row('Width (mm)', numInput(o.width, 50, (v) => io.apply({ op: 'set_width', target: o.id, width: v }))));
      root.appendChild(row('Offset (mm)', numInput(o.offset, 50, (v) => io.apply({ op: 'move_opening', target: o.id, offset: v }))));
      if (host2) root.appendChild(row('Host wall', `${host2.id} · ${mmToMetresLabel(wallLength(host2))}`));
      if (o.kind === 'door') {
        const flip = document.createElement('button');
        flip.type = 'button';
        flip.textContent = `Swing: ${o.swing ?? 'left'} — flip (X)`;
        flip.addEventListener('click', () => io.apply({ op: 'set_swing', target: o.id }));
        root.appendChild(row('Swing', flip));
      }
      if (o.kind === 'window') root.appendChild(row('Sill height', '900 mm (fixed for now)'));
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
    root.hidden = false;
  }

  update();
  return { update, dispose: () => root.remove() };
}
