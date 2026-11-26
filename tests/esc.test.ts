import { describe, expect, it } from 'vitest';
import { esc } from '../src/core/esc';

describe('esc', () => {
  it('escapes HTML metacharacters and quotes', () => {
    expect(esc('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(esc(`she said "hi" & left`)).toBe('she said &quot;hi&quot; &amp; left');
    expect(esc(`it's fine`)).toBe('it&#39;s fine');
  });

  it('leaves plain text untouched', () => {
    expect(esc('Living Room Lamp')).toBe('Living Room Lamp');
  });
});
