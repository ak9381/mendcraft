import { describe, expect, it } from 'vitest';
import {
  buildStayedLocalStrip, cloudReceivedDetail, formatFooterBytes, handoffReason, logTurnReceipt,
  mountModelPanels, redactLines, MODEL_PANELS_HTML,
} from '../../src/canvas/modelPanels';
import type { Person } from '../../src/privacy/directory';

describe('handoffReason', () => {
  it('formats a Nano → Gemini handoff with its reason', () => {
    expect(handoffReason('nano', 'gemini', 'too complex for on-device')).toBe(
      'Nano → Gemini: too complex for on-device',
    );
  });
  it('formats a Gemini → Nano handoff', () => {
    expect(handoffReason('gemini', 'nano', 'apply 42 label swaps locally')).toBe(
      'Gemini → Nano: apply 42 label swaps locally',
    );
  });
});

const sharma: Person = { id: 'p1', name: 'Sharma', role: 'client', token: '[Client A]', notes: [], createdAt: 0 };

describe('buildStayedLocalStrip', () => {
  it('shows the real name kept locally next to the token sent to the cloud', () => {
    const strip = buildStayedLocalStrip({
      used: [{ token: '[Client A]', personId: 'p1' }],
      people: [sharma],
      bytesSent: 240,
      engine: 'gemini',
      routeLine: 'routed via Mac: Nano cleaned, then Gemini',
    });
    expect(strip.keptLocalLines).toEqual(['[Client A] = Sharma, never left']);
    expect(strip.sentToCloudLines).toEqual(['Gemini saw: [Client A]']);
    expect(strip.bytesLabel).toMatch(/Gemini/);
    expect(strip.routeLabel).toBe('routed via Mac: Nano cleaned, then Gemini');
  });

  it('falls back to honest placeholders when no names were in the turn', () => {
    const strip = buildStayedLocalStrip({
      used: [],
      people: [sharma],
      bytesSent: 0,
      engine: 'nano',
      routeLine: 'cleaned on this device: Nano + rules, then Gemini',
    });
    expect(strip.keptLocalLines).toEqual(['No names in this turn.']);
    expect(strip.sentToCloudLines).toEqual(['Nothing identifying left this device.']);
  });

  it('still names the token when the person record is missing', () => {
    const strip = buildStayedLocalStrip({
      used: [{ token: '[Client B]', personId: 'missing' }],
      people: [sharma],
      bytesSent: 10,
      engine: 'gemini',
      routeLine: 'x',
    });
    expect(strip.keptLocalLines).toEqual(['[Client B], never left']);
  });
});

describe('redactLines', () => {
  it('formats "name → token" for the terminal redact log line', () => {
    expect(redactLines([{ token: '[Client A]', personId: 'p1' }], [sharma])).toEqual(['Sharma → [Client A]']);
  });
  it('falls back to "? → token" when the person record is missing', () => {
    expect(redactLines([{ token: '[Client B]', personId: 'missing' }], [sharma])).toEqual(['? → [Client B]']);
  });
  it('empty when nothing was redacted', () => {
    expect(redactLines([], [sharma])).toEqual([]);
  });
});

/** Minimal hand-rolled fake DOM, matching the style the rest of this suite
 *  uses under Vitest's node environment (no jsdom). */
class FakeEl {
  tag: string;
  className = '';
  hidden = false;
  scrollTop = 0;
  scrollHeight = 0;
  children: FakeEl[] = [];
  get childElementCount() { return this.children.length; }
  attrs: Record<string, string> = {};
  private html = '';
  constructor(tag: string) { this.tag = tag; }
  set innerHTML(v: string) { this.html = v; this.children = []; }
  get innerHTML() { return this.html; }
  append(...nodes: FakeEl[]) { this.children.push(...nodes); }
  appendChild(node: FakeEl) { this.children.push(node); return node; }
  classList = {
    add: (...cs: string[]) => {
      const cur = new Set(this.className.split(/\s+/).filter(Boolean));
      cs.forEach((c) => cur.add(c));
      this.className = [...cur].join(' ');
    },
    remove: (...cs: string[]) => {
      const cur = new Set(this.className.split(/\s+/).filter(Boolean));
      cs.forEach((c) => cur.delete(c));
      this.className = [...cur].join(' ');
    },
    contains: (c: string) => this.className.split(/\s+/).includes(c),
  };
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  querySelector<T = FakeEl>(sel: string): T | null {
    const cls = sel.replace(/^\./, '');
    const walk = (el: FakeEl): FakeEl | null => {
      for (const c of el.children) {
        if (c.className.split(/\s+/).includes(cls)) return c;
        const found = walk(c); if (found) return found;
      }
      return null;
    };
    return (walk(this) as unknown as T) ?? null;
  }
}
const fakeDoc = { createElement: (tag: string) => new FakeEl(tag) } as unknown as Document;

function fakePanel(): HTMLElement {
  const root = new FakeEl('div');
  // Minimal structural stand-in for MODEL_PANELS_HTML — same class names,
  // real nesting isn't needed since FakeEl.querySelector walks all children.
  const build = (engine: string) => {
    const section = new FakeEl('section'); section.className = `mc-terminal mc-terminal-${engine}`;
    const queued = new FakeEl('span'); queued.className = 'mc-term-queued'; queued.hidden = true;
    const body = new FakeEl('div'); body.className = 'mc-term-body';
    const lines = new FakeEl('div'); lines.className = 'mc-term-lines';
    const empty = new FakeEl('p'); empty.className = 'mc-term-empty'; empty.textContent = 'Not used for this draft.';
    const cursor = new FakeEl('span'); cursor.className = 'mc-term-cursor'; cursor.hidden = true;
    body.append(lines, empty, cursor);
    section.append(queued, body);
    return section;
  };
  const panels = new FakeEl('div'); panels.className = 'mc-terminals'; panels.hidden = true;
  panels.append(build('nano'), build('gemini'));
  const footerBytes = new FakeEl('span'); footerBytes.className = 'mc-ai-footer-bytes';
  const footer = new FakeEl('p'); footer.className = 'mc-ai-footer'; footer.hidden = true;
  footer.append(footerBytes);
  root.append(panels, footer);
  return root as unknown as HTMLElement;
}

describe('mountModelPanels — terminal log lines', () => {
  it('show() unhides the terminals', () => {
    const aiPanel = fakePanel();
    const panels = mountModelPanels(aiPanel, fakeDoc);
    panels.show();
    expect((aiPanel as unknown as FakeEl).querySelector('.mc-terminals')!.hidden).toBe(false);
  });

  it('log() appends a timestamped line with the right verb and detail', () => {
    const aiPanel = fakePanel();
    const panels = mountModelPanels(aiPanel, fakeDoc);
    panels.forEngine('nano').log('received', 'connect devices and make a dashboard');
    const lines = (aiPanel as unknown as FakeEl).querySelector('.mc-terminal-nano')!.querySelector('.mc-term-lines')!;
    expect(lines.children.length).toBe(1);
    expect(lines.children[0].className).toContain('mc-term-line--received');
    expect(lines.children[0].innerHTML).toContain('connect devices and make a dashboard');
    expect(lines.children[0].innerHTML).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('log() shows the blinking cursor except for done/replied', () => {
    const aiPanel = fakePanel();
    const panels = mountModelPanels(aiPanel, fakeDoc);
    const nanoTerm = (aiPanel as unknown as FakeEl).querySelector('.mc-terminal-nano')!;
    const cursor = nanoTerm.querySelector('.mc-term-cursor')!;
    panels.forEngine('nano').log('received', 'x');
    expect(cursor.hidden).toBe(false);
    panels.forEngine('nano').log('done', '4 tiles filled');
    expect(cursor.hidden).toBe(true);
  });

  it('an engine with no lines shows a “not used for this draft” empty state', () => {
    const aiPanel = fakePanel();
    const panels = mountModelPanels(aiPanel, fakeDoc);
    const gemini = (aiPanel as unknown as FakeEl).querySelector('.mc-terminal-gemini')!;
    const empty = gemini.querySelector('.mc-term-empty')!;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toMatch(/not used for this draft/i);
    panels.forEngine('gemini').log('received', 'layout the room');
    expect(empty.hidden).toBe(true);
  });

  it('showHandoff writes a line into BOTH terminals, with opposite directionality', () => {
    const aiPanel = fakePanel();
    const panels = mountModelPanels(aiPanel, fakeDoc);
    panels.showHandoff('nano', 'group the lights and add a room plan');
    const nanoLines = (aiPanel as unknown as FakeEl).querySelector('.mc-terminal-nano')!.querySelector('.mc-term-lines')!;
    const geminiLines = (aiPanel as unknown as FakeEl).querySelector('.mc-terminal-gemini')!.querySelector('.mc-term-lines')!;
    expect(nanoLines.children[0].innerHTML).toContain('→ gemini: group the lights and add a room plan');
    expect(geminiLines.children[0].innerHTML).toContain('← nano: group the lights and add a room plan');
  });

  it('setQueued logs a line only when count is positive', () => {
    const aiPanel = fakePanel();
    const panels = mountModelPanels(aiPanel, fakeDoc);
    const lines = (aiPanel as unknown as FakeEl).querySelector('.mc-terminal-nano')!.querySelector('.mc-term-lines')!;
    panels.forEngine('nano').setQueued(0);
    expect(lines.children.length).toBe(0);
    panels.forEngine('nano').setQueued(2);
    expect(lines.children.length).toBe(1);
    expect(lines.children[0].innerHTML).toContain('2 requests queued offline');
  });

  it('singular wording for exactly one queued request', () => {
    const aiPanel = fakePanel();
    const panels = mountModelPanels(aiPanel, fakeDoc);
    const lines = (aiPanel as unknown as FakeEl).querySelector('.mc-terminal-nano')!.querySelector('.mc-term-lines')!;
    panels.forEngine('nano').setQueued(1);
    expect(lines.children[0].innerHTML).toContain('1 request queued offline — will run on reconnect.');
    expect(lines.children[0].innerHTML).not.toContain('requests');
  });

  it('setQueued also shows a stable head badge, independent of the scrolling log — ' +
    'readable even after later turns log more lines, and cleared once the queue drains', () => {
    const aiPanel = fakePanel();
    const panels = mountModelPanels(aiPanel, fakeDoc);
    const nano = (aiPanel as unknown as FakeEl).querySelector('.mc-terminal-nano')!;
    const badge = nano.querySelector('.mc-term-queued')!;
    expect(badge.hidden).toBe(true);

    panels.forEngine('nano').setQueued(1);
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toContain('1 request queued offline — will run on reconnect.');

    // An unrelated later turn logs more lines into the same scrolling body —
    // the badge (outside .mc-term-lines) must still read "1 queued".
    panels.forEngine('nano').log('received', 'an unrelated turn');
    panels.forEngine('nano').log('done', 'done');
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toContain('1 request queued offline — will run on reconnect.');

    // Reconnecting drains the queue to 0 — the badge must actually clear,
    // not stay stuck (setQueued(0) used to bail out before touching it).
    panels.forEngine('nano').setQueued(0);
    expect(badge.hidden).toBe(true);
  });

  it('never fabricates work on the engine that did not log anything', () => {
    const aiPanel = fakePanel();
    const panels = mountModelPanels(aiPanel, fakeDoc);
    panels.forEngine('nano').log('received', 'x');
    panels.forEngine('nano').log('done', 'done');
    const geminiLines = (aiPanel as unknown as FakeEl).querySelector('.mc-terminal-gemini')!.querySelector('.mc-term-lines')!;
    expect(geminiLines.children.length).toBe(0);
  });
});

describe('MODEL_PANELS_HTML', () => {
  it('ships one terminal per engine plus a swarm dock under each', () => {
    expect(MODEL_PANELS_HTML).toContain('mc-terminal-nano');
    expect(MODEL_PANELS_HTML).toContain('mc-terminal-gemini');
    expect(MODEL_PANELS_HTML).toContain('mc-term-dock');
    expect(MODEL_PANELS_HTML).not.toContain('mc-handoff-card');
    expect(MODEL_PANELS_HTML).not.toContain('mc-stayed-local');
  });
  it('ships one footer spanning both terminals, not a second card', () => {
    expect(MODEL_PANELS_HTML).toContain('mc-ai-footer');
    expect((MODEL_PANELS_HTML.match(/mc-ai-footer"/g) ?? []).length).toBe(1);
  });
});

describe('formatFooterBytes', () => {
  it('formats bytes, KB and MB generically (no engine name)', () => {
    expect(formatFooterBytes(0)).toBe('0 B sent to cloud');
    expect(formatFooterBytes(412)).toBe('412 B sent to cloud');
    expect(formatFooterBytes(2048)).toBe('2.0 KB sent to cloud');
    expect(formatFooterBytes(2 * 1024 * 1024)).toBe('2.0 MB sent to cloud');
  });
});

describe('mountModelPanels — footer', () => {
  it('setFooterBytes writes the live count; show() unhides it', () => {
    const aiPanel = fakePanel();
    const panels = mountModelPanels(aiPanel, fakeDoc);
    const footer = (aiPanel as unknown as FakeEl).querySelector('.mc-ai-footer')!;
    expect(footer.hidden).toBe(true);
    panels.setFooterBytes(412);
    expect((footer.querySelector('.mc-ai-footer-bytes') as unknown as { textContent: string }).textContent).toBe('412 B sent to cloud');
    panels.show();
    expect(footer.hidden).toBe(false);
  });
});

describe('cloudReceivedDetail', () => {
  const sharma: Person = { id: 'p1', name: 'Sharma', role: 'client', token: '[Client A]', notes: [], createdAt: 0 };
  it('passes through an already-redacted payload', () => {
    expect(cloudReceivedDetail('Dashboard for [Client A]: bulb, plug', [sharma])).toBe('Dashboard for [Client A]: bulb, plug');
  });
  it('throws rather than let a raw name reach the Gemini terminal', () => {
    expect(() => cloudReceivedDetail('Dashboard for Sharma: bulb, plug', [sharma])).toThrow();
  });
});

describe('logTurnReceipt — privacy order invariant', () => {
  const sharma: Person = { id: 'p1', name: 'Sharma', role: 'client', token: '[Client A]', notes: [], createdAt: 0 };

  it('logs Nano received + redact before Gemini ever receives anything', () => {
    const aiPanel = fakePanel();
    const panels = mountModelPanels(aiPanel, fakeDoc);
    logTurnReceipt(panels, {
      engine: 'gemini',
      utterance: 'dashboard for Mrs Sharma',
      used: [{ token: '[Client A]', personId: 'p1' }],
      people: [sharma],
      cloudPayload: 'Dashboard for [Client A]: bulb, plug',
    });
    const nanoLines = (aiPanel as unknown as FakeEl).querySelector('.mc-terminal-nano')!.querySelector('.mc-term-lines')!;
    const geminiLines = (aiPanel as unknown as FakeEl).querySelector('.mc-terminal-gemini')!.querySelector('.mc-term-lines')!;
    expect(nanoLines.children.map((c) => c.className)).toEqual([
      'mc-term-line mc-term-line--received',
      'mc-term-line mc-term-line--redact',
    ]);
    expect(nanoLines.children[1].innerHTML).toContain('Sharma → [Client A]');
    expect(geminiLines.children.length).toBe(1);
    expect(geminiLines.children[0].innerHTML).toContain('[Client A]');
    expect(geminiLines.children[0].innerHTML).not.toMatch(/Sharma/);
  });

  it('never writes to Gemini when Nano is the engine that ran', () => {
    const aiPanel = fakePanel();
    const panels = mountModelPanels(aiPanel, fakeDoc);
    logTurnReceipt(panels, {
      engine: 'nano', utterance: 'floor plan for Mrs Sharma', used: [{ token: '[Client A]', personId: 'p1' }],
      people: [sharma], cloudPayload: 'unused',
    });
    const geminiLines = (aiPanel as unknown as FakeEl).querySelector('.mc-terminal-gemini')!.querySelector('.mc-term-lines')!;
    expect(geminiLines.children.length).toBe(0);
  });

  it('refuses to log a leaked raw name even if a caller mis-assembles cloudPayload', () => {
    const aiPanel = fakePanel();
    const panels = mountModelPanels(aiPanel, fakeDoc);
    expect(() => logTurnReceipt(panels, {
      engine: 'gemini', utterance: 'dashboard for Mrs Sharma', used: [{ token: '[Client A]', personId: 'p1' }],
      people: [sharma], cloudPayload: 'Dashboard for Sharma: bulb, plug',
    })).toThrow();
  });
});

describe('EnginePanelUi.fail (blink red)', () => {
  it('logs a fail line and marks the terminal is-failing', () => {
    const root = fakePanel();
    const nano = root.querySelector('.mc-terminal-nano');
    const panels = mountModelPanels(root, fakeDoc);
    panels.forEngine('gemini').fail('Went offline mid-request — the last board is unchanged.');
    const gemini = root.querySelector('.mc-terminal-gemini') as any;
    expect(gemini.className).toContain('is-failing');
    const lines = gemini.querySelector('.mc-term-lines');
    expect(lines.children[0].className).toContain('mc-term-line--fail');
    expect(lines.children[0].innerHTML).toContain('Went offline mid-request');
  });
});

describe('mountModelPanels — settle() tells the AI feed', () => {
  it('publishes Done only for an engine the feed last saw Working, once', () => {
    const sent: Array<{ kind: string; engine?: string; state?: string }> = [];
    const feed = { publish: (m: { kind: string }) => { sent.push(m as never); }, onHello: () => {} };
    const panels = mountModelPanels(fakePanel(), fakeDoc, undefined, feed);
    panels.forEngine('nano').log('received', 'add kannada');
    panels.forEngine('gemini').log('replied', 'Kannada pack ready · 19 swaps');
    sent.length = 0;
    panels.settle();
    expect(sent).toEqual([{ kind: 'state', engine: 'nano', state: 'done' }]);
    panels.settle();
    expect(sent).toHaveLength(1);
  });
});
