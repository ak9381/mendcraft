import { describe, expect, it } from 'vitest';
import { parseCommand, isClarify, isTemplateCommand } from '../src/core/ruleParser';

describe('ruleParser', () => {
  it('add a cylinder 20 by 40', () => {
    expect(parseCommand('add a cylinder 20 by 40')).toEqual({
      op: 'add', shape: 'cylinder', params: { diameter: 20, height: 40 },
    });
  });

  it('box 30 20 10', () => {
    expect(parseCommand('box 30 20 10')).toEqual({
      op: 'add', shape: 'box', params: { w: 30, d: 20, h: 10 },
    });
  });

  it('hole 6 mm through', () => {
    expect(parseCommand('hole 6 mm through')).toEqual({
      op: 'hole', target: 'selected', diameter: 6, depth: 'through', axis: 'z',
    });
  });

  it('tolerates "whole" for hole', () => {
    expect(parseCommand('whole 6 through')).toMatchObject({ op: 'hole', diameter: 6 });
  });

  it('tolerates "too" for 2 in numeric context', () => {
    expect(parseCommand('taller by too')).toEqual({
      op: 'scale', target: 'selected', deltaMm: { z: 2 },
    });
  });

  it('move left 10 and up 5', () => {
    expect(parseCommand('move left 10')).toEqual({
      op: 'move', target: 'selected', dx: -10, dy: 0, dz: 0,
    });
    expect(parseCommand('up 5')).toEqual({
      op: 'move', target: 'selected', dx: 0, dy: 0, dz: 5,
    });
  });

  it('rotate 45 around z', () => {
    expect(parseCommand('rotate 45 around z')).toEqual({
      op: 'rotate', target: 'selected', axis: 'z', deg: 45,
    });
  });

  it('taller by 5 / wider by 3', () => {
    expect(parseCommand('taller by 5')).toEqual({
      op: 'scale', target: 'selected', deltaMm: { z: 5 },
    });
    expect(parseCommand('wider by 3')).toEqual({
      op: 'scale', target: 'selected', deltaMm: { x: 3 },
    });
  });

  it('scale 1.5', () => {
    expect(parseCommand('scale 1.5')).toEqual({ op: 'scale', target: 'selected', factor: 1.5 });
  });

  it('mirror x', () => {
    expect(parseCommand('mirror x')).toEqual({ op: 'mirror', target: 'selected', axis: 'x' });
  });

  it('array 3 spacing 20', () => {
    expect(parseCommand('array 3 spacing 20')).toEqual({
      op: 'array', target: 'selected', count: 3, spacing: 20, axis: 'x',
    });
  });

  it('fillet 2', () => {
    expect(parseCommand('fillet 2')).toEqual({ op: 'fillet', target: 'selected', radius: 2 });
  });

  it('align to floor', () => {
    expect(parseCommand('align to floor')).toEqual({
      op: 'align', target: 'selected', to: 'floor', mode: 'center',
    });
  });

  it('union and subtract', () => {
    expect(parseCommand('union')).toEqual({ op: 'union', targets: ['selected', 'last'] });
    expect(parseCommand('subtract')).toEqual({ op: 'subtract', target: 'selected', tool: 'last' });
  });

  it('delete and select', () => {
    expect(parseCommand('delete')).toEqual({ op: 'delete', target: 'selected' });
    expect(parseCommand('select box 2')).toEqual({ op: 'select', target: 'box 2' });
  });

  it('undo and redo', () => {
    expect(parseCommand('undo')).toEqual({ op: 'undo' });
    expect(parseCommand('redo that')).toEqual({ op: 'redo' });
  });

  it('template names return template commands', () => {
    expect(parseCommand('cup grip')).toEqual({ template: 'cupGrip', params: {} });
    expect(parseCommand('make me a phone stand')).toEqual({ template: 'phoneStand', params: {} });
    expect(parseCommand('hook')).toEqual({ template: 'hook', params: {} });
    expect(parseCommand('utensil holder')).toEqual({ template: 'utensilHolder', params: {} });
    const r = parseCommand('cup grip');
    expect(isTemplateCommand(r)).toBe(true);
  });

  it('number words become digits', () => {
    expect(parseCommand('move right ten')).toEqual({
      op: 'move', target: 'selected', dx: 10, dy: 0, dz: 0,
    });
    expect(parseCommand('rotate forty five around y')).toMatchObject({ op: 'rotate', deg: 45, axis: 'y' });
  });

  it('asks to clarify when the command is missing information', () => {
    expect(isClarify(parseCommand('move left'))).toBe(true);
    expect(isClarify(parseCommand('mirror'))).toBe(true);
    expect(isClarify(parseCommand('do the thing'))).toBe(true);
    expect(isClarify(parseCommand(''))).toBe(true);
  });

  it('clamps out-of-range numbers via validateOp', () => {
    const r = parseCommand('fillet 500');
    expect(r).toMatchObject({ op: 'fillet', radius: 30 });
  });
});

describe('template commands', () => {
  const cases: Array<[string, string]> = [
    ['cup grip', 'cupGrip'], ['Cup grip.', 'cupGrip'], ['cup-grip', 'cupGrip'], ['cupgrip', 'cupGrip'],
    ['make a cup grip', 'cupGrip'], ['build me a cup grip', 'cupGrip'], ['cop grip', 'cupGrip'],
    ['cup grap', 'cupGrip'], ['cup grips', 'cupGrip'], ['make a cup', 'cupGrip'], ['mug holder', 'cupGrip'],
    ['phone stand', 'phoneStand'], ['design a stand for my phone', 'phoneStand'], ['phone stnd', 'phoneStand'],
    ['something to hold my phone', 'phoneStand'], ['make a phone', 'phoneStand'],
    ['hook', 'hook'], ['make a hook', 'hook'], ['hooks', 'hook'],
    ['utensil holder', 'utensilHolder'], ['utensils', 'utensilHolder'], ['utensel holder', 'utensilHolder'],
    ['spoon holder', 'utensilHolder'],
  ];
  for (const [input, template] of cases) {
    it(`"${input}" loads ${template}`, () => {
      const r = parseCommand(input);
      expect('template' in r && r.template).toBe(template);
    });
  }

  it('keeps a size number on the template', () => {
    expect(parseCommand('cup grip 80')).toEqual({ template: 'cupGrip', params: { cupDiameterMm: 80 } });
  });

  it('does not hijack ordinary edit commands', () => {
    expect(parseCommand('add a box')).toMatchObject({ op: 'add', shape: 'box' });
    expect(parseCommand('move left 10')).toMatchObject({ op: 'move' });
    expect(parseCommand('rotate 45')).toMatchObject({ op: 'rotate' });
    expect(parseCommand('make it taller by 5')).toMatchObject({ op: 'scale' });
  });

  it('lists the templates when it cannot parse', () => {
    const r = parseCommand('banana');
    expect('clarify' in r && r.clarify).toContain('cup grip');
  });
});

