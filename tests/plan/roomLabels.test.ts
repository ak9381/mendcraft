import { describe, expect, it } from 'vitest';
import { roomLabelLayout } from '../../src/plan/roomLabels';

describe('roomLabelLayout', () => {
  it('a roomy room keeps the usual name + area labels', () => {
    expect(roomLabelLayout('Studio', '24.00 m²', 300, 200)).toEqual({ showName: true, nameSize: 14, showArea: true, areaSize: 12, nameDy: -4, areaDy: 14 });
    // No screen box known (not a closed loop): unchanged too.
    expect(roomLabelLayout('Studio', '24.00 m²', Infinity, Infinity)).toMatchObject({ nameSize: 14, showArea: true });
  });
  it('a narrow room shrinks its name to the room width', () => {
    const L = roomLabelLayout('Bedroom', '12.00 m²', 70, 120);
    expect(L.showName).toBe(true);
    expect(L.nameSize).toBeLessThan(14);
    expect(L.nameSize * 0.62 * 'Bedroom'.length).toBeLessThanOrEqual(70 - 12);
  });
  it('a small room drops the area line first, then the name', () => {
    expect(roomLabelLayout('Kitchen', '12.00 m²', 80, 26)).toMatchObject({ showName: true, showArea: false });
    expect(roomLabelLayout('Kitchen', '12.00 m²', 40, 30)).toMatchObject({ showName: false, showArea: false });
  });
});
