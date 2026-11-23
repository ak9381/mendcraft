import { describe, expect, it, vi } from 'vitest';
import { createHandHover, magnetPull, tooltipTextFor } from '../src/ui/handHover';

describe('magnetPull', () => {
  const rect = { x: 100, y: 100, width: 40, height: 20 }; // centre (120, 110)

  it('does not move the point at strength 0', () => {
    expect(magnetPull({ x: 10, y: 10 }, rect, 0)).toEqual({ x: 10, y: 10 });
  });

  it('snaps exactly to the centre at strength 1', () => {
    expect(magnetPull({ x: 10, y: 10 }, rect, 1)).toEqual({ x: 120, y: 110 });
  });

  it('eases partway at a fractional strength', () => {
    const p = magnetPull({ x: 0, y: 0 }, rect, 0.5);
    expect(p).toEqual({ x: 60, y: 55 });
  });

  it('clamps strength outside [0,1]', () => {
    expect(magnetPull({ x: 0, y: 0 }, rect, -1)).toEqual({ x: 0, y: 0 });
    expect(magnetPull({ x: 0, y: 0 }, rect, 5)).toEqual({ x: 120, y: 110 });
  });
});

describe('createHandHover', () => {
  function makeEl(): HTMLElement {
    const classes = new Set<string>();
    return {
      classList: {
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c),
        contains: (c: string) => classes.has(c),
      },
    } as unknown as HTMLElement;
  }

  it('adds the hover class to a new target and removes it from the old one', () => {
    const hover = createHandHover();
    const a = makeEl();
    const b = makeEl();
    hover.setTarget(a);
    expect(a.classList.contains('hand-hover')).toBe(true);
    hover.setTarget(b);
    expect(a.classList.contains('hand-hover')).toBe(false);
    expect(b.classList.contains('hand-hover')).toBe(true);
    expect(hover.current).toBe(b);
  });

  it('clears the class when set back to null', () => {
    const hover = createHandHover();
    const a = makeEl();
    hover.setTarget(a);
    hover.setTarget(null);
    expect(a.classList.contains('hand-hover')).toBe(false);
    expect(hover.current).toBeNull();
  });

  it('is a no-op when re-set to the same element', () => {
    const hover = createHandHover();
    const a = makeEl();
    hover.setTarget(a);
    hover.setTarget(a);
    expect(a.classList.contains('hand-hover')).toBe(true);
  });
});

describe('C046/C-ROBUST hand-user tooltips (tooltipTextFor + onTooltip)', () => {
  function elWith(attrs: Record<string, string>): HTMLElement {
    const classes = new Set<string>();
    return {
      classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c) },
      getAttribute: (n: string) => attrs[n] ?? null,
    } as unknown as HTMLElement;
  }

  it('reads title, then aria-label, then data-tooltip; trims and ignores blanks', () => {
    expect(tooltipTextFor(elWith({ title: 'Close panel' }))).toBe('Close panel');
    expect(tooltipTextFor(elWith({ 'aria-label': 'Mic' }))).toBe('Mic');
    expect(tooltipTextFor(elWith({ 'data-tooltip': ' Hint ' }))).toBe('Hint');
    expect(tooltipTextFor(elWith({ title: '   ' }))).toBeNull();
    expect(tooltipTextFor(elWith({}))).toBeNull();
  });

  it('is defensive on objects with no getAttribute (never throws)', () => {
    expect(tooltipTextFor(null)).toBeNull();
    expect(tooltipTextFor({ classList: {} } as unknown as HTMLElement)).toBeNull();
  });

  it('fires onTooltip with the hint on hover and null when the target clears', () => {
    const onTooltip = vi.fn();
    const hover = createHandHover({ onTooltip });
    const btn = elWith({ title: 'Undo' });
    hover.setTarget(btn);
    expect(onTooltip).toHaveBeenLastCalledWith('Undo', btn);
    hover.setTarget(null);
    expect(onTooltip).toHaveBeenLastCalledWith(null, null);
  });
});
