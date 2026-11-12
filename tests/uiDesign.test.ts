import { describe, expect, it } from 'vitest';
import {
  emptyUi,
  layoutFrame,
  activeFrame,
  locate,
  type Frame,
} from '../src/ui/design/doc';
import { validateUiOp, UI_LIMITS, type UiOp } from '../src/ui/design/ops';
import { UiEngine } from '../src/ui/design/engine';
import {
  parseUiCommand,
  isUiGenerate,
  isUiClarify,
  isUiExport,
} from '../src/ui/design/ruleParser';
import { buildUiTemplate } from '../src/ui/design/templates';
import { coerceUi, coerceUiGenerate, expandUiDocument, isUiDesignRequest } from '../src/ui/design/ai';
import { toColor } from '../src/ui/design/colors';

// Apply a loose envelope through the real validator, like the controller does.
function run(engine: UiEngine, env: Record<string, unknown>) {
  const v = validateUiOp(env);
  if (!v.ok) return { ok: false as const, error: v.error };
  return engine.apply(v.op);
}
function validated(env: Record<string, unknown>): UiOp {
  const v = validateUiOp(env);
  if (!v.ok) throw new Error(`${JSON.stringify(env)} => ${v.error}`);
  return v.op;
}

describe('ui doc + empty state', () => {
  it('a fresh document is empty', () => {
    expect(emptyUi()).toEqual({ frames: [], selectedId: null });
  });
});

describe('ui validator', () => {
  it('reads numbers from nums and clamps font size', () => {
    const v = validateUiOp({ op: 'set_style', target: 'heading', nums: { size: 9999 } });
    expect(v.ok && v.op).toMatchObject({ op: 'set_style', size: UI_LIMITS.fontSize.max });
  });

  it('normalises colours (named + hex + "light blue")', () => {
    expect(toColor('blue')).toBe('#2563eb');
    expect(toColor('#0EA5E9')).toBe('#0ea5e9');
    expect(toColor('light blue')).toBe('#2563eb');
    expect(toColor('not-a-color')).toBeUndefined();
    const v = validateUiOp({ op: 'set_fill', target: 'button', fill: 'blue' });
    expect(v.ok && v.op).toEqual({ op: 'set_fill', target: 'button', fill: '#2563eb' });
  });

  it('rejects unknown ops and under-filled ops', () => {
    expect(validateUiOp({ op: 'explode' }).ok).toBe(false);
    expect(validateUiOp({ op: 'set_text', target: 'x' }).ok).toBe(false);
    expect(validateUiOp({ op: 'add_node', nodeType: 'widget' }).ok).toBe(false);
    expect(validateUiOp({ op: 'set_size', target: 'x' }).ok).toBe(false);
  });

  it('coerces font weight words/numbers to the 400..700 ladder', () => {
    expect((validateUiOp({ op: 'set_style', target: 'h', weight: 'bold' }) as { ok: true; op: { weight: number } }).op.weight).toBe(700);
    expect((validateUiOp({ op: 'set_style', target: 'h', nums: { weight: 550 } }) as { ok: true; op: { weight: number } }).op.weight).toBe(500);
  });

  it('defaults add_frame preset and maps "phone" → mobile', () => {
    expect(validateUiOp({ op: 'add_frame' }).ok && (validateUiOp({ op: 'add_frame' }) as { ok: true; op: { preset: string } }).op.preset).toBe('desktop');
    expect((validateUiOp({ op: 'add_frame', preset: 'phone' }) as { ok: true; op: { preset: string } }).op.preset).toBe('mobile');
  });
});

describe('ui engine — build + edit', () => {
  it('add_frame seeds a column root; add_node appends and selects', () => {
    const e = new UiEngine();
    run(e, { op: 'add_frame', preset: 'desktop' });
    expect(e.getState().frames).toHaveLength(1);
    expect(e.getState().frames[0].w).toBe(1440);
    run(e, { op: 'add_node', nodeType: 'text', role: 'heading', text: 'Welcome' });
    const frame = activeFrame(e.getState())!;
    expect(frame.root.children).toHaveLength(1);
    expect(frame.root.children[0]).toMatchObject({ type: 'text', role: 'heading', text: 'Welcome' });
    expect(e.getState().selectedId).toBe(frame.root.children[0].id);
  });

  it('mints readable, unique ids (btn-sign-in, input-email)', () => {
    const e = new UiEngine();
    run(e, { op: 'add_frame', preset: 'mobile' });
    run(e, { op: 'add_node', nodeType: 'button', label: 'Sign in' });
    run(e, { op: 'add_node', nodeType: 'input', inputType: 'email', label: 'Email' });
    const ids = activeFrame(e.getState())!.root.children.map((c) => c.id);
    expect(ids).toContain('btn-sign-in');
    expect(ids).toContain('input-email');
  });

  it('resolves spoken targets ("the button", "email field", "heading")', () => {
    const e = new UiEngine();
    e.loadFrame(buildUiTemplate('login', 'mobile')!);
    run(e, { op: 'set_fill', target: 'button', fill: 'green' });
    const btn = locate(e.getState(), e.resolveRef('button')!)!.node;
    expect(btn.type === 'button' && btn.fill).toBe('#16a34a');
    run(e, { op: 'set_size', target: 'the button', nums: { h: 48 } });
    const btn2 = locate(e.getState(), e.resolveRef('button')!)!.node;
    expect(btn2.type === 'button' && btn2.height).toBe(48);
  });

  it('set_layout edits the root stack; set_style resizes a heading', () => {
    const e = new UiEngine();
    e.loadFrame(buildUiTemplate('login')!);
    run(e, { op: 'set_layout', target: 'root', nums: { gap: 24, padding: 40 }, align: 'center' });
    const root = activeFrame(e.getState())!.root;
    expect(root.gap).toBe(24);
    expect(root.padding).toBe(40);
    expect(root.align).toBe('center');
    run(e, { op: 'set_style', target: 'heading', nums: { size: 40 } });
    const h = locate(e.getState(), e.resolveRef('heading')!)!.node;
    expect(h.type === 'text' && h.size).toBe(40);
  });

  it('move reorders within the parent stack; delete removes a node', () => {
    const e = new UiEngine();
    run(e, { op: 'add_frame', preset: 'desktop' });
    run(e, { op: 'add_node', nodeType: 'text', role: 'heading', text: 'A' });
    const firstId = e.getState().selectedId!;
    run(e, { op: 'add_node', nodeType: 'button', label: 'B' });
    const btnId = e.getState().selectedId!;
    run(e, { op: 'move', target: btnId, nums: { delta: -1 } });
    expect(activeFrame(e.getState())!.root.children[0].id).toBe(btnId);
    run(e, { op: 'delete', target: firstId });
    expect(activeFrame(e.getState())!.root.children.map((c) => c.id)).toEqual([btnId]);
  });
});

describe('ui engine — undo / redo', () => {
  it('round-trips a single op', () => {
    const e = new UiEngine();
    run(e, { op: 'add_frame', preset: 'desktop' });
    run(e, { op: 'add_node', nodeType: 'button', label: 'Sign up' });
    expect(activeFrame(e.getState())!.root.children).toHaveLength(1);
    expect(e.undo().ok).toBe(true);
    expect(activeFrame(e.getState())!.root.children).toHaveLength(0);
    expect(e.redo().ok).toBe(true);
    expect(activeFrame(e.getState())!.root.children).toHaveLength(1);
  });

  it('loadFrame is a single undoable step', () => {
    const e = new UiEngine();
    e.loadFrame(buildUiTemplate('login')!);
    expect(e.getState().frames).toHaveLength(1);
    e.undo();
    expect(e.getState().frames).toHaveLength(0);
  });

  it('refuses to undo/redo past the ends', () => {
    const e = new UiEngine();
    expect(e.undo().ok).toBe(false);
    expect(e.redo().ok).toBe(false);
  });
});

describe('ui layout (pure)', () => {
  it('stretches children across the cross axis in a column form', () => {
    const e = new UiEngine();
    e.loadFrame(buildUiTemplate('login', 'mobile')!);
    const frame = activeFrame(e.getState())!;
    const boxes = layoutFrame(frame);
    // The login content sits in a centred card; on a mobile frame the 400px card
    // clamps to the frame's inner width (390 − 2*32 = 326) and align=stretch fills it.
    const card = frame.root.children[0];
    expect(card.type).toBe('stack');
    const kids = card.type === 'stack' ? card.children : [];
    const btn = kids.find((c) => c.type === 'button')!;
    expect(boxes.get(btn.id)!.w).toBe(390 - 32 * 2);
    // children stack top-to-bottom: each y is greater than the previous.
    const ys = kids.map((c) => boxes.get(c.id)!.y);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
  });

  it('a desktop login is a centred ~400px card, not a full-width form', () => {
    const frame = buildUiTemplate('login', 'desktop')!;
    const boxes = layoutFrame(frame);
    const card = frame.root.children[0];
    expect(card.type === 'stack' && card.width).toBe(400);
    const box = boxes.get(card.id)!;
    expect(box.w).toBe(400); // fixed card width, not the 1440 frame
    // centred horizontally within the frame.
    expect(box.x).toBeGreaterThan(300);
    expect(Math.round(box.x + box.w / 2)).toBe(720);
  });

  it('a pricing row lays three cards side by side', () => {
    const frame = buildUiTemplate('pricing')!;
    const boxes = layoutFrame(frame);
    const row = frame.root.children.find((c) => c.type === 'stack')!;
    expect(row.type === 'stack' && row.children).toHaveLength(3);
    if (row.type === 'stack') {
      const xs = row.children.map((c) => boxes.get(c.id)!.x);
      expect(xs[0]).toBeLessThan(xs[1]);
      expect(xs[1]).toBeLessThan(xs[2]);
    }
  });
});

describe('ui rule parser', () => {
  it('maps whole-screen phrases to generate directives', () => {
    expect(parseUiCommand('login screen')).toMatchObject({ generate: 'login' });
    const landing = parseUiCommand('landing hero');
    expect(isUiGenerate(landing) && landing.generate).toBe('landing');
    expect(parseUiCommand('pricing section')).toMatchObject({ generate: 'pricing' });
    const mobileLogin = parseUiCommand('mobile login screen');
    expect(isUiGenerate(mobileLogin) && mobileLogin.preset).toBe('mobile');
  });

  it('parses the exact spec edit commands', () => {
    expect(parseUiCommand('make the button blue')).toMatchObject({ op: 'set_fill', target: 'button', fill: '#2563eb' });
    expect(parseUiCommand('make it 48 pixels tall')).toMatchObject({ op: 'set_size', target: 'selected', nums: { h: 48 } });
    expect(parseUiCommand('add a password field')).toMatchObject({ op: 'add_node', nodeType: 'input', inputType: 'password' });
    expect(parseUiCommand('add a button called Sign up')).toMatchObject({ op: 'add_node', nodeType: 'button', label: 'Sign up' });
    expect(parseUiCommand('bigger heading')).toMatchObject({ op: 'set_style', target: 'heading' });
    expect(parseUiCommand('add 16 pixels of padding')).toMatchObject({ op: 'set_layout', target: 'root', nums: { padding: 16 } });
    expect(parseUiCommand('gap 24')).toMatchObject({ op: 'set_layout', target: 'root', nums: { gap: 24 } });
    expect(parseUiCommand('center it')).toMatchObject({ op: 'set_layout', align: 'center' });
    expect(parseUiCommand('move it up')).toMatchObject({ op: 'move', nums: { delta: -1 } });
    expect(parseUiCommand('move it down')).toMatchObject({ op: 'move', nums: { delta: 1 } });
    expect(parseUiCommand('delete it')).toMatchObject({ op: 'delete' });
    expect(parseUiCommand('select the heading')).toMatchObject({ op: 'select', target: 'heading' });
    expect(parseUiCommand('undo')).toEqual({ op: 'undo' });
    expect(parseUiCommand('redo')).toEqual({ op: 'redo' });
  });

  it('mobile / desktop frame + export + clarify', () => {
    expect(parseUiCommand('mobile frame')).toEqual({ op: 'add_frame', preset: 'mobile' });
    expect(parseUiCommand('desktop frame')).toEqual({ op: 'add_frame', preset: 'desktop' });
    expect(isUiExport(parseUiCommand('export html'))).toBe(true);
    expect(isUiClarify(parseUiCommand('asdfghjkl'))).toBe(true);
  });

  it('the demo path parses + validates end to end', () => {
    expect(parseUiCommand('login screen')).toMatchObject({ generate: 'login' });
    const blue = parseUiCommand('make the button blue');
    expect(validateUiOp(blue as Record<string, unknown>).ok).toBe(true);
    const tall = parseUiCommand('make it 48 pixels tall');
    const v = validateUiOp(tall as Record<string, unknown>);
    expect(v.ok && v.op).toEqual({ op: 'set_size', target: 'selected', h: 48 });
  });
});

describe('ui AI coercion + expansion', () => {
  it('coerceUi validates a single op and rejects junk', () => {
    expect(coerceUi({ op: 'set_fill', target: 'button', fill: 'blue' })).toMatchObject({ op: 'set_fill', fill: '#2563eb' });
    expect(coerceUi({ op: 'explode' })).toBeNull();
    expect(coerceUi({ clarify: 'Which node?' })).toEqual({ clarify: 'Which node?' });
  });

  it('repairs an under-filled op from the same utterance', () => {
    // The model named a valid op but dropped the number.
    const raw = { op: 'set_size', target: 'selected' };
    expect(coerceUi(raw)).toBeNull();
    expect(coerceUi(raw, 'make it 48 pixels tall', parseUiCommand)).toEqual({ op: 'set_size', target: 'selected', h: 48 });
    // Never invents a different op: a move utterance does not repair a set_size.
    expect(coerceUi(raw, 'move it up', parseUiCommand)).toBeNull();
  });

  it('expands a whole-screen document into a buildable Frame (code owns ids)', () => {
    const frame = expandUiDocument({
      preset: 'mobile', padding: 32, gap: 16,
      nodes: [
        { type: 'text', role: 'heading', text: 'Welcome back' },
        { type: 'input', inputType: 'email', label: 'Email' },
        { type: 'input', inputType: 'password', label: 'Password' },
        { type: 'button', label: 'Sign in', fill: 'blue' },
      ],
    });
    expect(frame).not.toBeNull();
    const e = new UiEngine();
    expect(e.loadFrame(frame!).ok).toBe(true);
    const root = activeFrame(e.getState())!.root;
    expect(root.children).toHaveLength(4);
    expect(root.children.map((c) => c.type)).toEqual(['text', 'input', 'input', 'button']);
    const btn = root.children.find((c) => c.type === 'button')!;
    expect(btn.type === 'button' && btn.fill).toBe('#2563eb');
  });

  it('expands nested stacks (pricing cards)', () => {
    const frame = expandUiDocument({
      preset: 'desktop',
      nodes: [
        { type: 'text', role: 'heading', text: 'Pricing' },
        { type: 'stack', direction: 'row', children: [
          { type: 'stack', direction: 'column', fill: 'white', children: [{ type: 'text', role: 'heading', text: 'Pro' }] },
          { type: 'stack', direction: 'column', fill: 'white', children: [{ type: 'text', role: 'heading', text: 'Team' }] },
        ] },
      ],
    });
    const row = frame!.root.children.find((c) => c.type === 'stack')!;
    expect(row.type === 'stack' && row.direction).toBe('row');
    expect(row.type === 'stack' && row.children).toHaveLength(2);
  });

  it('rejects a document with no nodes, and classifies design requests', () => {
    expect(expandUiDocument({ nodes: [] })).toBeNull();
    expect(coerceUiGenerate({ nodes: [] })).toBeNull();
    expect(coerceUiGenerate({ clarify: 'What screen?' })).toEqual({ clarify: 'What screen?' });
    expect(isUiDesignRequest('login screen')).toBe(true);
    expect(isUiDesignRequest('make the button blue')).toBe(false);
  });
});

describe('ui templates', () => {
  it('login / landing / pricing all expand to a believable frame', () => {
    for (const name of ['login', 'landing', 'pricing'] as const) {
      const frame = buildUiTemplate(name) as Frame;
      expect(frame).not.toBeNull();
      expect(frame.root.children.length).toBeGreaterThan(0);
    }
    const login = buildUiTemplate('login', 'mobile')!;
    expect(login.preset).toBe('mobile');
    const card = login.root.children[0];
    const kids = card.type === 'stack' ? card.children : [];
    expect(kids.some((c) => c.type === 'input' && c.inputType === 'password')).toBe(true);
    expect(kids.some((c) => c.type === 'button')).toBe(true);
  });

  it('landing + pricing scale to a mobile frame without overflow', () => {
    const landing = buildUiTemplate('landing', 'mobile')!;
    expect(landing.preset).toBe('mobile');
    const img = landing.root.children.find((c) => c.type === 'image')!;
    expect(img.type === 'image' && img.w).toBeLessThanOrEqual(390);
    const pricing = buildUiTemplate('pricing', 'mobile')!;
    const cardRow = pricing.root.children.find((c) => c.type === 'stack')!;
    // on mobile the three cards stack in a column.
    expect(cardRow.type === 'stack' && cardRow.direction).toBe('column');
  });
});
