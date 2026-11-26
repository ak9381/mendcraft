// Our validation gate. A2UI's MessageProcessor accepted an unknown component
// type in the box probe, so EVERY message is checked here first: known message
// kinds only, known components only, each component's props against its Zod
// schema (strict), and only our catalog id.
import type { ZodTypeAny } from 'zod';
import { PROTOCOL, ROOM_CATALOG_ID, type A2uiMessage } from './surfacePlan';

export type GateResult = { ok: true; messages: A2uiMessage[] } | { ok: false; errors: string[] };

const KINDS = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface'] as const;
const MAX_COMPONENTS = 64;

export function gateMessages(raw: unknown, schemas: Record<string, ZodTypeAny>): GateResult {
  const errors: string[] = [];
  if (!Array.isArray(raw)) return { ok: false, errors: ['messages must be a list'] };
  raw.forEach((m, i) => {
    if (!m || typeof m !== 'object') { errors.push(`#${i}: not an object`); return; }
    const msg = m as Record<string, unknown>;
    if (msg.version !== PROTOCOL) errors.push(`#${i}: version must be ${PROTOCOL}`);
    const kinds = KINDS.filter((k) => k in msg);
    const extra = Object.keys(msg).filter((k) => k !== 'version' && !(KINDS as readonly string[]).includes(k));
    if (kinds.length !== 1 || extra.length) { errors.push(`#${i}: exactly one known message kind`); return; }
    const body = msg[kinds[0]] as Record<string, unknown> | undefined;
    if (!body || typeof body.surfaceId !== 'string') { errors.push(`#${i}: surfaceId missing`); return; }
    if (kinds[0] === 'createSurface' && body.catalogId !== ROOM_CATALOG_ID) errors.push(`#${i}: unknown catalog`);
    if (kinds[0] === 'updateComponents') {
      const comps = body.components;
      if (!Array.isArray(comps) || comps.length > MAX_COMPONENTS) { errors.push(`#${i}: bad component list`); return; }
      comps.forEach((c, j) => {
        const comp = c as Record<string, unknown>;
        const name = typeof comp?.component === 'string' ? comp.component : '';
        const schema = schemas[name];
        if (!schema) { errors.push(`#${i}.${j}: unknown component "${name}"`); return; }
        if (typeof comp.id !== 'string' || !comp.id) { errors.push(`#${i}.${j}: id missing`); return; }
        const { id: _id, component: _c, ...props } = comp;
        const r = schema.safeParse(props);
        if (!r.success) errors.push(`#${i}.${j}: ${name} props invalid: ${r.error.issues.map((x) => x.path.join('.') || x.message).join(', ')}`);
      });
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true, messages: raw as A2uiMessage[] };
}
