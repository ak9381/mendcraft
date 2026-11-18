// Small on-device people directory. Opened from More. Nothing here is synced.

import { PERSON_ROLES, type Directory, type Person, type PersonRole } from '../privacy/directory';

export interface DirectoryPanel {
  readonly element: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  refresh(): void;
}

const ROLE_LABEL: Record<PersonRole, string> = {
  client: 'Client',
  mother: 'Mother',
  contractor: 'Contractor',
  other: 'Other',
};

export function createDirectoryPanel(dir: Directory): DirectoryPanel {
  const root = document.createElement('section');
  root.className = 'mc-dir-panel';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-labelledby', 'mc-dir-title');

  const head = document.createElement('div');
  head.className = 'mc-panel-head';
  const title = document.createElement('h2');
  title.id = 'mc-dir-title';
  title.textContent = 'Directory';
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'mc-panel-x';
  x.textContent = '✕';
  x.setAttribute('aria-label', 'Close directory');
  x.addEventListener('click', () => close());
  head.append(title, x);

  const lead = document.createElement('p');
  lead.className = 'mc-panel-note';
  lead.textContent = 'People stay on this device. When something goes to Gemini, each person becomes a stable token such as [Client A]. Names are filled back in here, including in email drafts.';

  const list = document.createElement('ul');
  list.className = 'mc-dir-list';

  const form = document.createElement('form');
  form.className = 'mc-dir-form';
  form.setAttribute('aria-label', 'Add a person');
  const name = field(form, 'Name', 'text', 'Priya Sharma', true);
  const role = document.createElement('select');
  role.setAttribute('aria-label', 'Role');
  for (const r of PERSON_ROLES) {
    const o = document.createElement('option');
    o.value = r;
    o.textContent = ROLE_LABEL[r];
    role.append(o);
  }
  const roleRow = document.createElement('label');
  roleRow.className = 'mc-dir-field';
  roleRow.append(Object.assign(document.createElement('span'), { textContent: 'Role' }), role);
  form.append(roleRow);
  const phone = field(form, 'Phone (optional)', 'tel', '+91 …');
  const email = field(form, 'Email (optional)', 'email', 'name@example.com');
  const note = field(form, 'Note or quote (optional)', 'text', 'Wants a wider door');
  const add = document.createElement('button');
  add.type = 'submit';
  add.className = 'mc-cp-btn mc-cp-accept';
  add.textContent = 'Add person';
  form.append(add);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    try {
      dir.add({
        name: name.value,
        role: role.value as PersonRole,
        phone: phone.value || undefined,
        email: email.value || undefined,
        note: note.value || undefined,
      });
      name.value = '';
      phone.value = '';
      email.value = '';
      note.value = '';
      refresh();
    } catch (err) {
      name.setCustomValidity(err instanceof Error ? err.message : 'Could not add');
      name.reportValidity();
    }
  });

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'mc-cp-btn ghost mc-dir-clear';
  clear.textContent = 'Clear directory';
  clear.addEventListener('click', () => {
    if (dir.people().length && !confirm('Remove everyone from the on-device directory? This cannot be undone.')) return;
    dir.clear();
    refresh();
  });

  root.append(head, lead, list, form, clear);
  dir.subscribe(() => { if (!root.hidden) refresh(); });

  function row(p: Person): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'mc-dir-person';
    const top = document.createElement('div');
    top.className = 'mc-dir-person-top';
    const who = document.createElement('strong');
    who.textContent = p.name;
    const tok = document.createElement('code');
    tok.textContent = p.token;
    top.append(who, tok);
    const meta = document.createElement('p');
    meta.className = 'mc-panel-note';
    const bits = [ROLE_LABEL[p.role]];
    if (p.phone) bits.push(p.phone);
    if (p.email) bits.push(p.email);
    meta.textContent = bits.join(' · ');
    li.append(top, meta);
    for (const n of p.notes) {
      const q = document.createElement('p');
      q.className = 'mc-dir-quote';
      q.textContent = n;
      li.append(q);
    }
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'ghost';
    rm.textContent = 'Remove';
    rm.setAttribute('aria-label', `Remove ${p.name}`);
    rm.addEventListener('click', () => { dir.remove(p.id); refresh(); });
    li.append(rm);
    return li;
  }

  function refresh(): void {
    const people = dir.people();
    list.replaceChildren();
    if (!people.length) {
      const empty = document.createElement('li');
      empty.className = 'mc-panel-note';
      empty.textContent = 'No people yet. Add a client, relative, or contractor. They never leave this device.';
      list.append(empty);
    } else {
      for (const p of people) list.append(row(p));
    }
    clear.hidden = people.length === 0;
  }

  function open(): void { root.hidden = false; refresh(); }
  function close(): void { root.hidden = true; }

  return {
    element: root,
    open,
    close,
    toggle() { if (root.hidden) open(); else close(); },
    isOpen: () => !root.hidden,
    refresh,
  };
}

function field(form: HTMLElement, label: string, type: string, placeholder: string, required = false): HTMLInputElement {
  const wrap = document.createElement('label');
  wrap.className = 'mc-dir-field';
  const cap = document.createElement('span');
  cap.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  input.placeholder = placeholder;
  input.required = required;
  wrap.append(cap, input);
  form.append(wrap);
  return input;
}
