// On-device people directory for privacy (pseudonymisation). IndexedDB only;
// never synced. Cloud payloads get a stable token per person; answers and
// email drafts are filled back in on the device before she sees them.

import { redactForCloud } from '../ai/redact';
import { FILLED_ON_DEVICE_SUFFIX } from '../ux/wording';

export { FILLED_ON_DEVICE_SUFFIX };

export type PersonRole = 'client' | 'mother' | 'contractor' | 'other';

export const PERSON_ROLES: readonly PersonRole[] = ['client', 'mother', 'contractor', 'other'];

export interface Person {
  id: string;
  name: string;
  role: PersonRole;
  /** Stable token, assigned once when the person is added. e.g. [Client A]. */
  token: string;
  phone?: string;
  email?: string;
  /** Notes or quotes — "who said what". Kept on device. */
  notes: string[];
  createdAt: number;
}

export interface ProtectResult {
  text: string;
  used: { token: string; personId: string }[];
  names: number;
  details: number;
}

export interface FillResult {
  text: string;
  filled: number;
}

const ROLE_LABEL: Record<PersonRole, string> = {
  client: 'Client',
  mother: 'Mother',
  contractor: 'Contractor',
  other: 'Person',
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Next unused stable token for this role, given the people already stored. */
export function nextToken(role: PersonRole, existing: readonly Person[]): string {
  const used = new Set(existing.filter((p) => p.role === role).map((p) => p.token));
  const label = ROLE_LABEL[role];
  if (role === 'other') {
    for (let n = 1; n <= 99; n++) {
      const t = `[Person ${n}]`;
      if (!used.has(t)) return t;
    }
    return `[Person ${existing.filter((p) => p.role === 'other').length + 1}]`;
  }
  if (role === 'mother' && !used.has('[Mother]')) return '[Mother]';
  const start = role === 'mother' ? 1 : 0; // Mother B after a bare [Mother]
  for (let i = start; i < LETTERS.length; i++) {
    const t = `[${label} ${LETTERS[i]}]`;
    if (!used.has(t)) return t;
  }
  return `[${label} ${existing.filter((p) => p.role === role).length + 1}]`;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceAllCI(hay: string, needle: string, token: string): { text: string; count: number } {
  if (!needle.trim()) return { text: hay, count: 0 };
  const re = new RegExp(`\\b${escapeRegExp(needle)}\\b`, 'gi');
  let count = 0;
  const text = hay.replace(re, () => {
    count += 1;
    return token;
  });
  return { text, count };
}

/**
 * Replace known people (name, phone, email) with their stable tokens, then
 * run the rules-first redactor for anything left over. Directory tokens are
 * stable across calls; leftover unknown details still become [name]/[phone]/
 * [email]. Idempotent on already-tokenized text.
 */
export function protectForCloud(
  text: string,
  people: readonly Person[],
  planNames: string[] = [],
): ProtectResult {
  let out = text;
  const usedMap = new Map<string, string>(); // token → personId
  let names = 0;
  let details = 0;

  // Longest names first so "Priya Rao" wins over "Priya".
  const byNameLen = [...people].sort((a, b) => b.name.length - a.name.length);
  for (const p of byNameLen) {
    const r = replaceAllCI(out, p.name, p.token);
    if (r.count) {
      out = r.text;
      names += r.count;
      usedMap.set(p.token, p.id);
    }
  }
  for (const p of people) {
    if (p.phone) {
      const digits = p.phone.replace(/\D/g, '');
      if (digits.length >= 10) {
        const flex = new RegExp(`\\+?${digits.split('').join('[\\s()-]*')}`, 'g');
        const next = out.replace(flex, () => {
          details += 1;
          usedMap.set(p.token, p.id);
          return p.token;
        });
        out = next;
      }
      const exact = replaceAllCI(out, p.phone, p.token);
      if (exact.count) {
        out = exact.text;
        details += exact.count;
        usedMap.set(p.token, p.id);
      }
    }
    if (p.email) {
      const r = replaceAllCI(out, p.email, p.token);
      if (r.count) {
        out = r.text;
        details += r.count;
        usedMap.set(p.token, p.id);
      }
    }
  }

  // Leftover unknown PII still goes through the generic redactor.
  const leftover = redactForCloud(out, planNames);
  out = leftover.text;
  names += leftover.names;
  details += leftover.details;

  return {
    text: out,
    used: [...usedMap.entries()].map(([token, personId]) => ({ token, personId })),
    names,
    details,
  };
}

/** Put real names (and phone/email when the token stood in for them) back. */
export function fillNames(text: string, people: readonly Person[]): FillResult {
  let out = text;
  let filled = 0;
  // Longer tokens first ("[Client A]" before "[Client]" if both existed).
  const list = [...people].sort((a, b) => b.token.length - a.token.length);
  for (const p of list) {
    const re = new RegExp(escapeRegExp(p.token), 'g');
    const next = out.replace(re, () => {
      filled += 1;
      return p.name;
    });
    out = next;
  }
  return { text: out, filled };
}

export function nothingRaw(payload: string, people: readonly Person[]): boolean {
  const lower = payload.toLowerCase();
  for (const p of people) {
    if (p.name && new RegExp(`\\b${escapeRegExp(p.name)}\\b`, 'i').test(payload)) return false;
    if (p.email && lower.includes(p.email.toLowerCase())) return false;
    const digits = p.phone?.replace(/\D/g, '') ?? '';
    if (digits.length >= 10) {
      const only = payload.replace(/\D/g, '');
      if (only.includes(digits)) return false;
    }
  }
  return true;
}

export function appendFilledSuffix(line: string, filled: number): string {
  if (filled <= 0) return line;
  if (line.includes(FILLED_ON_DEVICE_SUFFIX)) return line;
  return `${line} ${FILLED_ON_DEVICE_SUFFIX}`;
}

export function sanitizePerson(raw: unknown): Person | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  if (typeof o.name !== 'string' || !o.name.trim()) return null;
  if (typeof o.token !== 'string' || !o.token.startsWith('[') || !o.token.endsWith(']')) return null;
  const role = PERSON_ROLES.includes(o.role as PersonRole) ? (o.role as PersonRole) : 'other';
  const notes = Array.isArray(o.notes)
    ? o.notes.filter((n): n is string => typeof n === 'string').map((n) => n.slice(0, 400)).slice(0, 20)
    : [];
  const p: Person = {
    id: o.id.slice(0, 40),
    name: o.name.trim().slice(0, 80),
    role,
    token: o.token.slice(0, 40),
    notes,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : 0,
  };
  if (typeof o.phone === 'string' && o.phone.trim()) p.phone = o.phone.trim().slice(0, 40);
  if (typeof o.email === 'string' && o.email.trim()) p.email = o.email.trim().slice(0, 80);
  return p;
}

export interface Directory {
  people(): Person[];
  get(id: string): Person | undefined;
  add(input: { name: string; role: PersonRole; phone?: string; email?: string; note?: string }): Person;
  update(id: string, patch: Partial<Pick<Person, 'name' | 'role' | 'phone' | 'email' | 'notes'>>): Person | null;
  addNote(id: string, note: string): Person | null;
  remove(id: string): boolean;
  clear(): void;
  subscribe(fn: () => void): () => void;
}

export interface DirectoryStore {
  load(): Promise<Person[]>;
  save(people: Person[]): Promise<void>;
}

export function createMemoryDirectoryStore(initial: Person[] = []): DirectoryStore {
  let rows = initial.map((p) => ({ ...p, notes: [...p.notes] }));
  return {
    async load() { return rows.map((p) => ({ ...p, notes: [...p.notes] })); },
    async save(people) { rows = people.map((p) => ({ ...p, notes: [...p.notes] })); },
  };
}

const DB_NAME = 'mendcraft-directory';
const STORE = 'people';

export function createIndexedDbDirectoryStore(
  idb: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined,
  dbName = DB_NAME,
): DirectoryStore {
  function open(): Promise<IDBDatabase> {
    if (!idb) return Promise.reject(new Error('no IndexedDB'));
    return new Promise((resolve, reject) => {
      const req = idb.open(dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('idb open failed'));
    });
  }
  return {
    async load() {
      try {
        const db = await open();
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).get('all');
          req.onsuccess = () => {
            const raw = req.result as unknown;
            const arr = Array.isArray(raw) ? raw : [];
            resolve(arr.map(sanitizePerson).filter((x): x is Person => !!x));
          };
          req.onerror = () => reject(req.error);
        });
      } catch (err) {
        console.warn('directory: load failed, starting empty', err);
        return [];
      }
    },
    async save(people) {
      try {
        const db = await open();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(people, 'all');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch (err) {
        // Private mode / IDB blocked — stay in memory.
        console.warn('directory: save failed, staying in memory', err);
      }
    },
  };
}

export function createDirectory(
  store: DirectoryStore,
  now: () => number = Date.now,
  genId: () => string = () => `p${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
): Directory {
  let people: Person[] = [];
  const subs = new Set<() => void>();
  let ready: Promise<void> | null = null;

  function emit(): void {
    store.save(people).catch((err) => console.warn('directory: failed to persist people', err));
    for (const fn of subs) fn();
  }

  ready = store.load().then((rows) => { people = rows; for (const fn of subs) fn(); });

  return {
    people: () => people.map((p) => ({ ...p, notes: [...p.notes] })),
    get: (id) => people.find((p) => p.id === id),
    add(input) {
      const name = input.name.trim().slice(0, 80);
      if (!name) throw new Error('A person needs a name');
      const same = people.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (same) return same;
      const p: Person = {
        id: genId(),
        name,
        role: input.role,
        token: nextToken(input.role, people),
        notes: input.note ? [input.note.slice(0, 400)] : [],
        createdAt: now(),
        ...(input.phone?.trim() ? { phone: input.phone.trim().slice(0, 40) } : {}),
        ...(input.email?.trim() ? { email: input.email.trim().slice(0, 80) } : {}),
      };
      people = [...people, p];
      emit();
      return p;
    },
    update(id, patch) {
      const i = people.findIndex((p) => p.id === id);
      if (i < 0) return null;
      const cur = people[i];
      const next: Person = {
        ...cur,
        ...(patch.name ? { name: patch.name.trim().slice(0, 80) } : {}),
        ...(patch.role ? { role: patch.role } : {}),
        ...(patch.notes ? { notes: patch.notes.slice(0, 20) } : {}),
      };
      if (patch.phone !== undefined) {
        if (patch.phone?.trim()) next.phone = patch.phone.trim().slice(0, 40);
        else delete next.phone;
      }
      if (patch.email !== undefined) {
        if (patch.email?.trim()) next.email = patch.email.trim().slice(0, 80);
        else delete next.email;
      }
      // Token stays stable even if the role is edited.
      people = people.map((p, j) => (j === i ? next : p));
      emit();
      return next;
    },
    addNote(id, note) {
      const cur = people.find((p) => p.id === id);
      if (!cur) return null;
      return this.update(id, { notes: [...cur.notes, note.slice(0, 400)].slice(-20) });
    },
    remove(id) {
      const n = people.length;
      people = people.filter((p) => p.id !== id);
      if (people.length === n) return false;
      emit();
      return true;
    },
    clear() {
      people = [];
      emit();
    },
    subscribe(fn) {
      subs.add(fn);
      void ready;
      return () => subs.delete(fn);
    },
  };
}


/** Live directory the cloud-protect path uses. Main binds this once at boot. */
let bound: Directory | null = null;

export function bindDirectory(dir: Directory | null): void {
  bound = dir;
}

export function activePeople(): Person[] {
  return bound ? bound.people() : [];
}

/** Drop-in for redactForCloud that also applies stable directory tokens. */
export function protectText(text: string, planNames: string[] = []): ProtectResult {
  return protectForCloud(text, activePeople(), planNames);
}

export function fillVisible(text: string): FillResult {
  return fillNames(text, activePeople());
}
