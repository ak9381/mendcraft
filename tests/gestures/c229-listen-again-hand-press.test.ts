// C229: "Listen again" on the unpaired phone pair screen responds to a HAND
// press, not only a mouse click(). A pinch-tap arrives as a `click` on the
// button (handPointer's activate() → el.click()).
import { describe, expect, it } from 'vitest';
import { wireListenAgainButton, type ListenAgainEl } from '../../src/canvas/mobile/listenAgain';

function fakeButton(): ListenAgainEl & { fire: (t: string) => void } {
  const handlers: Record<string, Array<(e: unknown) => void>> = {};
  return {
    addEventListener: (t, f) => { (handlers[t] ??= []).push(f); },
    fire: (t) => handlers[t]?.forEach((fn) => fn({})),
  };
}

describe('C229 Listen again — hand press', () => {
  it('a hand pinch (click) asks the phone to listen for the laptop chime again', () => {
    const btn = fakeButton();
    const listens: number[] = [];
    wireListenAgainButton(btn, { onListen: () => listens.push(1) });

    btn.fire('click');
    expect(listens).toEqual([1]);
    btn.fire('click');
    expect(listens).toHaveLength(2);
  });
});
