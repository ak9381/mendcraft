import { describe, expect, it } from 'vitest';
import { chooseHandOption, handOptionsOf, type SelectLike } from '../src/ui/handSelect';

function fakeSelect(value: string) {
  const events: string[] = [];
  const sel: SelectLike & { events: string[] } = {
    value, events, disabled: false,
    options: [{ value: 'en', text: 'English' }, { value: 'kn', text: 'ಕನ್ನಡ' }, { value: 'x', text: 'Soon', disabled: true }],
    dispatchEvent: (e: Event) => { events.push(e.type); return true; },
    getAttribute: () => null,
  };
  return sel;
}

describe('hand list for a native <select> (C172–C175)', () => {
  it('lists every option with the current one marked', () => {
    expect(handOptionsOf(fakeSelect('kn'))).toEqual([
      { value: 'en', label: 'English', disabled: false, current: false },
      { value: 'kn', label: 'ಕನ್ನಡ', disabled: false, current: true },
      { value: 'x', label: 'Soon', disabled: true, current: false },
    ]);
  });
  it('choosing sets the value and fires input then change, like a native pick', () => {
    const s = fakeSelect('en');
    expect(chooseHandOption(s, 'kn')).toBe(true);
    expect(s.value).toBe('kn');
    expect(s.events).toEqual(['input', 'change']);
  });
  it('a disabled, unknown or already-chosen option does nothing', () => {
    const s = fakeSelect('en');
    expect(chooseHandOption(s, 'x')).toBe(false);
    expect(chooseHandOption(s, 'nope')).toBe(false);
    expect(chooseHandOption(s, 'en')).toBe(false);
    expect(s.events).toEqual([]);
  });
});
