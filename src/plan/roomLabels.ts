// Room name + area labels sized to the room as drawn on screen, so labels of
// neighbouring rooms never run into each other (a small phone plan drew
// "StudBedrKitchen"). Pure: the renderer passes the room's screen box.

export interface RoomLabelLayout {
  showName: boolean;
  nameSize: number;
  showArea: boolean;
  areaSize: number;
  /** Baseline offsets from the room centre (px). */
  nameDy: number;
  areaDy: number;
}

/** Rough width of system-ui text: ~0.62 em per character. */
const textWidth = (s: string, size: number): number => s.length * size * 0.62;

export function roomLabelLayout(name: string, area: string, boxW: number, boxH: number): RoomLabelLayout {
  const w = Number.isFinite(boxW) ? boxW - 12 : Infinity;
  const h = Number.isFinite(boxH) ? boxH - 6 : Infinity;
  // The name shrinks to fit the room's width (14 → 9 px); below 9 px it would
  // spill into the next room, so it is left out (the room is still drawn).
  const nameSize = Math.min(14, Math.floor(w / Math.max(1, name.length * 0.62)));
  const showName = !!name && nameSize >= 9 && h >= nameSize;
  const areaSize = Math.min(12, showName ? nameSize : 12);
  // The area only when both lines fit: on small rooms it is hidden.
  const showArea = showName && h >= nameSize + areaSize + 6 && textWidth(area, areaSize) <= w;
  return showArea
    ? { showName, nameSize, showArea, areaSize, nameDy: -4 * (nameSize / 14), areaDy: 14 * (areaSize / 12) }
    : { showName, nameSize: showName ? nameSize : 14, showArea, areaSize, nameDy: nameSize * 0.35, areaDy: 0 };
}
