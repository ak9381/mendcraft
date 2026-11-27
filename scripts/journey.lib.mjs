// journey.lib.mjs — the demo journey of spec §10, as the lines she says. Used
// by the whole-journey e2e (scripts/e2e-actual.mjs, section "journey") and by
// the recorder (scripts/record-fixtures.mjs), so a recording answers exactly
// the turns a replay of the journey asks for, in the same order.

/** The SIM devices of the journey (test build + ?sim=1 only). The ids are
 *  fixture ids, never a real device's: a Nano reply that names a device can
 *  only name one of these. The stand counts once the SIM iPhone is paired. */
export const JOURNEY_DEVICES = [
  { id: 'wiz-lamp-1', cls: 'lamp', label: 'Lamp' },
  { id: 'speaker-sim', cls: 'music', label: 'Speaker', volume: 50 },
  { id: 'gimbal', cls: 'gimbal', label: 'Gimbal' },
];

/** What she says, beat by beat. `review: true` — the line opens a review
 *  that she approves. `offline: true` — said with the canvas offline. */
export const JOURNEY_LINES = [
  { beat: 'pair', say: 'connect devices' },
  { beat: 'devices', say: 'show my devices', review: true },
  { beat: 'dashboard', say: 'build the dashboard', review: true },
  { beat: 'connector', say: 'connect the lamp', review: true },
  { beat: 'floorplan', say: 'draw a two bedroom floor plan', review: true },
  { beat: 'planEdit', say: 'add a study next to bedroom 2', review: true },
  { beat: 'offline', say: 'show my devices', review: true, offline: true },
  { beat: 'language', say: 'add Kannada', review: true },
  { beat: 'english', say: 'switch to English' },
  { beat: 'break', say: 'set the lamp to 500 percent' },
];

export const line = (beat) => {
  const l = JOURNEY_LINES.find((x) => x.beat === beat);
  if (!l) throw new Error(`journey: no beat "${beat}"`);
  return l.say;
};
