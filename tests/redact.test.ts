import { describe, expect, it } from 'vitest';
import { redactForCloud } from '../src/ai/redact';

describe('redactForCloud (deterministic, rules only)', () => {
  it('redacts a kin-anchored name', () => {
    const r = redactForCloud('Does this bedroom work for my mother Lakshmi? She uses a walker.');
    expect(r.text).toBe('Does this bedroom work for my mother [name]? She uses a walker.');
    expect(r.names).toBe(1);
    expect(r.details).toBe(0);
  });

  it("redacts a possessive name before a room-like noun (Meera's room)", () => {
    const r = redactForCloud("Is Meera's room big enough for a desk?");
    expect(r.text).toBe("Is [name]'s room big enough for a desk?");
    expect(r.names).toBe(1);
  });

  it('redacts phone numbers and emails as details', () => {
    const r = redactForCloud('Call me on +91 98765 43210 or write to amma@example.com about the plan.');
    expect(r.text).toBe('Call me on [phone] or write to [email] about the plan.');
    expect(r.details).toBe(2);
    expect(r.names).toBe(0);
  });

  it('does not mistake plan measurements for phone numbers', () => {
    const r = redactForCloud('make the room 4000 by 3000 and the wall 200 thick');
    expect(r.text).toBe('make the room 4000 by 3000 and the wall 200 thick');
    expect(r.details).toBe(0);
  });

  it('redacts person-like plan text labels but keeps room-like labels', () => {
    const r = redactForCloud('Is the bed in Lakshmi near the Kitchen wall?', ['Lakshmi', 'Kitchen']);
    expect(r.text).toBe('Is the bed in [name] near the Kitchen wall?');
    expect(r.names).toBe(1);
  });

  it('is a no-op on clean text', () => {
    const clean = 'How wide is the hallway between the kitchen and the bedroom?';
    const r = redactForCloud(clean, ['Kitchen']);
    expect(r).toEqual({ text: clean, names: 0, details: 0 });
  });

  it('is idempotent — redacted tokens are never re-redacted', () => {
    const once = redactForCloud('my mother Lakshmi wants Meera\'s room to call +91 98765 43210');
    const twice = redactForCloud(once.text, ['Lakshmi']);
    expect(twice.text).toBe(once.text);
    expect(twice.names).toBe(0);
    expect(twice.details).toBe(0);
  });

  it('phones: false keeps digit runs (a recorded reply\'s JSON numbers) and still redacts names and emails', () => {
    const reply = '{"rooms":[{"x":4000,"y":3000,"w":4000,"h":3000}],"sizes":[1000 2000 3000 4000],"by":"my mother Lakshmi","mail":"a.b@example.com"}';
    const kept = redactForCloud(reply, [], { phones: false }).text;
    expect(kept).toContain('[1000 2000 3000 4000]');
    expect(kept).toContain('my mother [name]');
    expect(kept).toContain('[email]');
    expect(redactForCloud(reply).text).toContain('[phone]');
  });
});
