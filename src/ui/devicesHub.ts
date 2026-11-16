// "Connect anything" tray (DOM). Pure data comes from devices/hub.ts.
// Big targets (pinch-friendly), plain words, honest about what needs internet.

import type { HubCard } from '../devices/hub';

export interface DevicesHubServices {
  onLink(id: string): void;
  onAddNew(): void;
  onSpeaker(brand: string): void;
}

export interface DevicesHub {
  element: HTMLElement;
  render(cards: HubCard[], online: boolean): void;
  setNote(text: string | null, link?: string): void;
  show(on: boolean): void;
}

const GROUPS: { id: HubCard['group']; title: string; empty?: string }[] = [
  { id: 'ready', title: 'Ready to connect' },
  { id: 'saved', title: 'Saved connectors (work offline)', empty: 'Nothing saved yet. Add a lamp and Gemini writes its connector once.' },
  { id: 'speaker', title: 'Speakers', empty: 'Marshall, Bose, JBL and similar play through Spotify Connect.' },
];

export function createDevicesHub(svc: DevicesHubServices): DevicesHub {
  const root = document.createElement('aside');
  root.className = 'mc-hub';
  root.setAttribute('aria-label', 'Connect anything');
  root.hidden = true;

  const head = document.createElement('div');
  head.className = 'mc-hub-head';
  const title = document.createElement('h2');
  title.textContent = 'Connect anything';
  const sub = document.createElement('p');
  sub.className = 'mc-hub-sub';
  sub.textContent = 'Start with a blank drawing. Add the devices in the room one by one.';
  head.append(title, sub);

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'mc-hub-add';
  add.textContent = '+ Add a device';
  add.title = 'Point a camera at it or say its name. Gemini writes a connector once; you pinch to confirm.';
  add.addEventListener('click', () => svc.onAddNew());

  const note = document.createElement('div');
  note.className = 'mc-hub-note';
  note.hidden = true;

  const body = document.createElement('div');
  body.className = 'mc-hub-body';

  root.append(head, add, note, body);

  function card(c: HubCard): HTMLElement {
    const el = document.createElement('div');
    el.className = `mc-hub-card mc-hub-${c.state}`;
    const top = document.createElement('div');
    top.className = 'mc-hub-card-top';
    const name = document.createElement('strong');
    name.textContent = c.name;
    const state = document.createElement('span');
    state.className = 'mc-hub-state';
    state.textContent = c.state === 'connected' ? 'Connected' : c.state === 'ready' ? 'Ready' : 'Not yet';
    top.append(name, state);
    const detail = document.createElement('p');
    detail.textContent = c.detail;
    el.append(top, detail);
    if (c.action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mc-cp-btn';
      b.textContent = c.action;
      b.addEventListener('click', () => svc.onLink(c.id));
      el.append(b);
    }
    return el;
  }

  function speakerForm(online: boolean): HTMLElement {
    const f = document.createElement('form');
    f.className = 'mc-hub-speaker';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'Marshall';
    input.setAttribute('aria-label', 'Speaker brand');
    const b = document.createElement('button');
    b.type = 'submit';
    b.className = 'mc-cp-btn';
    b.textContent = 'Connect speaker';
    b.disabled = !online;
    if (!online) b.title = 'Spotify Connect needs internet.';
    f.append(input, b);
    f.addEventListener('submit', (e) => { e.preventDefault(); svc.onSpeaker(input.value.trim()); });
    return f;
  }

  return {
    element: root,
    render(cards, online) {
      body.replaceChildren();
      for (const g of GROUPS) {
        const sec = document.createElement('section');
        sec.className = 'mc-hub-sec';
        const h = document.createElement('h3');
        h.textContent = g.title;
        sec.append(h);
        const list = cards.filter((c) => c.group === g.id);
        for (const c of list) sec.append(card(c));
        if (!list.length && g.empty) {
          const p = document.createElement('p');
          p.className = 'mc-hub-empty';
          p.textContent = g.empty;
          sec.append(p);
        }
        if (g.id === 'speaker') sec.append(speakerForm(online));
        body.append(sec);
      }
    },
    setNote(text, link) {
      note.replaceChildren();
      note.hidden = !text;
      if (!text) return;
      const p = document.createElement('p');
      p.textContent = text;
      note.append(p);
      if (link) {
        const a = document.createElement('a');
        a.href = link;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = link;
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'mc-cp-btn ghost';
        copy.textContent = 'Copy link';
        copy.addEventListener('click', () => { void navigator.clipboard?.writeText(link).then(() => { copy.textContent = 'Copied'; }).catch(() => undefined); });
        note.append(a, copy);
      }
    },
    show(on) { root.hidden = !on; },
  };
}
