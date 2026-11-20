// A clean example of what Gemini can now compose: a multi-section home
// energy & room-control dashboard (stats, a chart, tabs holding a table and
// a form, a custom room-zone VisualTile, and one ordinary device tile so it
// still feels like Mendcraft) — not a flat row of six device tiles. Opt-in
// only (`?showcase=energy`); never part of the default/demo boot paths.
import { CANVAS_DOC_VERSION, createFrameRegistry, type CanvasDoc } from './frames';
import { coerceSurfacePlan, type SurfacePlan } from './surfacePlan';

const ROOM_ZONE_MARKUP = `
<svg viewBox="0 0 220 140" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="2" width="106" height="66" fill="#F1EEE6" stroke="#E4E0D8" stroke-width="2" data-action="zone-living" data-label="Living room zone" />
  <text x="10" y="20" fill="#2B2B2B" font-size="12" font-weight="700">Living room</text>
  <text x="10" y="36" fill="#6B8F71" font-size="11">2 lamps on</text>
  <rect x="112" y="2" width="106" height="66" fill="#F1EEE6" stroke="#E4E0D8" stroke-width="2" data-action="zone-bedroom" data-label="Bedroom zone" />
  <text x="120" y="20" fill="#2B2B2B" font-size="12" font-weight="700">Bedroom</text>
  <text x="120" y="36" fill="#6E6A63" font-size="11">Lights off</text>
  <rect x="2" y="72" width="216" height="66" fill="#F1EEE6" stroke="#E4E0D8" stroke-width="2" data-action="zone-kitchen" data-label="Kitchen zone" />
  <text x="10" y="90" fill="#2B2B2B" font-size="12" font-weight="700">Kitchen</text>
  <text x="10" y="106" fill="#C98B3C" font-size="11">Water heater running</text>
</svg>`.trim();

const RAW_ENERGY_PLAN = {
  kind: 'room',
  title: 'Home energy',
  tiles: [
    {
      type: 'grid',
      columns: 3,
      children: [
        { type: 'stat', label: 'Power now', value: '1.4 kW', delta: '+6%', trend: 'up', spark: [1.1, 1.0, 1.3, 1.2, 1.5, 1.3, 1.4] },
        { type: 'stat', label: 'Cost today', value: '$3.80', delta: '+$0.20', trend: 'neutral', spark: [0.4, 0.9, 1.6, 2.1, 2.8, 3.3, 3.8] },
        { type: 'stat', label: 'Comfort', value: '72°F', delta: '-2°', trend: 'down', spark: [75, 74, 74, 73, 73, 72, 72] },
      ],
    },
    {
      type: 'tabs',
      tabs: [
        { label: 'Usage', children: [{ type: 'chart', title: 'This week (kWh)', chartType: 'bar', series: [
          { label: 'Mon', value: 9 }, { label: 'Tue', value: 11 }, { label: 'Wed', value: 8 },
          { label: 'Thu', value: 13 }, { label: 'Fri', value: 10 }, { label: 'Sat', value: 14 }, { label: 'Sun', value: 12 },
        ] }] },
        { label: 'Devices', children: [{ type: 'table', title: 'Devices', columns: ['Device', 'Status'], rows: [
          ['Desk lamp', 'On'], ['Ceiling light', 'Off'], ['Water heater', 'Running'], ['Thermostat', '72°F'],
        ], sortable: true, rowActionLabel: 'Open' }] },
        { label: 'Settings', children: [{ type: 'form', title: 'Climate settings', submitLabel: 'Apply', fields: [
          { kind: 'toggle', id: 'eco', label: 'Eco mode', value: true },
          { kind: 'slider', id: 'target', label: 'Target temperature', value: 72, min: 60, max: 80 },
          { kind: 'choice', id: 'mode', label: 'Mode', options: ['Auto', 'Manual', 'Away'], value: 'Auto' },
        ] }] },
      ],
    },
    { type: 'card', title: 'Room zones', children: [{ type: 'visual', title: 'Tap a zone', markup: ROOM_ZONE_MARKUP }] },
    { type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' },
  ],
};

function buildEnergyShowcasePlan(): SurfacePlan {
  const coerced = coerceSurfacePlan(RAW_ENERGY_PLAN);
  if (!coerced.ok) throw new Error(`showcaseFixture: energy plan failed validation — ${coerced.error}`);
  return coerced.value;
}

export function buildEnergyShowcaseDoc(): CanvasDoc {
  const reg = createFrameRegistry();
  const board = reg.add('room', 'Home energy');
  return {
    version: CANVAS_DOC_VERSION,
    camera: { x: 0, y: 0, z: 1 },
    focusId: board.id,
    frames: reg.list(),
    surfaces: { [board.id]: buildEnergyShowcasePlan() },
  };
}
