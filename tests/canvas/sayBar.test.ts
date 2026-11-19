import { describe, expect, it } from 'vitest';
import { wireSayBar } from '../../src/canvas/mobile/components/sayBar';
import { MIC_IDLE_LABEL, MIC_LISTENING_LABEL } from '../../src/canvas/micFab';

/** Minimal hand-rolled fake DOM, in the same style the rest of this suite
 *  uses for DOM modules under Vitest's node environment (no jsdom). */
function fakeEl() {
  const handlers: Record<string, Array<(e?: unknown) => void>> = {};
  return {
    attrs: {} as Record<string, string>,
    textContent: '',
    value: '',
    setAttribute(k: string, v: string) { this.attrs[k] = v; },
    getAttribute(k: string) { return this.attrs[k] ?? null; },
    addEventListener(t: string, f: (e?: unknown) => void) { (handlers[t] ??= []).push(f); },
    fire(t: string, e?: unknown) { handlers[t]?.forEach((f) => f(e)); },
  } as any;
}

function setup() {
  const form = fakeEl();
  const input = fakeEl();
  const talk = fakeEl();
  const label = fakeEl();
  talk.querySelector = (sel: string) => (sel === '.mc-m-talk-label' ? label : null);
  const host: any = {
    querySelector: (sel: string) => {
      if (sel === '.mc-m-saybar') return form;
      if (sel === '.mc-m-say-in') return input;
      if (sel === '.mc-m-talk') return talk;
      return null;
    },
  };
  return { form, input, talk, label, host };
}

describe('wireSayBar talk toggle', () => {
  it('starts idle (not pressed, Talk label)', () => {
    const { talk, label, host } = setup();
    wireSayBar(host, () => {});
    expect(talk.attrs['aria-pressed']).toBeUndefined();
    expect(label.textContent).toBe('');
    void MIC_IDLE_LABEL;
  });

  it('click toggles to listening, aria-pressed and label flip', () => {
    const { talk, label, host } = setup();
    wireSayBar(host, () => {});
    talk.fire('click');
    expect(talk.attrs['aria-pressed']).toBe('true');
    expect(label.textContent).toBe(MIC_LISTENING_LABEL);
    expect(talk.attrs['aria-label']).toBe('Stop listening');
  });

  it('second click returns to idle (Talk)', () => {
    const { talk, label, host } = setup();
    wireSayBar(host, () => {});
    talk.fire('click');
    talk.fire('click');
    expect(talk.attrs['aria-pressed']).toBe('false');
    expect(label.textContent).toBe(MIC_IDLE_LABEL);
    expect(talk.attrs['aria-label']).toBe('Talk: start listening');
  });

  it('submitting the form calls onSay with the trimmed value and clears it', () => {
    const { form, input, host } = setup();
    const said: string[] = [];
    wireSayBar(host, (text) => said.push(text));
    input.value = '  connect everything  ';
    form.fire('submit', { preventDefault() {} });
    expect(said).toEqual(['connect everything']);
    expect(input.value).toBe('');
  });
});
