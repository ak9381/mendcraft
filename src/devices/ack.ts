// DID THE DEVICE ANSWER? (pure). A connector only counts once the real device
// acknowledged a test action. These helpers read a device reply honestly:
// no reply is a failure, an error in the reply is a failure, and when the
// device reports its state we check it matches what we asked for.

import type { ActionVerb } from './connector';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Find an error message anywhere near the top of a reply. */
function errorIn(reply: unknown): string | null {
  if (!isObj(reply)) return null;
  const e = reply.error ?? reply.err;
  if (e !== undefined && e !== null && e !== false) {
    if (typeof e === 'string') return e;
    if (isObj(e) && typeof e.message === 'string') return e.message;
    return JSON.stringify(e).slice(0, 160);
  }
  if (isObj(reply.result) && reply.result.success === false) return 'the device said success: false';
  if (reply.success === false || reply.ok === false) return 'the device said it failed';
  return null;
}

export type Ack = { ok: true; detail: string } | { ok: false; error: string };

/** Was this reply an acknowledgement? HTTP transports throw on non-2xx, so an
 *  HTTP call that returned at all counts; UDP needs a real reply. */
export function ackOf(reply: unknown, transport: 'udp' | 'http'): Ack {
  const err = errorIn(reply);
  if (err) return { ok: false, error: `The device answered with an error: ${err}.` };
  if (transport === 'udp' && (reply === null || reply === undefined || reply === '')) {
    return { ok: false, error: 'No reply from the device (UDP datagram went unanswered). Wrong port, method or payload?' };
  }
  if (transport === 'udp' && typeof reply === 'string') {
    return { ok: false, error: `The device replied with something that is not JSON: ${reply.slice(0, 80)}` };
  }
  return { ok: true, detail: transport === 'http' ? 'HTTP 2xx from the device.' : 'The device replied.' };
}

/** On/off state reported in a reply, if any (WiZ result.state, Shelly ison,
 *  Tasmota POWER, generic on/power). Null when the reply doesn't say. */
export function stateOf(reply: unknown): boolean | null {
  const look = (o: Record<string, unknown>): boolean | null => {
    for (const k of ['state', 'ison', 'on', 'isOn', 'power', 'POWER', 'output']) {
      const v = o[k];
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string' && /^(on|off)$/i.test(v)) return v.toLowerCase() === 'on';
      if (typeof v === 'number' && (v === 0 || v === 1) && k !== 'power') return v === 1;
    }
    return null;
  };
  if (!isObj(reply)) return null;
  const top = look(reply);
  if (top !== null) return top;
  if (isObj(reply.result)) return look(reply.result);
  return null;
}

/** What state a verb should leave the device in (null = no expectation). */
export function expectedState(verb: ActionVerb): boolean | null {
  return verb === 'on' || verb === 'set' ? true : verb === 'off' ? false : null;
}
