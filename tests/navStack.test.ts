import { describe, expect, it } from 'vitest';
import { createNavStack } from '../src/input/navStack';

describe('reference panel Back/Forward (C041/C042)', () => {
  it('goes back and forward through visited addresses', () => {
    const n = createNavStack();
    expect(n.canBack()).toBe(false);
    n.visit('a'); n.visit('b'); n.visit('c');
    expect(n.back()).toBe('b'); expect(n.back()).toBe('a'); expect(n.back()).toBeNull();
    expect(n.canForward()).toBe(true);
    expect(n.forward()).toBe('b');
  });
  it('a new visit after going back drops the forward entries, like a browser', () => {
    const n = createNavStack();
    n.visit('a'); n.visit('b'); n.back(); n.visit('x');
    expect(n.canForward()).toBe(false);
    expect(n.back()).toBe('a');
  });
  it('revisiting the current address adds nothing; the cap keeps the newest', () => {
    const n = createNavStack(2);
    n.visit('a'); n.visit('a'); expect(n.canBack()).toBe(false);
    n.visit('b'); n.visit('c'); expect(n.back()).toBe('b'); expect(n.back()).toBeNull();
  });
});
