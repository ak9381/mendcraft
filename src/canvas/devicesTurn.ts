// The on-device (Nano) devices board: ONE short prompt, ONE tiny constrained
// reply. Nano only decides the board's title and which columns the live
// table shows; the board is built here around a `source: 'devices'` table,
// and its rows still come from code (connectedDevices.ts), never the reply.
// It is reviewed like any board. Gemini lays the board out when online.
import { extractJson } from '../ai/cloudJson';
import { DEVICE_FIELDS, type DeviceRow } from './connectedDevices';
import { coerceSurfacePlan, type Coerced, type SurfacePlan } from './surfacePlan';

export const NANO_DEVICES_TITLE_MAX = 24;

/** The JSON schema Chrome's Prompt API enforces (no unsupported keywords). */
export const NANO_DEVICES_CONSTRAINT: Record<string, unknown> = {
  type: 'object', additionalProperties: false, required: ['title', 'fields'],
  properties: {
    title: { type: 'string', maxLength: NANO_DEVICES_TITLE_MAX },
    fields: { type: 'array', items: { type: 'string', enum: [...DEVICE_FIELDS] } },
  },
};

/** The prompt: her words and the rows as words (they never leave the device). */
export function nanoDevicesPrompt(utterance: string, rows: readonly DeviceRow[]): string {
  return [
    'You name one board on a smart home canvas that lists her devices in a table.',
    'Reply with JSON only: {"title": string, "fields": ["device"|"status"|"kind"]}',
    `"title" is at most 4 words. "fields" are the table's columns, in order. The canvas fills the rows itself.`,
    `Devices here now:\n${rows.map((r) => `- ${r.device}${r.kind ? ` (${r.kind})` : ''}: ${r.status}`).join('\n') || '- none yet'}`,
    `She said: "${utterance}"`,
  ].join('\n');
}

/** Nano's reply → the devices board: one live table, checked by the same
 *  coerceSurfacePlan as any board. Anything malformed is refused. */
export function devicesPlanFromNano(text: string): Coerced<SurfacePlan> {
  const raw = extractJson(text);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'The reply was not a devices board.' };
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === 'string' && o.title.trim() && o.title.length <= NANO_DEVICES_TITLE_MAX ? o.title.trim() : null;
  if (!title) return { ok: false, error: 'The reply had no usable title.' };
  return coerceSurfacePlan({ kind: 'room', title, tiles: [{ type: 'table', title: 'Devices', source: 'devices', fields: o.fields }] });
}
