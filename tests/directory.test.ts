import { describe, expect, it } from 'vitest';
import {
  createDirectory, createMemoryDirectoryStore, protectForCloud, fillNames, nothingRaw, nextToken,
  appendFilledSuffix, FILLED_ON_DEVICE_SUFFIX, type Person,
} from '../src/privacy/directory';

async function seeded() {
  const store = createMemoryDirectoryStore();
  let n = 0;
  const d = createDirectory(store, () => 1, () => `id${++n}`);
  await Promise.resolve();
  const priya = d.add({ name: 'Priya Sharma', role: 'client', phone: '+91 98765 43210', email: 'priya@example.com', note: 'Wants a wider door' });
  const amma = d.add({ name: 'Lakshmi', role: 'mother', note: 'Uses a walker' });
  const ravi = d.add({ name: 'Ravi', role: 'contractor' });
  const anil = d.add({ name: 'Anil', role: 'other' });
  return { d, store, priya, amma, ravi, anil };
}

describe('people directory tokens', () => {
  it('assigns stable role tokens', async () => {
    const { priya, amma, ravi, anil, d } = await seeded();
    expect([priya.token, amma.token, ravi.token, anil.token]).toEqual(['[Client A]', '[Mother]', '[Contractor A]', '[Person 1]']);
    const meena = d.add({ name: 'Meena', role: 'client' });
    expect(meena.token).toBe('[Client B]');
    d.update(priya.id, { role: 'contractor' });
    expect(d.get(priya.id)!.token).toBe('[Client A]');
  });

  it('nextToken never reuses a token in use', () => {
    const ps = [{ role: 'client', token: '[Client A]' }, { role: 'client', token: '[Client C]' }] as Person[];
    expect(nextToken('client', ps)).toBe('[Client B]');
  });

  it('persists to the store and survives reload; clear empties it', async () => {
    const { store, d } = await seeded();
    await Promise.resolve();
    const again = createDirectory(store);
    await new Promise((r) => setTimeout(r, 0));
    expect(again.people().map((p) => p.token)).toContain('[Mother]');
    d.clear();
    await new Promise((r) => setTimeout(r, 0));
    expect(await store.load()).toEqual([]);
  });
});

describe('protectForCloud / fillNames round trip', () => {
  it('sends nothing raw and re-identifies on device', async () => {
    const { d } = await seeded();
    const people = d.people();
    const raw = 'Priya Sharma said her mother Lakshmi needs a ramp; call +91 98765 43210 or priya@example.com. Ravi will build it.';
    const p = protectForCloud(raw, people);
    expect(p.text).toBe('[Client A] said her mother [Mother] needs a ramp; call [Client A] or [Client A]. [Contractor A] will build it.');
    expect(nothingRaw(p.text, people)).toBe(true);
    expect(p.used.map((u) => u.token).sort()).toEqual(['[Client A]', '[Contractor A]', '[Mother]']);
    const back = fillNames('Tell [Client A] that [Mother] gets a 1:12 ramp, built by [Contractor A].', people);
    expect(back.text).toBe('Tell Priya Sharma that Lakshmi gets a 1:12 ramp, built by Ravi.');
    expect(back.filled).toBe(3);
  });

  it('is stable across calls and leaves unknown people to the generic redactor', async () => {
    const { d } = await seeded();
    const a = protectForCloud('Ravi and my sister Kavya', d.people());
    const b = protectForCloud('Ravi and my sister Kavya', d.people());
    expect(a.text).toBe(b.text);
    expect(a.text).toBe('[Contractor A] and my sister [name]');
  });

  it('email draft round trip: tokens out, real names back in', async () => {
    const { d } = await seeded();
    const people = d.people();
    const prompt = protectForCloud('Draft an email to Priya Sharma about Lakshmi\'s bathroom grab bars.', people).text;
    expect(nothingRaw(prompt, people)).toBe(true);
    const cloudDraft = { subject: 'Grab bars for [Mother]', body: 'Hi [Client A],\n\nFor [Mother]\'s bathroom we suggest two grab bars.\n\nThanks' };
    const subject = fillNames(cloudDraft.subject, people);
    const body = fillNames(cloudDraft.body, people);
    expect(subject.text).toBe('Grab bars for Lakshmi');
    expect(body.text).toContain('Hi Priya Sharma,');
    expect(body.text).toContain("For Lakshmi's bathroom");
    expect(appendFilledSuffix('Deep · online', subject.filled + body.filled)).toBe(`Deep · online ${FILLED_ON_DEVICE_SUFFIX}`);
    expect(appendFilledSuffix('Deep · online', 0)).toBe('Deep · online');
  });
});
